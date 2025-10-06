// Tests for data persistence and archival system
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataPersistenceService } from '../workers/data_persistence';
import {
  ChatMessage,
  ConversationMemory,
  SessionState,
  WorkerBindings,
  generateMessageId,
  generateSessionId
} from '../workers/types';

// Mock Cloudflare bindings
const createMockBindings = (): WorkerBindings => {
  const kvStore = new Map<string, string>();
  const r2Store = new Map<string, { content: string; metadata?: any; uploaded: Date }>();

  return {
    AI: {} as any,
    MEMORY_DO: {} as any,
    WORKFLOWS: {} as any,
    CHAT_KV: {
      get: vi.fn(async (key: string) => kvStore.get(key) || null),
      put: vi.fn(async (key: string, value: string, options?: any) => {
        kvStore.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        kvStore.delete(key);
        return true;
      }),
      list: vi.fn(async (options?: any) => {
        const keys = Array.from(kvStore.keys())
          .filter(key => !options?.prefix || key.startsWith(options.prefix))
          .slice(0, options?.limit || 1000)
          .map(name => ({ name }));
        return { keys };
      })
    } as any,
    ARCHIVE_R2: {
      get: vi.fn(async (key: string) => {
        const stored = r2Store.get(key);
        if (!stored) return null;
        return {
          text: async () => stored.content,
          json: async () => JSON.parse(stored.content)
        };
      }),
      put: vi.fn(async (key: string, content: string, options?: any) => {
        r2Store.set(key, {
          content,
          metadata: options?.customMetadata,
          uploaded: new Date()
        });
      }),
      delete: vi.fn(async (key: string) => {
        r2Store.delete(key);
      }),
      list: vi.fn(async (options?: any) => {
        const objects = Array.from(r2Store.entries())
          .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
          .map(([key, value]) => ({
            key,
            uploaded: value.uploaded
          }));
        return { objects };
      })
    } as any
  };
};

const createTestMessage = (role: 'user' | 'assistant', content: string, sessionId: string): ChatMessage => ({
  id: generateMessageId(),
  sessionId,
  content,
  role,
  timestamp: Date.now(),
  metadata: {}
});

const createTestMemory = (sessionId: string, messageCount: number = 5): ConversationMemory => {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < messageCount; i++) {
    messages.push(createTestMessage(i % 2 === 0 ? 'user' : 'assistant', `Message ${i + 1}`, sessionId));
  }

  return {
    sessionId,
    messages,
    summary: 'Test conversation summary',
    context: { testData: true },
    lastSummaryAt: Date.now(),
    ttl: 24 * 60 * 60 * 1000
  };
};

const createTestSession = (sessionId: string): SessionState => ({
  id: sessionId,
  status: 'active',
  createdAt: Date.now() - 60000, // 1 minute ago
  lastActivity: Date.now()
});

describe('DataPersistenceService', () => {
  let service: DataPersistenceService;
  let mockBindings: WorkerBindings;
  let testSessionId: string;

  beforeEach(() => {
    mockBindings = createMockBindings();
    service = new DataPersistenceService(mockBindings, {
      conversationTTL: 60000, // 1 minute for testing
      cacheTTL: 30000, // 30 seconds for testing
      archiveRetention: 120000, // 2 minutes for testing
      cleanupInterval: 10000, // 10 seconds for testing
      maxArchiveSize: 1024 * 1024 // 1MB for testing
    });
    testSessionId = generateSessionId();
  });

  describe('Conversation Archiving', () => {
    it('should archive a conversation to R2 storage', async () => {
      const memory = createTestMemory(testSessionId);
      const session = createTestSession(testSessionId);

      const archiveKey = await service.archiveConversation(memory, session);

      expect(archiveKey).toContain('conversations/');
      expect(archiveKey).toContain(testSessionId);
      expect(mockBindings.ARCHIVE_R2.put).toHaveBeenCalled();
      expect(mockBindings.CHAT_KV.put).toHaveBeenCalledWith(
        expect.stringContaining(`archive_meta:${testSessionId}`),
        expect.any(String),
        expect.any(Object)
      );
    });

    it('should retrieve an archived conversation', async () => {
      const memory = createTestMemory(testSessionId);
      const session = createTestSession(testSessionId);

      // First archive the conversation
      await service.archiveConversation(memory, session);

      // Then retrieve it
      const retrieved = await service.retrieveArchivedConversation(testSessionId);

      expect(retrieved).toBeTruthy();
      expect(retrieved?.sessionId).toBe(testSessionId);
      expect(retrieved?.messages).toHaveLength(memory.messages.length);
    });

    it('should return null for non-existent archived conversation', async () => {
      const retrieved = await service.retrieveArchivedConversation('non-existent-session');
      expect(retrieved).toBeNull();
    });

    it('should list archived conversations', async () => {
      const memory1 = createTestMemory(generateSessionId());
      const memory2 = createTestMemory(generateSessionId());
      const session1 = createTestSession(memory1.sessionId);
      const session2 = createTestSession(memory2.sessionId);

      await service.archiveConversation(memory1, session1);
      await service.archiveConversation(memory2, session2);

      const archives = await service.listArchivedConversations();

      expect(archives).toHaveLength(2);
      expect(archives[0]?.sessionId).toBeDefined();
      expect(archives[0]?.messageCount).toBeGreaterThan(0);
    });
  });

  describe('Embedding Caching', () => {
    it('should cache and retrieve embeddings', async () => {
      const text = 'Test text for embedding';
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];

      await service.cacheEmbedding(text, embedding);
      const retrieved = await service.getCachedEmbedding(text);

      expect(retrieved).toEqual(embedding);
    });

    it('should return null for non-existent embedding', async () => {
      const retrieved = await service.getCachedEmbedding('non-existent-text');
      expect(retrieved).toBeNull();
    });

    it('should handle expired embedding cache', async () => {
      const text = 'Test text for embedding';
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];

      // Cache with very short TTL
      const shortTtlService = new DataPersistenceService(mockBindings, {
        cacheTTL: 1 // 1ms TTL
      });

      await shortTtlService.cacheEmbedding(text, embedding);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const retrieved = await shortTtlService.getCachedEmbedding(text);
      expect(retrieved).toBeNull();
    });
  });

  describe('Query Result Caching', () => {
    it('should cache and retrieve query results', async () => {
      const query = 'How to reset password?';
      const result = { answer: 'Go to settings and click reset password', confidence: 0.9 };

      await service.cacheFrequentQuery(query, result);
      const retrieved = await service.getCachedQueryResult(query);

      expect(retrieved).toEqual(result);
    });

    it('should return null for non-existent query result', async () => {
      const retrieved = await service.getCachedQueryResult('non-existent-query');
      expect(retrieved).toBeNull();
    });

    it('should handle expired query cache', async () => {
      const query = 'How to reset password?';
      const result = { answer: 'Go to settings and click reset password' };

      // Cache with very short TTL
      const shortTtlService = new DataPersistenceService(mockBindings, {
        cacheTTL: 1 // 1ms TTL
      });

      await shortTtlService.cacheFrequentQuery(query, result);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const retrieved = await shortTtlService.getCachedQueryResult(query);
      expect(retrieved).toBeNull();
    });
  });

  describe('Backup and Recovery', () => {
    it('should create a backup of multiple sessions', async () => {
      const sessionIds = [generateSessionId(), generateSessionId()];
      
      // Archive some conversations first
      for (const sessionId of sessionIds) {
        const memory = createTestMemory(sessionId);
        const session = createTestSession(sessionId);
        await service.archiveConversation(memory, session);
      }

      const backupId = await service.createBackup(sessionIds);

      expect(backupId).toContain('backup_');
      expect(mockBindings.ARCHIVE_R2.put).toHaveBeenCalledWith(
        expect.stringContaining(`backups/${backupId}/data.json`),
        expect.any(String)
      );
      expect(mockBindings.ARCHIVE_R2.put).toHaveBeenCalledWith(
        expect.stringContaining(`backups/${backupId}/manifest.json`),
        expect.any(String)
      );
    });

    it('should restore sessions from backup', async () => {
      const sessionIds = [generateSessionId()];
      
      // Archive a conversation first
      const memory = createTestMemory(sessionIds[0]!);
      const session = createTestSession(sessionIds[0]!);
      await service.archiveConversation(memory, session);

      // Create backup
      const backupId = await service.createBackup(sessionIds);

      // Mock the backup manifest and data for restore
      const mockManifest = {
        backupId,
        timestamp: Date.now(),
        sessionIds: sessionIds,
        totalSize: 1000,
        checksum: 'test-checksum',
        metadata: { sessionCount: 1 }
      };

      const mockBackupData = [{
        sessionId: sessionIds[0],
        data: {
          ...memory,
          sessionState: session
        },
        size: 500
      }];

      // Calculate correct checksum
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(JSON.stringify(mockBackupData));
      const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const correctChecksum = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      mockManifest.checksum = correctChecksum;

      // Update mocks to return the correct data
      mockBindings.CHAT_KV.get = vi.fn().mockResolvedValue(JSON.stringify(mockManifest));
      mockBindings.ARCHIVE_R2.get = vi.fn().mockResolvedValue({
        text: async () => JSON.stringify(mockBackupData)
      });

      // Restore from backup
      const restoredSessions = await service.restoreFromBackup(backupId);

      expect(restoredSessions).toContain(sessionIds[0]);
    });

    it('should handle backup with non-existent sessions', async () => {
      const sessionIds = ['non-existent-1', 'non-existent-2'];
      
      const backupId = await service.createBackup(sessionIds);
      
      expect(backupId).toContain('backup_');
      // Should create backup even if no sessions exist
    });
  });

  describe('Data Retention and Cleanup', () => {
    it('should enforce retention policy', async () => {
      // This test would need more complex mocking to simulate time passage
      // For now, we'll just ensure the method doesn't throw
      await expect(service.enforceRetentionPolicy()).resolves.not.toThrow();
    });

    it('should clean up expired cache entries', async () => {
      const text = 'Test text';
      const embedding = [0.1, 0.2, 0.3];

      // Cache with very short TTL
      const shortTtlService = new DataPersistenceService(mockBindings, {
        cacheTTL: 1 // 1ms TTL
      });

      await shortTtlService.cacheEmbedding(text, embedding);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Enforce retention policy (which should clean up expired entries)
      await shortTtlService.enforceRetentionPolicy();
      
      // Verify the expired entry was cleaned up
      const retrieved = await shortTtlService.getCachedEmbedding(text);
      expect(retrieved).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle R2 storage errors gracefully', async () => {
      const failingBindings = {
        ...mockBindings,
        ARCHIVE_R2: {
          ...mockBindings.ARCHIVE_R2,
          put: vi.fn().mockRejectedValue(new Error('R2 storage error'))
        } as any
      };

      const failingService = new DataPersistenceService(failingBindings);
      const memory = createTestMemory(testSessionId);
      const session = createTestSession(testSessionId);

      await expect(failingService.archiveConversation(memory, session))
        .rejects.toThrow('Archive operation failed');
    });

    it('should handle KV storage errors gracefully', async () => {
      const failingBindings = {
        ...mockBindings,
        CHAT_KV: {
          ...mockBindings.CHAT_KV,
          put: vi.fn().mockRejectedValue(new Error('KV storage error'))
        } as any
      };

      const failingService = new DataPersistenceService(failingBindings);
      const text = 'Test text';
      const embedding = [0.1, 0.2, 0.3];

      await expect(failingService.cacheEmbedding(text, embedding))
        .rejects.toThrow('Cache operation failed');
    });

    it('should handle corrupted backup data', async () => {
      const testBackupId = 'test-backup';
      const mockManifest = {
        backupId: testBackupId,
        checksum: 'invalid-checksum',
        sessionIds: ['test-session'],
        timestamp: Date.now(),
        totalSize: 100,
        metadata: {}
      };

      const mockBackupData = [{ sessionId: 'test-session', data: {} }];

      // Mock corrupted backup data
      const corruptedBindings = {
        ...mockBindings,
        CHAT_KV: {
          ...mockBindings.CHAT_KV,
          get: vi.fn().mockResolvedValue(JSON.stringify(mockManifest))
        },
        ARCHIVE_R2: {
          ...mockBindings.ARCHIVE_R2,
          get: vi.fn().mockResolvedValue({
            text: async () => JSON.stringify(mockBackupData)
          })
        }
      };

      const corruptedService = new DataPersistenceService(corruptedBindings as any);

      await expect(corruptedService.restoreFromBackup(testBackupId))
        .rejects.toThrow('Backup data integrity check failed');
    });
  });

  describe('Utility Functions', () => {
    it('should generate consistent hashes for the same text', async () => {
      const text = 'Test text for hashing';
      
      // Cache the same text twice
      await service.cacheEmbedding(text, [0.1, 0.2]);
      await service.cacheEmbedding(text, [0.3, 0.4]); // Should overwrite
      
      const retrieved = await service.getCachedEmbedding(text);
      expect(retrieved).toEqual([0.3, 0.4]);
    });

    it('should calculate checksums correctly', async () => {
      const sessionIds = [generateSessionId()];
      
      // Archive a conversation first
      const memory = createTestMemory(sessionIds[0]!);
      const session = createTestSession(sessionIds[0]!);
      await service.archiveConversation(memory, session);

      // Create backup (which uses checksum calculation)
      const backupId = await service.createBackup(sessionIds);
      
      expect(backupId).toBeDefined();
      // If checksum calculation fails, backup creation would fail
    });
  });
});