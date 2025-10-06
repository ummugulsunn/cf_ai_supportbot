// Integration tests for end-to-end conversation flows
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionMemoryDO } from '../../workers/do_memory';
import { ToolRouter } from '../../workers/tools';
import { WorkflowService } from '../../workers/workflow_service';
import { KnowledgeBaseTool } from '../../workers/knowledge_base_tool';
import { TicketingTool } from '../../workers/ticketing_tool';
import { ChatMessage, ConversationContext, WorkerBindings } from '../../workers/types';

// Mock environment for integration testing
const createMockEnv = (): WorkerBindings => ({
  AI: {
    run: vi.fn().mockResolvedValue({
      response: 'AI response based on conversation context',
      usage: { total_tokens: 150 }
    })
  } as any,
  MEMORY_DO: {} as any,
  WORKFLOWS: {} as any,
  CHAT_KV: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn()
  } as any,
  ARCHIVE_R2: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn()
  } as any
});

// Mock Durable Object state for integration testing
class IntegrationMockDOState {
  private dataMap = new Map<string, any>();
  
  storage = {
    get: vi.fn(async (key: string) => this.dataMap.get(key)),
    put: vi.fn(async (key: string, value: any) => {
      this.dataMap.set(key, value);
    }),
    delete: vi.fn(async (key: string) => this.dataMap.delete(key)),
    deleteAll: vi.fn(async () => this.dataMap.clear()),
    list: vi.fn(async () => new Map(this.dataMap))
  };
  
  blockConcurrencyWhile = vi.fn(async (callback: () => Promise<void>) => {
    await callback();
  });
  
  setData(key: string, value: any) {
    this.dataMap.set(key, value);
  }
  
  getData(key: string) {
    return this.dataMap.get(key);
  }
}

describe('End-to-End Conversation Flows', () => {
  let mockEnv: WorkerBindings;
  let mockState: IntegrationMockDOState;
  let memoryDO: SessionMemoryDO;
  let toolRouter: ToolRouter;
  let workflowService: WorkflowService;
  let sessionId: string;

  beforeEach(async () => {
    mockEnv = createMockEnv();
    mockState = new IntegrationMockDOState();
    sessionId = `integration_test_${Date.now()}`;
    
    // Initialize Durable Object
    memoryDO = new SessionMemoryDO(mockState as any, mockEnv);
    (memoryDO as any).sessionId = sessionId;
    
    // Initialize tool router with tools
    toolRouter = new ToolRouter();
    toolRouter.registerTool(new KnowledgeBaseTool());
    toolRouter.registerTool(new TicketingTool());
    
    // Initialize workflow service
    workflowService = new WorkflowService(mockEnv);
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Simple Question-Answer Flow', () => {
    it('should handle a basic support question with context retention', async () => {
      // Step 1: Initialize session
      const initRequest = new Request(`http://localhost/session/${sessionId}?action=session`, {
        method: 'GET'
      });
      
      const initResponse = await memoryDO.fetch(initRequest);
      expect(initResponse.status).toBe(200);
      
      const sessionData = await initResponse.json();
      expect((sessionData as any).id).toBeDefined();
      expect((sessionData as any).status).toBe('active');

      // Step 2: User asks initial question
      const userMessage: ChatMessage = {
        id: 'msg_1',
        sessionId,
        content: 'I forgot my password and cannot log into my account',
        role: 'user',
        timestamp: Date.now()
      };

      const addMessageRequest = new Request(`http://localhost/session/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          message: userMessage
        })
      });

      const addResponse = await memoryDO.fetch(addMessageRequest);
      expect(addResponse.status).toBe(200);

      // Step 3: Get conversation context
      const contextRequest = new Request(`http://localhost/session/${sessionId}?action=context`, {
        method: 'GET'
      });

      const contextResponse = await memoryDO.fetch(contextRequest);
      const context = await contextResponse.json() as ConversationContext;
      
      expect(context.sessionId).toBe(sessionId);
      expect(context.recentMessages).toHaveLength(1);
      expect(context.activeTopics).toContain('authentication');

      // Step 4: AI processes with context and responds
      const aiResponse: ChatMessage = {
        id: 'msg_2',
        sessionId,
        content: 'I can help you reset your password. Let me search our knowledge base for the password reset procedure.',
        role: 'assistant',
        timestamp: Date.now() + 1000,
        metadata: {
          toolCalls: [{
            id: 'tool_1',
            name: 'kb.search',
            parameters: { query: 'password reset procedure' }
          }]
        }
      };

      const aiMessageRequest = new Request(`http://localhost/session/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          message: aiResponse
        })
      });

      const aiAddResponse = await memoryDO.fetch(aiMessageRequest);
      expect(aiAddResponse.status).toBe(200);

      // Step 5: Verify context is maintained
      const finalContextRequest = new Request(`http://localhost/session/${sessionId}?action=context`, {
        method: 'GET'
      });

      const finalContextResponse = await memoryDO.fetch(finalContextRequest);
      const finalContext = await finalContextResponse.json() as ConversationContext;
      
      expect(finalContext.recentMessages).toHaveLength(2);
      expect(finalContext.activeTopics).toContain('authentication');
      expect(finalContext.summary).toContain('password');
    });
  });

  describe('Multi-Tool Workflow Integration', () => {
    it('should execute knowledge base search followed by ticket creation', async () => {
      // Initialize session with existing context
      const existingContext: ConversationContext = {
        sessionId,
        summary: 'User needs help with complex billing issue',
        recentMessages: [],
        activeTopics: ['billing', 'technical'],
        resolvedIssues: []
      };

      mockState.setData('session', {
        id: sessionId,
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now()
      });

      mockState.setData('memory', {
        sessionId,
        messages: [],
        summary: existingContext.summary,
        context: { activeTopics: existingContext.activeTopics },
        lastSummaryAt: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      });

      // Mock knowledge base search result
      vi.mocked(mockEnv.AI.run).mockResolvedValueOnce({
        response: JSON.stringify({
          results: [
            {
              title: 'Billing Issue Resolution',
              content: 'For complex billing issues, create a support ticket',
              relevance: 0.95
            }
          ]
        }),
        usage: { total_tokens: 100 }
      });

      // Mock ticket creation
      vi.mocked(mockEnv.AI.run).mockResolvedValueOnce({
        response: JSON.stringify({
          ticketId: 'TICKET-12345',
          status: 'created',
          priority: 'high'
        }),
        usage: { total_tokens: 80 }
      });

      // Execute tool chain workflow
      const toolCalls = [
        {
          id: 'search_1',
          name: 'kb.search',
          parameters: { query: 'complex billing issue resolution' }
        },
        {
          id: 'ticket_1',
          name: 'create_ticket',
          parameters: {
            title: 'Complex Billing Issue',
            description: 'User experiencing complex billing problem',
            priority: 'high',
            category: 'billing'
          }
        }
      ];

      const workflowResult = await workflowService.executeToolChain(toolCalls);
      
      expect(workflowResult.success).toBe(true);
      expect(workflowResult.executionId).toBeDefined();
      expect(mockEnv.AI.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('Complex Query Processing', () => {
    it('should handle multi-intent queries with workflow orchestration', async () => {
      const complexQuery = 'I need help with my account settings, billing information, and I think there might be a security issue';
      
      // Mock AI analysis response
      vi.mocked(mockEnv.AI.run).mockResolvedValueOnce({
        response: JSON.stringify({
          intents: ['account_management', 'billing_inquiry', 'security_concern'],
          priority: 'high',
          requiresEscalation: true,
          suggestedActions: ['kb_search', 'create_ticket', 'security_check']
        }),
        usage: { total_tokens: 200 }
      });

      // Mock subsequent AI calls for each intent
      vi.mocked(mockEnv.AI.run)
        .mockResolvedValueOnce({ response: 'Account settings help response', usage: { total_tokens: 100 } })
        .mockResolvedValueOnce({ response: 'Billing information response', usage: { total_tokens: 100 } })
        .mockResolvedValueOnce({ response: 'Security issue escalation response', usage: { total_tokens: 100 } });

      const context: ConversationContext = {
        sessionId,
        summary: '',
        recentMessages: [],
        activeTopics: [],
        resolvedIssues: []
      };

      const result = await workflowService.processComplexQuery(complexQuery, context);
      
      expect(result.success).toBe(true);
      expect(result.executionId).toBeDefined();
      expect(result.metadata.stepsCompleted).toBeGreaterThan(0);
      
      // Verify AI was called for analysis and processing
      expect(mockEnv.AI.run).toHaveBeenCalled();
    });
  });

  describe('Session Memory and Archival Flow', () => {
    it('should archive conversation and restore from archive', async () => {
      // Setup session with conversation history
      const messages: ChatMessage[] = [
        {
          id: 'msg_1',
          sessionId,
          content: 'I need help with my account',
          role: 'user',
          timestamp: Date.now() - 3000
        },
        {
          id: 'msg_2',
          sessionId,
          content: 'I can help you with that. What specific issue are you having?',
          role: 'assistant',
          timestamp: Date.now() - 2000
        },
        {
          id: 'msg_3',
          sessionId,
          content: 'I cannot access my billing information',
          role: 'user',
          timestamp: Date.now() - 1000
        }
      ];

      mockState.setData('session', {
        id: sessionId,
        status: 'active',
        createdAt: Date.now() - 5000,
        lastActivity: Date.now() - 1000
      });

      mockState.setData('memory', {
        sessionId,
        messages,
        summary: 'User needs help with billing access',
        context: { activeTopics: ['billing', 'account'] },
        lastSummaryAt: Date.now() - 2000,
        ttl: 24 * 60 * 60 * 1000
      });

      // Mock successful archiving
      vi.mocked(mockEnv.ARCHIVE_R2.put).mockResolvedValue(undefined as any);
      vi.mocked(mockEnv.CHAT_KV.put).mockResolvedValue(undefined);

      // Archive the session
      const archiveRequest = new Request(`http://localhost/session/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'archiveSession'
        })
      });

      const archiveResponse = await memoryDO.fetch(archiveRequest);
      const archiveResult = await archiveResponse.json() as any;
      
      expect(archiveResponse.status).toBe(200);
      expect(archiveResult.archiveKey).toBeDefined();
      expect(mockEnv.ARCHIVE_R2.put).toHaveBeenCalled();
      expect(mockEnv.CHAT_KV.put).toHaveBeenCalled();

      // Mock restoration
      const archivedData = {
        conversation: {
          sessionId,
          messages,
          summary: 'User needs help with billing access',
          context: { activeTopics: ['billing', 'account'] },
          lastSummaryAt: Date.now() - 2000,
          ttl: 24 * 60 * 60 * 1000
        }
      };

      vi.mocked(mockEnv.CHAT_KV.get).mockResolvedValue(JSON.stringify({
        sessionId,
        archivedAt: Date.now() - 1000,
        messageCount: 3
      }) as any);

      vi.mocked(mockEnv.ARCHIVE_R2.get).mockResolvedValue({
        text: async () => JSON.stringify(archivedData)
      } as any);

      // Restore the session
      const restoreRequest = new Request(`http://localhost/session/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restoreSession',
          sessionId
        })
      });

      const restoreResponse = await memoryDO.fetch(restoreRequest);
      const restoreResult = await restoreResponse.json() as any;
      
      expect(restoreResponse.status).toBe(200);
      expect(restoreResult.restored).toBe(true);
      expect(mockEnv.CHAT_KV.get).toHaveBeenCalled();
      expect(mockEnv.ARCHIVE_R2.get).toHaveBeenCalled();
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle AI service failures gracefully', async () => {
      // Mock AI service failure
      vi.mocked(mockEnv.AI.run).mockRejectedValue(new Error('AI service temporarily unavailable'));

      const context: ConversationContext = {
        sessionId,
        summary: '',
        recentMessages: [],
        activeTopics: [],
        resolvedIssues: []
      };

      // Should handle the error gracefully
      await expect(workflowService.processComplexQuery('test query', context))
        .rejects.toThrow('AI service temporarily unavailable');
    });

    it('should handle storage failures during conversation', async () => {
      // Mock storage failure
      vi.mocked(mockState.storage.put).mockRejectedValue(new Error('Storage unavailable'));

      const message: ChatMessage = {
        id: 'msg_fail',
        sessionId,
        content: 'Test message during storage failure',
        role: 'user',
        timestamp: Date.now()
      };

      const request = new Request(`http://localhost/session/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          message
        })
      });

      const response = await memoryDO.fetch(request);
      
      // Should return error status
      expect(response.status).toBe(500);
    });

    it('should handle tool execution failures with fallback', async () => {
      // Mock tool failure
      const failingTool = {
        name: 'failing_tool',
        description: 'A tool that fails',
        parameters: {},
        execute: vi.fn().mockRejectedValue(new Error('Tool execution failed'))
      };

      toolRouter.registerTool(failingTool);

      const toolContext = {
        sessionId,
        bindings: mockEnv
      };

      const result = await toolRouter.executeTool('failing_tool', {}, toolContext);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool execution failed');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large conversation histories efficiently', async () => {
      // Create a large conversation history
      const largeMessageHistory: ChatMessage[] = [];
      for (let i = 0; i < 150; i++) { // Exceeds MAX_MESSAGES (100)
        largeMessageHistory.push({
          id: `msg_${i}`,
          sessionId,
          content: `Message ${i} in a long conversation`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          timestamp: Date.now() + i * 1000
        });
      }

      mockState.setData('session', {
        id: sessionId,
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now()
      });

      mockState.setData('memory', {
        sessionId,
        messages: largeMessageHistory,
        summary: 'Long conversation with many messages',
        context: {},
        lastSummaryAt: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      });

      // Add one more message to trigger trimming
      const newMessage: ChatMessage = {
        id: 'msg_new',
        sessionId,
        content: 'New message that should trigger trimming',
        role: 'user',
        timestamp: Date.now() + 200000
      };

      const request = new Request(`http://localhost/session/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          message: newMessage
        })
      });

      const startTime = Date.now();
      const response = await memoryDO.fetch(request);
      const endTime = Date.now();
      
      expect(response.status).toBe(200);
      
      // Should complete within reasonable time (< 1 second)
      expect(endTime - startTime).toBeLessThan(1000);
      
      // Verify trimming occurred
      const memory = mockState.getData('memory');
      expect(memory.messages).toHaveLength(100); // Should be trimmed to MAX_MESSAGES
    });

    it('should handle concurrent message additions', async () => {
      mockState.setData('session', {
        id: sessionId,
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now()
      });

      mockState.setData('memory', {
        sessionId,
        messages: [],
        summary: '',
        context: {},
        lastSummaryAt: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      });

      // Simulate concurrent message additions
      const concurrentMessages = Array.from({ length: 10 }, (_, i) => ({
        id: `concurrent_msg_${i}`,
        sessionId,
        content: `Concurrent message ${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant' as const,
        timestamp: Date.now() + i
      }));

      const requests = concurrentMessages.map(message => 
        new Request(`http://localhost/session/${sessionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'addMessage',
            message
          })
        })
      );

      // Execute all requests concurrently
      const responses = await Promise.all(
        requests.map(request => memoryDO.fetch(request))
      );

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Verify all messages were added
      const memory = mockState.getData('memory');
      expect(memory.messages).toHaveLength(10);
    });
  });
});