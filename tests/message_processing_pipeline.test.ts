// Integration test for the complete message processing pipeline
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../workers/api';
import { WorkerBindings } from '../workers/types';

describe('Message Processing Pipeline Integration', () => {
  let mockEnv: WorkerBindings;
  let mockDOStub: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDOStub = {
      fetch: vi.fn()
    };

    mockEnv = {
      AI: {
        run: vi.fn()
      } as any,
      MEMORY_DO: {
        idFromName: vi.fn().mockReturnValue('test-do-id'),
        get: vi.fn().mockReturnValue(mockDOStub)
      } as any,
      CHAT_KV: {} as any,
      ARCHIVE_R2: {} as any,
      WORKFLOWS: {} as any,
      OPENAI_API_KEY: 'test-key',
      MAX_TOKENS: '2048'
    };

    // Setup default DO responses
    mockDOStub.fetch.mockImplementation((url: string, options?: any) => {
      if (url.includes('action=context')) {
        return Promise.resolve(new Response(JSON.stringify({
          sessionId: 'test-session-123',
          summary: 'User is asking about account issues',
          recentMessages: [
            { role: 'user', content: 'I cannot access my account' },
            { role: 'assistant', content: 'I can help you with account access issues' }
          ],
          activeTopics: ['authentication', 'account-management'],
          resolvedIssues: []
        })));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true })));
    });
  });

  it('should process a complete conversation flow', async () => {
    // Mock successful AI response
    (mockEnv.AI.run as any).mockResolvedValue({
      response: 'I understand you\'re having trouble accessing your account. Let me help you troubleshoot this issue. Can you tell me what specific error message you\'re seeing?',
      usage: {
        prompt_tokens: 85,
        completion_tokens: 32,
        total_tokens: 117
      }
    });

    const request = new Request('https://test.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'I keep getting locked out of my account',
        sessionId: 'test-session-123'
      })
    });

    const response = await worker.fetch(request, mockEnv, {} as any);
    const result = await response.json() as any;

    // Verify response structure
    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      message: {
        id: expect.stringMatching(/^msg_\d+_[a-z0-9]+$/),
        sessionId: 'test-session-123',
        content: expect.stringContaining('trouble accessing your account'),
        role: 'assistant',
        timestamp: expect.any(Number),
        metadata: {
          toolCalls: []
        }
      },
      sessionId: 'test-session-123',
      model: 'llama-3.3-70b-fp8-fast',
      fallbackUsed: false,
      usage: {
        prompt_tokens: 85,
        completion_tokens: 32,
        total_tokens: 117
      },
      requestId: expect.any(String),
      timestamp: expect.any(Number)
    });

    // Verify AI was called with proper context
    expect(mockEnv.AI.run).toHaveBeenCalledWith('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        {
          role: 'system',
          content: expect.stringContaining('expert AI support assistant')
        },
        {
          role: 'user',
          content: 'I cannot access my account'
        },
        {
          role: 'assistant',
          content: 'I can help you with account access issues'
        },
        {
          role: 'user',
          content: 'I keep getting locked out of my account'
        }
      ],
      max_tokens: expect.any(Number),
      temperature: 0.3,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
      stream: false
    });

    // Verify memory operations
    const addMessageCalls = mockDOStub.fetch.mock.calls.filter((call: any) => 
      call[1]?.body?.includes('"action":"addMessage"')
    );
    expect(addMessageCalls).toHaveLength(2); // User message + Assistant message

    // Verify context retrieval
    const contextCalls = mockDOStub.fetch.mock.calls.filter((call: any) => 
      call[0].includes('action=context')
    );
    expect(contextCalls).toHaveLength(1);
  });

  it('should handle system prompt generation with rich context', async () => {
    // Mock AI response
    (mockEnv.AI.run as any).mockResolvedValue({
      response: 'Based on our previous discussion about billing, I can see you\'ve resolved the password issue. How can I help you today?',
      usage: { prompt_tokens: 120, completion_tokens: 25, total_tokens: 145 }
    });

    // Mock rich context
    mockDOStub.fetch.mockImplementation((url: string) => {
      if (url.includes('action=context')) {
        return Promise.resolve(new Response(JSON.stringify({
          sessionId: 'rich-context-session',
          summary: 'Customer had billing questions and password reset issues. Billing was resolved, password was reset successfully.',
          recentMessages: [
            { role: 'user', content: 'My bill seems wrong' },
            { role: 'assistant', content: 'Let me check your billing details' },
            { role: 'user', content: 'Also I forgot my password' },
            { role: 'assistant', content: 'I\'ve sent you a password reset link' }
          ],
          activeTopics: ['billing', 'authentication'],
          resolvedIssues: ['password-reset', 'billing-inquiry']
        })));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true })));
    });

    const request = new Request('https://test.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Thanks for the help earlier',
        sessionId: 'rich-context-session'
      })
    });

    await worker.fetch(request, mockEnv, {} as any);

    // Verify system prompt includes context
    const systemMessage = (mockEnv.AI.run as any).mock.calls[0][1].messages[0];
    expect(systemMessage.role).toBe('system');
    expect(systemMessage.content).toContain('rich-context-session');
    expect(systemMessage.content).toContain('billing, authentication');
    expect(systemMessage.content).toContain('password-reset, billing-inquiry');
    expect(systemMessage.content).toContain('Customer had billing questions and password reset issues');
  });

  it('should maintain conversation flow across multiple messages', async () => {
    // Simulate multiple message exchanges
    const messages = [
      'I need help with my account',
      'What specific issue are you having?',
      'I can\'t log in',
      'Let me help you reset your password'
    ];

    let currentContext = {
      sessionId: 'flow-test-session',
      summary: '',
      recentMessages: [] as any[],
      activeTopics: [] as string[],
      resolvedIssues: [] as string[]
    };

    for (let i = 0; i < messages.length; i += 2) {
      const userMessage = messages[i];
      const expectedResponse = messages[i + 1];

      // Update context for this iteration
      mockDOStub.fetch.mockImplementation((url: string) => {
        if (url.includes('action=context')) {
          return Promise.resolve(new Response(JSON.stringify(currentContext)));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true })));
      });

      // Mock AI response
      (mockEnv.AI.run as any).mockResolvedValue({
        response: expectedResponse,
        usage: { prompt_tokens: 50, completion_tokens: 15, total_tokens: 65 }
      });

      const request = new Request('https://test.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          sessionId: 'flow-test-session'
        })
      });

      const response = await worker.fetch(request, mockEnv, {} as any);
      const result = await response.json() as any;

      expect(response.status).toBe(200);
      expect(result.message.content).toContain('reset your password');

      // Update context for next iteration
      currentContext.recentMessages.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: expectedResponse }
      );
      currentContext.activeTopics = ['authentication', 'account-management'];
    }

    // Verify the conversation built up properly
    expect(currentContext.recentMessages).toHaveLength(4);
    expect(currentContext.activeTopics).toContain('authentication');
  });

  it('should handle error recovery in the pipeline', async () => {
    // Mock DO failure, then success
    let doCallCount = 0;
    mockDOStub.fetch.mockImplementation(() => {
      doCallCount++;
      if (doCallCount === 1) {
        throw new Error('DO temporarily unavailable');
      }
      if (doCallCount === 2) {
        return Promise.resolve(new Response(JSON.stringify({
          sessionId: 'error-recovery-session',
          summary: 'New session after error',
          recentMessages: [],
          activeTopics: [],
          resolvedIssues: []
        })));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true })));
    });

    // Mock successful AI response
    (mockEnv.AI.run as any).mockResolvedValue({
      response: 'I apologize for the delay. How can I help you?',
      usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 }
    });

    const request = new Request('https://test.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Hello, I need assistance',
        sessionId: 'error-recovery-session'
      })
    });

    const response = await worker.fetch(request, mockEnv, {} as any);

    // Should still fail due to initial DO error
    expect(response.status).toBe(500);
    
    const result = await response.json() as any;
    expect(result.error.code).toBe('CHAT_ERROR');
    expect(result.error.retryable).toBe(true);
  });

  it('should validate message processing with edge cases', async () => {
    // Test with very long message
    const longMessage = 'A'.repeat(10000);
    
    (mockEnv.AI.run as any).mockResolvedValue({
      response: 'I received your message. It\'s quite long, but I can help you.',
      usage: { prompt_tokens: 2500, completion_tokens: 20, total_tokens: 2520 }
    });

    const request = new Request('https://test.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: longMessage,
        sessionId: 'edge-case-session'
      })
    });

    const response = await worker.fetch(request, mockEnv, {} as any);
    const result = await response.json() as any;

    expect(response.status).toBe(200);
    expect(result.message.content).toContain('quite long');
    
    // Verify the long message was properly handled
    const aiCall = (mockEnv.AI.run as any).mock.calls[0][1];
    const userMessage = aiCall.messages.find((msg: any) => msg.content === longMessage);
    expect(userMessage).toBeDefined();
  });
});