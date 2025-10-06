// Integration example for data persistence service
import { DataPersistenceService } from './data_persistence';
import { WorkerBindings, ConversationMemory, SessionState } from './types';

export class DataPersistenceIntegration {
  private persistenceService: DataPersistenceService;

  constructor(bindings: WorkerBindings) {
    // Initialize with custom retention policies for production
    this.persistenceService = new DataPersistenceService(bindings, {
      conversationTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
      cacheTTL: 24 * 60 * 60 * 1000, // 24 hours
      archiveRetention: 90 * 24 * 60 * 60 * 1000, // 90 days
      cleanupInterval: 60 * 60 * 1000, // 1 hour
      maxArchiveSize: 50 * 1024 * 1024 // 50MB
    });
  }

  // Example: Archive conversation when session ends
  async handleSessionEnd(memory: ConversationMemory, session: SessionState): Promise<void> {
    try {
      if (memory.messages.length > 0) {
        const archiveKey = await this.persistenceService.archiveConversation(memory, session);
        console.log(`Session ${session.id} archived to ${archiveKey}`);
      }
    } catch (error) {
      console.error(`Failed to archive session ${session.id}:`, error);
      // Continue with session cleanup even if archiving fails
    }
  }

  // Example: Cache embeddings for knowledge base queries
  async cacheKnowledgeBaseEmbedding(query: string, embedding: number[]): Promise<void> {
    try {
      await this.persistenceService.cacheEmbedding(query, embedding, {
        source: 'knowledge_base',
        cached_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to cache knowledge base embedding:', error);
      // Non-critical error - continue without caching
    }
  }

  // Example: Cache frequent support queries
  async cacheFrequentSupportQuery(query: string, answer: any): Promise<void> {
    try {
      await this.persistenceService.cacheFrequentQuery(query, answer, {
        source: 'support_bot',
        confidence: answer.confidence || 0.8,
        cached_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to cache support query:', error);
    }
  }

  // Example: Check cache before processing expensive operations
  async getOrComputeEmbedding(text: string, computeEmbedding: () => Promise<number[]>): Promise<number[]> {
    try {
      // Try to get from cache first
      const cached = await this.persistenceService.getCachedEmbedding(text);
      if (cached) {
        console.log('Retrieved embedding from cache');
        return cached;
      }

      // Compute if not cached
      console.log('Computing new embedding');
      const embedding = await computeEmbedding();
      
      // Cache for future use
      await this.persistenceService.cacheEmbedding(text, embedding);
      
      return embedding;
    } catch (error) {
      console.error('Error in embedding cache flow:', error);
      // Fallback to computation without caching
      return await computeEmbedding();
    }
  }

  // Example: Check cache before querying knowledge base
  async getOrQueryKnowledgeBase(query: string, queryKB: () => Promise<any>): Promise<any> {
    try {
      // Check cache first
      const cached = await this.persistenceService.getCachedQueryResult(query);
      if (cached) {
        console.log('Retrieved query result from cache');
        return cached;
      }

      // Query knowledge base if not cached
      console.log('Querying knowledge base');
      const result = await queryKB();
      
      // Cache the result
      await this.persistenceService.cacheFrequentQuery(query, result);
      
      return result;
    } catch (error) {
      console.error('Error in knowledge base cache flow:', error);
      // Fallback to direct query
      return await queryKB();
    }
  }

  // Example: Restore conversation for returning users
  async restoreUserConversation(sessionId: string): Promise<ConversationMemory | null> {
    try {
      const archived = await this.persistenceService.retrieveArchivedConversation(sessionId);
      if (archived) {
        console.log(`Restored conversation for session ${sessionId}`);
        return archived;
      }
      return null;
    } catch (error) {
      console.error(`Failed to restore conversation for session ${sessionId}:`, error);
      return null;
    }
  }

  // Example: Create daily backups
  async createDailyBackup(sessionIds: string[]): Promise<string | null> {
    try {
      const backupId = await this.persistenceService.createBackup(sessionIds);
      console.log(`Created daily backup: ${backupId}`);
      return backupId;
    } catch (error) {
      console.error('Failed to create daily backup:', error);
      return null;
    }
  }

  // Example: Scheduled cleanup job
  async performScheduledCleanup(): Promise<void> {
    try {
      console.log('Starting scheduled data cleanup...');
      await this.persistenceService.enforceRetentionPolicy();
      console.log('Scheduled cleanup completed successfully');
    } catch (error) {
      console.error('Scheduled cleanup failed:', error);
    }
  }

  // Example: Get user's conversation history
  async getUserConversationHistory(userId: string, limit: number = 20): Promise<any[]> {
    try {
      const archives = await this.persistenceService.listArchivedConversations(userId, limit);
      return archives.map(archive => ({
        sessionId: archive.sessionId,
        summary: archive.summary,
        messageCount: archive.messageCount,
        topics: archive.topics,
        archivedAt: new Date(archive.archivedAt).toISOString(),
        duration: Math.round(archive.duration / 1000 / 60) // minutes
      }));
    } catch (error) {
      console.error(`Failed to get conversation history for user ${userId}:`, error);
      return [];
    }
  }

  // Example: Health check for persistence services
  async healthCheck(): Promise<{ status: string; details: any }> {
    const health = {
      status: 'healthy',
      details: {
        r2_storage: 'unknown',
        kv_cache: 'unknown',
        timestamp: new Date().toISOString()
      }
    };

    try {
      // Test R2 storage
      const testKey = `health_check_${Date.now()}`;
      await this.persistenceService['bindings'].ARCHIVE_R2.put(testKey, 'test');
      const retrieved = await this.persistenceService['bindings'].ARCHIVE_R2.get(testKey);
      if (retrieved) {
        health.details.r2_storage = 'healthy';
        await this.persistenceService['bindings'].ARCHIVE_R2.delete(testKey);
      } else {
        health.details.r2_storage = 'degraded';
        health.status = 'degraded';
      }
    } catch (error) {
      health.details.r2_storage = 'unhealthy';
      health.status = 'unhealthy';
    }

    try {
      // Test KV cache
      const testKey = `health_check_${Date.now()}`;
      await this.persistenceService['bindings'].CHAT_KV.put(testKey, 'test', { expirationTtl: 60 });
      const retrieved = await this.persistenceService['bindings'].CHAT_KV.get(testKey);
      if (retrieved === 'test') {
        health.details.kv_cache = 'healthy';
        await this.persistenceService['bindings'].CHAT_KV.delete(testKey);
      } else {
        health.details.kv_cache = 'degraded';
        if (health.status === 'healthy') health.status = 'degraded';
      }
    } catch (error) {
      health.details.kv_cache = 'unhealthy';
      health.status = 'unhealthy';
    }

    return health;
  }

  // Example: Metrics for monitoring
  async getStorageMetrics(): Promise<any> {
    try {
      // Get cache statistics
      const cacheKeys = await this.persistenceService['bindings'].CHAT_KV.list({ prefix: 'embedding:' });
      const queryKeys = await this.persistenceService['bindings'].CHAT_KV.list({ prefix: 'query:' });
      const archiveKeys = await this.persistenceService['bindings'].CHAT_KV.list({ prefix: 'archive_meta:' });

      // Get archive statistics
      const archiveList = await this.persistenceService['bindings'].ARCHIVE_R2.list({ prefix: 'conversations/' });
      const backupList = await this.persistenceService['bindings'].ARCHIVE_R2.list({ prefix: 'backups/' });

      return {
        cache: {
          embeddings: cacheKeys.keys.length,
          queries: queryKeys.keys.length,
          archives_metadata: archiveKeys.keys.length
        },
        storage: {
          archived_conversations: archiveList.objects.length,
          backups: backupList.objects.length
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Failed to get storage metrics:', error);
      return {
        error: 'Failed to retrieve metrics',
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Example usage in a Cloudflare Worker
export async function handleDataPersistenceRequest(
  request: Request,
  bindings: WorkerBindings
): Promise<Response> {
  const integration = new DataPersistenceIntegration(bindings);
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    switch (path) {
      case '/health':
        const health = await integration.healthCheck();
        return new Response(JSON.stringify(health), {
          headers: { 'Content-Type': 'application/json' }
        });

      case '/metrics':
        const metrics = await integration.getStorageMetrics();
        return new Response(JSON.stringify(metrics), {
          headers: { 'Content-Type': 'application/json' }
        });

      case '/cleanup':
        if (request.method === 'POST') {
          await integration.performScheduledCleanup();
          return new Response(JSON.stringify({ success: true }));
        }
        break;

      case '/backup':
        if (request.method === 'POST') {
          const body = await request.json() as any;
          const backupId = await integration.createDailyBackup(body.sessionIds || []);
          return new Response(JSON.stringify({ backupId }));
        }
        break;

      case '/history':
        const userId = url.searchParams.get('userId');
        const limit = parseInt(url.searchParams.get('limit') || '20');
        if (userId) {
          const history = await integration.getUserConversationHistory(userId, limit);
          return new Response(JSON.stringify({ history }));
        }
        break;
    }

    return new Response('Not found', { status: 404 });
  } catch (error) {
    console.error('Data persistence request error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}