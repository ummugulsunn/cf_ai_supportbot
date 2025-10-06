// Unit tests for SessionMemoryDO
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionMemoryDO } from '../workers/do_memory';
import { ChatMessage, SessionState, ConversationMemory } from '../workers/types';
import { DataPersistenceService } from '../workers/data_persistence';

// Mock DurableObjectState
class MockDurableObjectState {
  private storageData = new Map<string, any>();
  
  storage = {
    get: vi.fn(async (key: string) => this.storageData.get(key)),
    put: vi.fn(async (key: string, value: any) => {
      this.storageData.set(key, value);
    }),
    delete: vi.fn(async (key: string) => this.storageData.delete(key)),
    deleteAll: vi.fn(async () => this.storageData.clear()),
    list: vi.fn(async () => new Map(this.storageData))
  };
  
  blockConcurrencyWhile = vi.fn(async (callback: () => Promise<void>) => {
    await callback();
  });
  
  // Helper method to set initial data
  setStorageData(key: string, value: any) {
    this.storageData.set(key, value);
  }
  
  getStorageData(key: string) {
    return this.storageData.get(key);
  }
}

// Mock environment with full WorkerBindings
const mockEnv = {
  AI: {} as any,
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
};

describe('SessionMemoryDO', () => {
  let mockState: MockDurableObjectState;
  let memoryDO: SessionMemoryDO;
  
  beforeEach(() => {
    mockState = new MockDurableObjectState();
    // Create DO instance for testing
    memoryDO = new SessionMemoryDO(mockState as any, mockEnv);
    
    // Set session ID via private property access for testing
    (memoryDO as any).sessionId = 'test-session';
    
    vi.clearAllMocks();
  });

  describe('Session Initialization', () => {
    it('should initialize a new session when none exists', async () => {
      const request = new Request('http://localhost/session/test-session-id?action=session', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;
      
      expect(response.status).toBe(200);
      expect(data.id).toBeDefined();
      expect(data.status).toBe('active');
      expect(data.createdAt).toBeDefined();
      expect(data.lastActivity).toBeDefined();
    });

    it('should return existing session state', async () => {
      const existingSession: SessionState = {
        id: 'test-session',
        status: 'active',
        createdAt: Date.now() - 1000,
        lastActivity: Date.now() - 500
      };
      
      mockState.setStorageData('session', existingSession);
      
      const request = new Request('http://localhost/session/test-session?action=session', {
        method: 'GET'
      });
      
      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;
      
      expect(data.id).toBe('test-session');
      expect(data.status).toBe('active');
    });
  });

  describe('Message Management', () => {
    beforeEach(async () => {
      // Initialize session and memory
      const session: SessionState = {
        id: 'test-session',
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now()
      };
      
      const memory: ConversationMemory = {
        sessionId: 'test-session',
        messages: [],
        summary: '',
        context: {},
        lastSummaryAt: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      
      mockState.setStorageData('session', session);
      mockState.setStorageData('memory', memory);
    });

    it('should add a valid message to conversation history', async () => {
      const message: ChatMessage = {
        id: 'msg-1',
        sessionId: 'test-session',
        content: 'Hello, I need help with my account',
        role: 'user',
        timestamp: Date.now()
      };

      const request = new Request('http://localhost/session/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          message: message
        })
      });

      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify message was stored
      const memory = mockState.getStorageData('memory') as ConversationMemory;
      expect(memory.messages).toHaveLength(1);
      expect(memory.messages[0]?.content).toBe('Hello, I need help with my account');
    });

    it('should generate message ID if not provided', async () => {
      const message = {
        sessionId: 'test-session',
        content: 'Test message without ID',
        role: 'user' as const,
        timestamp: Date.now()
      };

      const request = new Request('http://localhost/session/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          message: message
        })
      });

      const response = await memoryDO.fetch(request);
      expect(response.status).toBe(200);

      const memory = mockState.getStorageData('memory') as ConversationMemory;
      expect(memory.messages).toHaveLength(1);
      expect(memory.messages[0]?.id).toBeDefined();
      expect(memory.messages[0]?.id).toMatch(/^msg_/);
    });

    it('should retrieve recent messages with limit', async () => {
      // Add multiple messages
      const memory = mockState.getStorageData('memory') as ConversationMemory;
      for (let i = 0; i < 15; i++) {
        memory.messages.push({
          id: `msg-${i}`,
          sessionId: 'test-session',
          content: `Message ${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          timestamp: Date.now() + i
        });
      }
      mockState.setStorageData('memory', memory);

      const request = new Request('http://localhost/session/test-session?action=messages&limit=5', {
        method: 'GET'
      });

      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.messages).toHaveLength(5);
      expect(data.messages[4]?.content).toBe('Message 14'); // Last message
    });
  });

  describe('Context Management', () => {
    let testMessages: ChatMessage[];
    
    beforeEach(async () => {
      const session: SessionState = {
        id: 'test-session',
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now()
      };
      
      testMessages = [
        {
          id: 'msg-1',
          sessionId: 'test-session',
          content: 'I forgot my password',
          role: 'user',
          timestamp: Date.now()
        },
        {
          id: 'msg-2',
          sessionId: 'test-session',
          content: 'I can help you reset your password',
          role: 'assistant',
          timestamp: Date.now() + 1000
        },
        {
          id: 'msg-3',
          sessionId: 'test-session',
          content: 'I also have a billing question',
          role: 'user',
          timestamp: Date.now() + 2000
        }
      ];
      
      const memory: ConversationMemory = {
        sessionId: 'test-session',
        messages: testMessages,
        summary: 'User asking about password reset',
        context: { resolvedIssues: ['login-help'] },
        lastSummaryAt: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      
      mockState.setStorageData('session', session);
      mockState.setStorageData('memory', memory);
    });

    it('should return conversation context with topics', async () => {
      const request = new Request('http://localhost/session/test-session?action=context', {
        method: 'GET'
      });

      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.sessionId).toBe('test-session');
      expect(data.summary).toBe('User asking about password reset');
      expect(data.recentMessages).toHaveLength(3);
      expect(data.activeTopics).toContain('authentication');
      expect(data.activeTopics).toContain('billing');
      expect(data.resolvedIssues).toContain('login-help');
    });

    it('should generate summary of conversation', async () => {
      // Ensure sessionId is set correctly
      (memoryDO as any).sessionId = 'test-session';
      
      // Set up memory with messages for this specific test
      const testMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          sessionId: 'test-session',
          content: 'I need help with password reset',
          role: 'user',
          timestamp: Date.now()
        },
        {
          id: 'msg-2',
          sessionId: 'test-session',
          content: 'I can help you with that',
          role: 'assistant',
          timestamp: Date.now() + 1000
        },
        {
          id: 'msg-3',
          sessionId: 'test-session',
          content: 'I also have a billing question',
          role: 'user',
          timestamp: Date.now() + 2000
        }
      ];
      
      const memory: ConversationMemory = {
        sessionId: 'test-session',
        messages: testMessages,
        summary: '',
        context: {},
        lastSummaryAt: Date.now() - 20 * 60 * 1000, // 20 minutes ago to trigger summary
        ttl: 24 * 60 * 60 * 1000
      };
      
      await mockState.storage.put('memory', memory);
      
      const request = new Request('http://localhost/session/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generateSummary'
        })
      });

      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.summary).toContain('2 user messages');
      expect(data.summary).toContain('1 assistant responses');
      expect(data.summary).toContain('authentication, billing');
    });
  });

  describe('Memory Optimization', () => {
    it('should trim messages when exceeding maximum', async () => {
      const session: SessionState = {
        id: 'test-session',
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now()
      };
      
      // Create memory with messages at the limit
      const messages: ChatMessage[] = [];
      for (let i = 0; i < 100; i++) { // At MAX_MESSAGES (100)
        messages.push({
          id: `msg-${i}`,
          sessionId: 'test-session',
          content: `Message ${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          timestamp: Date.now() + i
        });
      }
      
      const memory: ConversationMemory = {
        sessionId: 'test-session',
        messages: messages,
        summary: '',
        context: {},
        lastSummaryAt: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      
      // Set up the storage data properly
      await mockState.storage.put('session', session);
      await mockState.storage.put('memory', memory);

      // Add one more message to trigger trimming
      const newMessage: ChatMessage = {
        id: 'msg-new',
        sessionId: 'test-session',
        content: 'New message',
        role: 'user',
        timestamp: Date.now() + 1000
      };

      const request = new Request('http://localhost/session/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          message: newMessage
        })
      });

      const response = await memoryDO.fetch(request);
      expect(response.status).toBe(200);

      const updatedMemory = await mockState.storage.get('memory') as ConversationMemory;
      expect(updatedMemory.messages).toHaveLength(100); // Should be trimmed to MAX_MESSAGES
      expect(updatedMemory.messages[99]?.id).toBe('msg-new'); // New message should be last
    });
  });

  describe('TTL and Cleanup', () => {
    it('should clean up expired sessions', async () => {
      const expiredTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      
      const session: SessionState = {
        id: 'test-session',
        status: 'active',
        createdAt: expiredTime,
        lastActivity: expiredTime
      };
      
      const memory: ConversationMemory = {
        sessionId: 'test-session',
        messages: [{
          id: 'msg-1',
          sessionId: 'test-session',
          content: 'Old message',
          role: 'user',
          timestamp: expiredTime
        }],
        summary: 'Old conversation',
        context: {},
        lastSummaryAt: expiredTime,
        ttl: 24 * 60 * 60 * 1000 // 24 hours
      };
      
      mockState.setStorageData('session', session);
      mockState.setStorageData('memory', memory);

      const request = new Request('http://localhost/session/test-session', {
        method: 'DELETE'
      });

      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify session was marked as ended
      const updatedSession = mockState.getStorageData('session') as SessionState;
      expect(updatedSession.status).toBe('ended');
    });

    it('should not clean up active sessions', async () => {
      const recentTime = Date.now() - (1 * 60 * 60 * 1000); // 1 hour ago
      
      const session: SessionState = {
        id: 'test-session',
        status: 'active',
        createdAt: recentTime,
        lastActivity: recentTime
      };
      
      const memory: ConversationMemory = {
        sessionId: 'test-session',
        messages: [],
        summary: '',
        context: {},
        lastSummaryAt: recentTime,
        ttl: 24 * 60 * 60 * 1000
      };
      
      mockState.setStorageData('session', session);
      mockState.setStorageData('memory', memory);

      const request = new Request('http://localhost/session/test-session', {
        method: 'DELETE'
      });

      await memoryDO.fetch(request);

      const updatedSession = mockState.getStorageData('session') as SessionState;
      expect(updatedSession.status).toBe('active'); // Should remain active
    });
  });

  describe('Data Persistence Integration', () => {
    beforeEach(async () => {
      const session: SessionState = {
        id: 'test-session',
        status: 'active',
        createdAt: Date.now(),
        lastActivity: Date.now()
      };
      
      const memory: ConversationMemory = {
        sessionId: 'test-session',
        messages: [
          {
            id: 'msg-1',
            sessionId: 'test-session',
            content: 'Test message for archiving',
            role: 'user',
            timestamp: Date.now()
          }
        ],
        summary: 'Test conversation',
        context: {},
        lastSummaryAt: Date.now(),
        ttl: 24 * 60 * 60 * 1000
      };
      
      mockState.setStorageData('session', session);
      mockState.setStorageData('memory', memory);
    });

    it('should archive session conversation', async () => {
      // Mock successful archiving
      mockEnv.ARCHIVE_R2.put.mockResolvedValue(undefined);
      mockEnv.CHAT_KV.put.mockResolvedValue(undefined);

      const request = new Request('http://localhost/session/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'archiveSession'
        })
      });

      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.archiveKey).toBeDefined();
      expect(data.archiveKey).toContain('conversations/');
      expect(mockEnv.ARCHIVE_R2.put).toHaveBeenCalled();
      expect(mockEnv.CHAT_KV.put).toHaveBeenCalled();
    });

    it('should restore session from archive', async () => {
      const archivedMemory: ConversationMemory = {
        sessionId: 'archived-session',
        messages: [
          {
            id: 'archived-msg-1',
            sessionId: 'archived-session',
            content: 'Archived message',
            role: 'user',
            timestamp: Date.now() - 1000
          }
        ],
        summary: 'Archived conversation',
        context: {},
        lastSummaryAt: Date.now() - 1000,
        ttl: 24 * 60 * 60 * 1000
      };

      // Mock successful retrieval
      mockEnv.CHAT_KV.get.mockResolvedValue(JSON.stringify({
        sessionId: 'archived-session',
        archivedAt: Date.now() - 1000,
        messageCount: 1
      }));
      
      mockEnv.ARCHIVE_R2.get.mockResolvedValue({
        text: async () => JSON.stringify({
          conversation: archivedMemory
        })
      });

      const request = new Request('http://localhost/session/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restoreSession',
          sessionId: 'archived-session'
        })
      });

      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.restored).toBe(true);
    });

    it('should list archived conversations', async () => {
      const mockArchives = [
        {
          sessionId: 'session-1',
          archivedAt: Date.now() - 1000,
          messageCount: 5,
          summary: 'First conversation'
        },
        {
          sessionId: 'session-2',
          archivedAt: Date.now() - 2000,
          messageCount: 3,
          summary: 'Second conversation'
        }
      ];

      mockEnv.CHAT_KV.list.mockResolvedValue({
        keys: [
          { name: 'archive_meta:session-1' },
          { name: 'archive_meta:session-2' }
        ]
      });

      mockEnv.CHAT_KV.get
        .mockResolvedValueOnce(JSON.stringify(mockArchives[0]))
        .mockResolvedValueOnce(JSON.stringify(mockArchives[1]));

      const request = new Request('http://localhost/session/test-session?action=archives&limit=10', {
        method: 'GET'
      });

      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.archives).toHaveLength(2);
      expect(data.archives[0]?.sessionId).toBe('session-1');
      expect(data.archives[1]?.sessionId).toBe('session-2');
    });

    it('should handle archiving errors gracefully', async () => {
      // Mock archiving failure
      mockEnv.ARCHIVE_R2.put.mockRejectedValue(new Error('R2 storage error'));

      const request = new Request('http://localhost/session/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'archiveSession'
        })
      });

      const response = await memoryDO.fetch(request);

      expect(response.status).toBe(500);
      
      const data = await response.json() as any;
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle restore when archive does not exist', async () => {
      // Mock no archive found
      mockEnv.CHAT_KV.get.mockResolvedValue(null);

      const request = new Request('http://localhost/session/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restoreSession',
          sessionId: 'non-existent-session'
        })
      });

      const response = await memoryDO.fetch(request);
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.restored).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid message format', async () => {
      const invalidMessage = {
        content: 'Missing required fields',
        // Missing sessionId, role, timestamp
      };

      const request = new Request('http://localhost/session/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addMessage',
          message: invalidMessage
        })
      });

      const response = await memoryDO.fetch(request);
      
      expect(response.status).toBe(500);
      
      const data = await response.json() as any;
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });

    it('should handle unsupported HTTP methods', async () => {
      const request = new Request('http://localhost/session/test-session', {
        method: 'PATCH'
      });

      const response = await memoryDO.fetch(request);
      
      expect(response.status).toBe(405);
      expect(await response.text()).toBe('Method not allowed');
    });

    it('should handle invalid actions', async () => {
      const request = new Request('http://localhost/session/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'invalidAction'
        })
      });

      const response = await memoryDO.fetch(request);
      
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Invalid action');
    });
  });
});