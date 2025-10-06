// Main API Worker with AI integration and WebSocket handling
import {
  ChatMessage,
  SessionState,
  ConversationContext,
  WorkerBindings,
  ErrorResponse,
  validateChatMessage,
  generateMessageId,
  generateSessionId
} from './types';
import { SecurityManager, extractSecurityContext } from './security';
import { MonitoringMiddleware } from './monitoring_middleware';
import { createMonitoringSystem, Logger, MetricsCollector } from './logging';

export { SessionMemoryDO } from './do_memory';

interface AIResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ProcessingResult {
  response: AIResponse;
  success: boolean;
  fallbackUsed: boolean;
  error?: string;
}

export default {
  async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext): Promise<Response> {
    const middleware = new MonitoringMiddleware(env);
    
    return await middleware.wrapRequest(request, async (req, context) => {
      const { logger, metrics, requestId } = context;
      const url = new URL(req.url);
      
      // Add CORS headers for all responses
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      try {
        // Route handling with monitoring
        if (url.pathname === '/api/chat') {
          return await handleChatRequest(req, env, requestId, corsHeaders, logger, metrics, middleware);
        } else if (url.pathname === '/api/websocket') {
          return await handleWebSocketUpgrade(req, env, requestId, logger);
        } else if (url.pathname.startsWith('/api/session/')) {
          return await handleSessionRequest(req, env, requestId, corsHeaders, logger, metrics, middleware);
        } else if (url.pathname === '/api/health') {
          const { health } = createMonitoringSystem(env, requestId);
          const healthStatus = await health.checkHealth();
          
          return new Response(JSON.stringify({
            ...healthStatus,
            requestId
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } else if (url.pathname === '/api/metrics') {
          const exportedMetrics = await metrics.exportMetrics();
          
          return new Response(exportedMetrics, {
            headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
          });
        } else if (url.pathname === '/api/alerts') {
          const { alerts } = createMonitoringSystem(env, requestId);
          const activeAlerts = alerts.getActiveAlerts();
          
          return new Response(JSON.stringify({
            alerts: activeAlerts,
            requestId,
            timestamp: Date.now()
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } else {
          metrics.incrementCounter('requests_not_found', 1, { path: url.pathname });
          return new Response('Not Found', { 
            status: 404, 
            headers: corsHeaders 
          });
        }
      } catch (error) {
        await logger.error('API Worker error', error as Error);
        return createErrorResponse(
          'INTERNAL_ERROR',
          'Internal server error',
          requestId,
          500,
          corsHeaders
        );
      }
    });
  }
};

async function handleChatRequest(
  request: Request, 
  env: WorkerBindings, 
  requestId: string,
  corsHeaders: Record<string, string>,
  logger: Logger,
  metrics: MetricsCollector,
  middleware: MonitoringMiddleware
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const body = await request.json() as {
      message: string;
      sessionId?: string;
      context?: ConversationContext;
    };

    // Validate input
    if (!body.message || typeof body.message !== 'string') {
      return createErrorResponse(
        'INVALID_INPUT',
        'Message is required and must be a string',
        requestId,
        400,
        corsHeaders
      );
    }

    // Generate or use existing session ID
    const sessionId = body.sessionId || generateSessionId();
    
    // Initialize security manager
    const securityManager = new SecurityManager(env);
    const securityContext = extractSecurityContext(request, requestId, sessionId);
    
    // Perform comprehensive security check with monitoring
    const securityCheck = await middleware.monitorSecurityCheck(
      'comprehensive_check',
      sessionId,
      logger,
      metrics,
      () => securityManager.performSecurityCheck(body.message, sessionId, securityContext)
    );
    
    // Block request if security check fails
    if (!securityCheck.allowed) {
      return createErrorResponse(
        'SECURITY_VIOLATION',
        `Request blocked: ${securityCheck.violations.join(', ')}`,
        requestId,
        429, // Too Many Requests for rate limiting, 400 for content violations
        corsHeaders,
        false,
        {
          violations: securityCheck.violations,
          rateLimitReset: securityCheck.rateLimitResult.resetTime,
          remaining: securityCheck.rateLimitResult.remaining
        }
      );
    }
    
    // Use filtered content instead of original message
    const filteredMessage = securityCheck.filteredContent;
    
    // Create user message with filtered content
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      sessionId,
      content: filteredMessage,
      role: 'user',
      timestamp: Date.now(),
      metadata: {
        piiFiltered: securityCheck.piiResult.hasPII,
        contentFiltered: securityCheck.contentResult.violations.length > 0
      }
    };

    // Validate message
    if (!validateChatMessage(userMessage)) {
      return createErrorResponse(
        'INVALID_MESSAGE',
        'Invalid message format',
        requestId,
        400,
        corsHeaders
      );
    }

    // Get Durable Object instance and add message with monitoring
    const doId = env.MEMORY_DO.idFromName(sessionId);
    const doStub = env.MEMORY_DO.get(doId);

    // Add user message to memory with monitoring
    await middleware.monitorDOOperation(
      'addMessage',
      sessionId,
      logger,
      metrics,
      () => doStub.fetch(`https://memory-do/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          message: userMessage
        })
      })
    );

    // Get conversation context with monitoring
    const context = await middleware.monitorDOOperation(
      'getContext',
      sessionId,
      logger,
      metrics,
      async () => {
        const contextResponse = await doStub.fetch(`https://memory-do/${sessionId}?action=context`);
        return await contextResponse.json() as ConversationContext;
      }
    );

    // Process message with AI with monitoring
    const processingResult = await processMessageWithAI(
      userMessage,
      context,
      env,
      requestId,
      logger,
      metrics,
      middleware
    );

    if (!processingResult.success) {
      return createErrorResponse(
        'AI_PROCESSING_FAILED',
        processingResult.error || 'Failed to process message',
        requestId,
        500,
        corsHeaders,
        true // retryable
      );
    }

    // Create assistant message
    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      sessionId,
      content: processingResult.response.content,
      role: 'assistant',
      timestamp: Date.now(),
      metadata: {
        toolCalls: [] // Will be populated when tools are implemented
      }
    };

    // Add assistant message to memory with monitoring
    await middleware.monitorDOOperation(
      'addMessage',
      sessionId,
      logger,
      metrics,
      () => doStub.fetch(`https://memory-do/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          message: assistantMessage
        })
      })
    );

    // Return response with security metadata
    return new Response(JSON.stringify({
      message: assistantMessage,
      sessionId,
      model: processingResult.response.model,
      fallbackUsed: processingResult.fallbackUsed,
      usage: processingResult.response.usage,
      requestId,
      timestamp: Date.now(),
      security: {
        piiDetected: securityCheck.piiResult.hasPII,
        contentFiltered: securityCheck.contentResult.violations.length > 0,
        rateLimitRemaining: securityCheck.rateLimitResult.remaining,
        rateLimitReset: securityCheck.rateLimitResult.resetTime
      }
    }), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': securityCheck.rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': securityCheck.rateLimitResult.resetTime.toString()
      }
    });

  } catch (error) {
    console.error('Chat request error:', error);
    return createErrorResponse(
      'CHAT_ERROR',
      'Failed to process chat request',
      requestId,
      500,
      corsHeaders,
      true
    );
  }
}

async function processMessageWithAI(
  message: ChatMessage,
  context: ConversationContext,
  env: WorkerBindings,
  requestId: string,
  logger: Logger,
  metrics: MetricsCollector,
  middleware: MonitoringMiddleware
): Promise<ProcessingResult> {
  // Build conversation history for AI context
  const messages = [
    {
      role: 'system',
      content: buildSystemPrompt(context)
    },
    ...context.recentMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    {
      role: message.role,
      content: message.content
    }
  ];

  // Try primary AI model (Llama 3.1) with monitoring
  try {
    const primaryResult = await middleware.monitorAICall(
      'llama-3.1-8b',
      messages.reduce((acc, msg) => acc + msg.content.length, 0),
      logger,
      metrics,
      () => callLlamaModel(messages, env, requestId)
    );
    
    if (primaryResult.success) {
      return {
        response: primaryResult.response,
        success: true,
        fallbackUsed: false
      };
    }
  } catch (error) {
    await logger.warn('Primary AI model failed, attempting fallback', { error: (error as Error).message });
  }

  // Try OpenAI fallback with monitoring
  try {
    const fallbackResult = await middleware.monitorAICall(
      'gpt-3.5-turbo-fallback',
      messages.reduce((acc, msg) => acc + msg.content.length, 0),
      logger,
      metrics,
      () => callOpenAIFallback(messages, env, requestId)
    );
    
    if (fallbackResult.success) {
      return {
        response: fallbackResult.response,
        success: true,
        fallbackUsed: true
      };
    }
  } catch (error) {
    await logger.error('Fallback AI model also failed', error as Error);
  }

  // Both models failed
  return {
    response: {
      content: "I'm sorry, I'm experiencing technical difficulties right now. Please try again in a moment.",
      model: 'fallback-static'
    },
    success: false,
    fallbackUsed: true,
    error: 'All AI models unavailable'
  };
}

async function callLlamaModel(
  messages: Array<{role: string, content: string}>,
  env: WorkerBindings,
  requestId: string
): Promise<{success: boolean, response: AIResponse}> {
  try {
    // Optimize model parameters for support bot use case
    const optimizedParams = {
      messages: optimizeMessagesForModel(messages),
      max_tokens: calculateOptimalTokenLimit(messages, env),
      temperature: 0.3, // Lower temperature for more consistent support responses
      top_p: 0.9, // Nucleus sampling for better quality
      frequency_penalty: 0.1, // Slight penalty to avoid repetition
      presence_penalty: 0.1, // Encourage diverse responses
      stream: false
    };

    // Use the upgraded Llama 3.3 model for better performance
    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', optimizedParams) as any;

    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response from Llama model');
    }

    // Handle different response formats
    const content = response.response || response.content || (typeof response === 'string' ? response : '');
    
    // Post-process response for better quality
    const processedContent = postProcessAIResponse(content);
    
    return {
      success: true,
      response: {
        content: processedContent,
        model: 'llama-3.3-70b-fp8-fast',
        usage: {
          prompt_tokens: response.usage?.prompt_tokens || 0,
          completion_tokens: response.usage?.completion_tokens || 0,
          total_tokens: response.usage?.total_tokens || 0
        }
      }
    };
  } catch (error) {
    console.error('Llama model error:', error);
    return {
      success: false,
      response: {
        content: '',
        model: 'llama-3.3-70b-fp8-fast'
      }
    };
  }
}

async function callOpenAIFallback(
  messages: Array<{role: string, content: string}>,
  env: WorkerBindings,
  requestId: string
): Promise<{success: boolean, response: AIResponse}> {
  try {
    // Check if OpenAI API key is available
    if (!env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: parseInt(env.MAX_TOKENS || '4096'),
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json() as any;
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response from OpenAI API');
    }

    return {
      success: true,
      response: {
        content: data.choices[0].message.content,
        model: 'gpt-3.5-turbo-fallback',
        usage: {
          prompt_tokens: data.usage?.prompt_tokens || 0,
          completion_tokens: data.usage?.completion_tokens || 0,
          total_tokens: data.usage?.total_tokens || 0
        }
      }
    };
  } catch (error) {
    console.error('OpenAI fallback error:', error);
    return {
      success: false,
      response: {
        content: '',
        model: 'gpt-3.5-turbo-fallback'
      }
    };
  }
}

function buildSystemPrompt(context: ConversationContext): string {
  const basePrompt = `You are an expert AI support assistant specializing in providing exceptional customer service. Your responses should be helpful, accurate, and solution-focused.

CONVERSATION CONTEXT:
- Session: ${context.sessionId}
- Active Topics: ${context.activeTopics.join(', ') || 'General inquiry'}
- Previous Issues Resolved: ${context.resolvedIssues.join(', ') || 'None'}
- Summary: ${context.summary || 'Beginning new conversation'}

RESPONSE GUIDELINES:
1. TONE: Professional, empathetic, and solution-oriented
2. STRUCTURE: Start with acknowledgment, provide clear steps, end with next actions
3. CLARITY: Use simple language, bullet points for multiple steps
4. PROACTIVITY: Anticipate follow-up questions and provide relevant information
5. ESCALATION: Suggest human support for complex technical issues or billing disputes

RESPONSE FORMAT:
- Keep responses under 200 words for better readability
- Use numbered steps for procedures
- Include relevant links or references when helpful
- Always end with "Is there anything else I can help you with?"

AVAILABLE TOOLS (mention when relevant):
- Knowledge base search for detailed documentation
- Ticket creation for complex issues requiring follow-up
- Status checking for existing support requests

Remember: Your goal is to resolve the customer's issue efficiently while providing an excellent support experience.`;

  return basePrompt;
}

async function handleWebSocketUpgrade(
  request: Request,
  env: WorkerBindings,
  requestId: string,
  logger: Logger
): Promise<Response> {
  // WebSocket upgrade handling
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  // For now, return a placeholder response
  // Full WebSocket implementation will be added in task 7
  return new Response('WebSocket upgrade not yet implemented', { status: 501 });
}

async function handleSessionRequest(
  request: Request,
  env: WorkerBindings,
  requestId: string,
  corsHeaders: Record<string, string>,
  logger: Logger,
  metrics: MetricsCollector,
  middleware: MonitoringMiddleware
): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const sessionId = pathParts[pathParts.length - 1];

  if (!sessionId) {
    return createErrorResponse(
      'INVALID_SESSION_ID',
      'Session ID is required',
      requestId,
      400,
      corsHeaders
    );
  }

  try {
    const doId = env.MEMORY_DO.idFromName(sessionId);
    const doStub = env.MEMORY_DO.get(doId);

    if (request.method === 'GET') {
      // Get session info with monitoring
      const sessionData = await middleware.monitorDOOperation(
        'getSession',
        sessionId,
        logger,
        metrics,
        async () => {
          const response = await doStub.fetch(`https://memory-do/${sessionId}?action=session`);
          return await response.json();
        }
      );
      
      return new Response(JSON.stringify({
        ...sessionData,
        requestId,
        timestamp: Date.now()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else if (request.method === 'DELETE') {
      // End session with monitoring
      await middleware.monitorDOOperation(
        'deleteSession',
        sessionId,
        logger,
        metrics,
        () => doStub.fetch(`https://memory-do/${sessionId}`, {
          method: 'DELETE'
        })
      );
      
      return new Response(JSON.stringify({
        success: true,
        requestId,
        timestamp: Date.now()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else {
      return new Response('Method not allowed', { 
        status: 405, 
        headers: corsHeaders 
      });
    }
  } catch (error) {
    await logger.error('Session request error', error as Error);
    return createErrorResponse(
      'SESSION_ERROR',
      'Failed to handle session request',
      requestId,
      500,
      corsHeaders,
      true
    );
  }
}

// AI optimization helper functions
function optimizeMessagesForModel(messages: Array<{role: string, content: string}>): Array<{role: string, content: string}> {
  // Optimize message history for better model performance
  const optimized = messages.map(msg => ({
    ...msg,
    content: msg.content.trim().slice(0, 2000) // Limit message length
  }));

  // Keep only recent messages to stay within context window
  const maxMessages = 15;
  if (optimized.length > maxMessages) {
    // Keep system message and recent messages
    const systemMessages = optimized.filter(m => m.role === 'system');
    const otherMessages = optimized.filter(m => m.role !== 'system').slice(-maxMessages + systemMessages.length);
    return [...systemMessages, ...otherMessages];
  }

  return optimized;
}

function calculateOptimalTokenLimit(messages: Array<{role: string, content: string}>, env: WorkerBindings): number {
  // Calculate optimal token limit based on input length
  const totalInputLength = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  const estimatedInputTokens = Math.ceil(totalInputLength / 4); // Rough estimation: 4 chars per token
  
  const maxTokens = parseInt(env.MAX_TOKENS || '4096');
  const contextWindow = 8192; // Llama 3.3 context window
  
  // Reserve space for input tokens and some buffer
  const availableTokens = contextWindow - estimatedInputTokens - 100;
  
  return Math.min(maxTokens, Math.max(512, availableTokens));
}

function postProcessAIResponse(content: string): string {
  // Clean up and optimize AI response
  let processed = content.trim();
  
  // Remove any potential prompt injection artifacts
  processed = processed.replace(/^(Assistant:|AI:|Bot:)\s*/i, '');
  
  // Ensure proper sentence endings
  if (processed && !processed.match(/[.!?]$/)) {
    processed += '.';
  }
  
  // Limit response length for better UX
  if (processed.length > 1000) {
    const sentences = processed.split(/[.!?]+/);
    let truncated = '';
    for (const sentence of sentences) {
      if ((truncated + sentence).length > 800) break;
      truncated += sentence + '.';
    }
    processed = truncated || processed.slice(0, 800) + '...';
  }
  
  return processed;
}

function createErrorResponse(
  code: string,
  message: string,
  requestId: string,
  status: number,
  corsHeaders: Record<string, string>,
  retryable: boolean = false,
  details?: any
): Response {
  const errorResponse: ErrorResponse = {
    error: {
      code,
      message,
      details,
      retryable,
      fallbackAvailable: code === 'AI_PROCESSING_FAILED'
    },
    requestId,
    timestamp: Date.now()
  };

  const headers = { ...corsHeaders, 'Content-Type': 'application/json' };
  
  // Add rate limit headers if available
  if (details?.rateLimitReset) {
    headers['X-RateLimit-Reset'] = details.rateLimitReset.toString();
  }
  if (details?.remaining !== undefined) {
    headers['X-RateLimit-Remaining'] = details.remaining.toString();
  }

  return new Response(JSON.stringify(errorResponse), {
    status,
    headers
  });
}