// Tests for API Worker AI integration and fallback logic
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../workers/api';
import { WorkerBindings, ChatMessage, ConversationContext } from '../workers/types';

// Mock implementations
const mockAI = {
  run: vi.fn()
};

const mockMemoryDO = {
  idFromName: vi.fn(),
  get: vi.fn()
};

const mockDOStub = {
  fetch: vi.fn()
};

const mockEnv: WorkerBindings = {
  AI: mockAI as any,
  MEMORY_DO: mockMemoryDO as any,
  CHAT_KV: {} as any,
  ARCHIVE_R2: {} as any,
  OPENAI_API_KEY: 'test-openai-key',
  MAX_TOKENS: '4096'
};

// Mock fetch for OpenAI API calls
const originalFetch = global.fetch;

describe('API Worker AI Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock responses
    mockMemoryDO.idFromName.mockReturnValue('test-do-id');
    mockMemoryDO.get.mockReturnValue(mockDOStub);
    
    mockDOStub.fetch.mockImplementation((url: string, options?: any) => {
      if (url.includes('action=context')) {
        return Promise.resolve(new Response(JSON.stringify({
          sessionId: 'test-session',
          summary: 'Test conversation',
          recentMessages: [],
          activeTopics: [],
          resolvedIssues: []
        })));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true })));
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Chat Request Processing', () => {
    it('should process a valid chat message successfully with Llama model', async () => {
      // Mock successful Llama response
      mockAI.run.mockResolvedValue({
        response: 'Hello! How can I help you today?',
        usage: {
          prompt_tokens: 50,
          completion_tokens: 20,
          total_tokens: 70
        }
      });

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Hello, I need help',
          sessionId: 'test-session'
        })
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.message.content).toBe('Hello! How can I help you today?');
      expect(result.message.role).toBe('assistant');
      expect(result.model).toBe('llama-3.3-70b-fp8-fast');
      expect(result.fallbackUsed).toBe(false);
      expect(result.sessionId).toBe('test-session');
      
      // Verify AI was called with correct parameters
      expect(mockAI.run).toHaveBeenCalledWith('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: 'Hello, I need help' })
        ]),
        max_tokens: expect.any(Number),
        temperature: 0.3,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.1,
        stream: false
      });
    });

    it('should fallback to OpenAI when Llama model fails', async () => {
      // Mock Llama failure
      mockAI.run.mockRejectedValue(new Error('Llama model unavailable'));

      // Mock successful OpenAI response
      global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{
          message: {
            content: 'I can help you with that using OpenAI fallback.'
          }
        }],
        usage: {
          prompt_tokens: 45,
          completion_tokens: 25,
          total_tokens: 70
        }
      })));

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Help me please',
          sessionId: 'test-session'
        })
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.message.content).toBe('I can help you with that using OpenAI fallback.');
      expect(result.model).toBe('gpt-3.5-turbo-fallback');
      expect(result.fallbackUsed).toBe(true);

      // Verify OpenAI API was called
      expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-openai-key',
          'Content-Type': 'application/json'
        },
        body: expect.stringContaining('gpt-3.5-turbo')
      });
    });

    it('should handle both AI models failing gracefully', async () => {
      // Mock both models failing
      mockAI.run.mockRejectedValue(new Error('Llama model unavailable'));
      global.fetch = vi.fn().mockRejectedValue(new Error('OpenAI API unavailable'));

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Help me please',
          sessionId: 'test-session'
        })
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result.error.code).toBe('AI_PROCESSING_FAILED');
      expect(result.error.retryable).toBe(true);
      expect(result.error.fallbackAvailable).toBe(true);
    });

    it('should generate session ID when not provided', async () => {
      mockAI.run.mockResolvedValue({
        response: 'Hello! New session created.',
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 }
      });

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Start new conversation'
        })
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.sessionId).toMatch(/^sess_\d+_[a-z0-9]+$/);
      expect(result.message.sessionId).toBe(result.sessionId);
    });

    it('should validate message input', async () => {
      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '', // Empty message
          sessionId: 'test-session'
        })
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('should handle missing message field', async () => {
      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'test-session'
          // Missing message field
        })
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.error.code).toBe('INVALID_INPUT');
    });
  });

  describe('AI Model Integration', () => {
    it('should call Llama model with correct parameters', async () => {
      mockAI.run.mockResolvedValue({
        response: 'Test response',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      });

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Test message',
          sessionId: 'test-session'
        })
      });

      await worker.fetch(request, mockEnv, {} as any);

      expect(mockAI.run).toHaveBeenCalledWith('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('expert AI support assistant')
          }),
          expect.objectContaining({
            role: 'user',
            content: 'Test message'
          })
        ]),
        max_tokens: 4096,
        temperature: 0.3,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.1,
        stream: false
      });
    });

    it('should include conversation context in system prompt', async () => {
      // Mock context with active topics and summary
      mockDOStub.fetch.mockImplementation((url: string) => {
        if (url.includes('action=context')) {
          return Promise.resolve(new Response(JSON.stringify({
            sessionId: 'test-session',
            summary: 'User asked about billing issues',
            recentMessages: [
              { role: 'user', content: 'I have a billing question' },
              { role: 'assistant', content: 'I can help with billing' }
            ],
            activeTopics: ['billing', 'account-management'],
            resolvedIssues: ['password-reset']
          })));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true })));
      });

      mockAI.run.mockResolvedValue({
        response: 'Continuing billing discussion',
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
      });

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'What about my recent charges?',
          sessionId: 'test-session'
        })
      });

      await worker.fetch(request, mockEnv, {} as any);

      const systemMessage = mockAI.run.mock.calls[0][1].messages.find(
        (msg: any) => msg.role === 'system'
      );

      expect(systemMessage.content).toContain('billing, account-management');
      expect(systemMessage.content).toContain('password-reset');
      expect(systemMessage.content).toContain('User asked about billing issues');
    });

    it('should handle OpenAI API errors gracefully', async () => {
      mockAI.run.mockRejectedValue(new Error('Llama unavailable'));
      
      // Mock OpenAI API error
      global.fetch = vi.fn().mockResolvedValue(new Response('API Error', { 
        status: 429,
        statusText: 'Rate Limited'
      }));

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Test message',
          sessionId: 'test-session'
        })
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result.error.code).toBe('AI_PROCESSING_FAILED');
    });

    it('should handle missing OpenAI API key', async () => {
      const envWithoutOpenAI = { ...mockEnv, OPENAI_API_KEY: undefined };
      
      mockAI.run.mockRejectedValue(new Error('Llama unavailable'));

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Test message',
          sessionId: 'test-session'
        })
      });

      const response = await worker.fetch(request, envWithoutOpenAI, {} as any);
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result.error.code).toBe('AI_PROCESSING_FAILED');
    });
  });

  describe('Session Management', () => {
    it('should handle session info requests', async () => {
      mockDOStub.fetch.mockResolvedValue(new Response(JSON.stringify({
        id: 'test-session',
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now()
      })));

      const request = new Request('https://test.com/api/session/test-session', {
        method: 'GET'
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.id).toBe('test-session');
      expect(result.status).toBe('active');
    });

    it('should handle session deletion', async () => {
      mockDOStub.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true })));

      const request = new Request('https://test.com/api/session/test-session', {
        method: 'DELETE'
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
    });

    it('should validate session ID in requests', async () => {
      const request = new Request('https://test.com/api/session/', {
        method: 'GET'
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.error.code).toBe('INVALID_SESSION_ID');
    });
  });

  describe('Error Handling', () => {
    it('should handle CORS preflight requests', async () => {
      const request = new Request('https://test.com/api/chat', {
        method: 'OPTIONS'
      });

      const response = await worker.fetch(request, mockEnv, {} as any);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should return 404 for unknown routes', async () => {
      const request = new Request('https://test.com/api/unknown', {
        method: 'GET'
      });

      const response = await worker.fetch(request, mockEnv, {} as any);

      expect(response.status).toBe(404);
    });

    it('should handle health check requests', async () => {
      const request = new Request('https://test.com/api/health', {
        method: 'GET'
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.overall).toBe('healthy');
      expect(result.timestamp).toBeDefined();
      expect(result.requestId).toBeDefined();
    });

    it('should include request IDs in all responses', async () => {
      mockAI.run.mockResolvedValue({
        response: 'Test response',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      });

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Test message',
          sessionId: 'test-session'
        })
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json();

      expect(result.requestId).toBeDefined();
      expect(typeof result.requestId).toBe('string');
    });
  });

  describe('Memory Integration', () => {
    it('should add user and assistant messages to memory', async () => {
      mockAI.run.mockResolvedValue({
        response: 'AI response',
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
      });

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'User message',
          sessionId: 'test-session'
        })
      });

      await worker.fetch(request, mockEnv, {} as any);

      // Verify both user and assistant messages were added
      expect(mockDOStub.fetch).toHaveBeenCalledWith(
        expect.stringContaining('test-session'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"action":"addMessage"')
        })
      );

      // Should be called twice - once for user message, once for assistant
      const addMessageCalls = mockDOStub.fetch.mock.calls.filter(call => 
        call[1]?.body?.includes('"action":"addMessage"')
      );
      expect(addMessageCalls).toHaveLength(2);
    });

    it('should retrieve conversation context before processing', async () => {
      mockAI.run.mockResolvedValue({
        response: 'Context-aware response',
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 }
      });

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Follow-up question',
          sessionId: 'test-session'
        })
      });

      await worker.fetch(request, mockEnv, {} as any);

      // Verify context was retrieved
      expect(mockDOStub.fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=context')
      );
    });
  });
});