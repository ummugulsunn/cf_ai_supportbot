// Data persistence and archival system for the AI Support Bot
import {
  ChatMessage,
  ConversationMemory,
  SessionState,
  ConversationContext,
  WorkerBindings
} from './types';

export interface ArchiveMetadata {
  sessionId: string;
  archivedAt: number;
  messageCount: number;
  summary: string;
  topics: string[];
  duration: number; // session duration in ms
  userId?: string;
}

export interface CacheEntry<T = any> {
  key: string;
  value: T;
  timestamp: number;
  ttl: number;
  metadata?: Record<string, any>;
}

export interface DataRetentionPolicy {
  conversationTTL: number; // in milliseconds
  cacheTTL: number; // in milliseconds
  archiveRetention: number; // in milliseconds
  cleanupInterval: number; // in milliseconds
  maxArchiveSize: number; // in bytes
}

export interface BackupManifest {
  backupId: string;
  timestamp: number;
  sessionIds: string[];
  totalSize: number;
  checksum: string;
  metadata: Record<string, any>;
}

export class DataPersistenceService {
  private bindings: WorkerBindings;
  private retentionPolicy: DataRetentionPolicy;

  constructor(bindings: WorkerBindings, retentionPolicy?: Partial<DataRetentionPolicy>) {
    this.bindings = bindings;
    this.retentionPolicy = {
      conversationTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
      cacheTTL: 24 * 60 * 60 * 1000, // 24 hours
      archiveRetention: 90 * 24 * 60 * 60 * 1000, // 90 days
      cleanupInterval: 60 * 60 * 1000, // 1 hour
      maxArchiveSize: 10 * 1024 * 1024, // 10MB
      ...retentionPolicy
    };
  }

  // R2 Archive Operations
  async archiveConversation(memory: ConversationMemory, sessionState: SessionState): Promise<string> {
    try {
      const archiveId = `archive_${memory.sessionId}_${Date.now()}`;
      const metadata: ArchiveMetadata = {
        sessionId: memory.sessionId,
        archivedAt: Date.now(),
        messageCount: memory.messages.length,
        summary: memory.summary,
        topics: this.extractTopics(memory.messages),
        duration: sessionState.lastActivity - sessionState.createdAt,
        userId: sessionState.userId
      };

      const archiveData = {
        metadata,
        conversation: {
          sessionId: memory.sessionId,
          messages: memory.messages,
          summary: memory.summary,
          context: memory.context,
          sessionState
        }
      };

      const archiveKey = `conversations/${new Date().getFullYear()}/${new Date().getMonth() + 1}/${archiveId}.json`;
      
      // Store in R2 with metadata
      await this.bindings.ARCHIVE_R2.put(archiveKey, JSON.stringify(archiveData), {
        customMetadata: {
          sessionId: memory.sessionId,
          messageCount: metadata.messageCount.toString(),
          archivedAt: metadata.archivedAt.toString(),
          topics: metadata.topics.join(',')
        }
      });

      // Store archive metadata in KV for quick lookups
      await this.bindings.CHAT_KV.put(
        `archive_meta:${memory.sessionId}`,
        JSON.stringify(metadata),
        { expirationTtl: Math.floor(this.retentionPolicy.archiveRetention / 1000) }
      );

      return archiveKey;
    } catch (error) {
      console.error('Failed to archive conversation:', error);
      throw new Error(`Archive operation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async retrieveArchivedConversation(sessionId: string): Promise<ConversationMemory | null> {
    try {
      // First check if we have metadata
      const metadataStr = await this.bindings.CHAT_KV.get(`archive_meta:${sessionId}`);
      if (!metadataStr) {
        return null;
      }

      const metadata: ArchiveMetadata = JSON.parse(metadataStr);
      
      // Construct the archive key based on the archived date
      const archivedDate = new Date(metadata.archivedAt);
      const archiveKey = `conversations/${archivedDate.getFullYear()}/${archivedDate.getMonth() + 1}/archive_${sessionId}_${metadata.archivedAt}.json`;
      
      const archiveObject = await this.bindings.ARCHIVE_R2.get(archiveKey);
      if (!archiveObject) {
        return null;
      }

      const archiveData = JSON.parse(await archiveObject.text());
      return archiveData.conversation;
    } catch (error) {
      console.error('Failed to retrieve archived conversation:', error);
      return null;
    }
  }

  async listArchivedConversations(userId?: string, limit: number = 50): Promise<ArchiveMetadata[]> {
    try {
      const prefix = userId ? `archive_meta:user:${userId}:` : 'archive_meta:';
      const listResult = await this.bindings.CHAT_KV.list({ prefix, limit });
      
      const archives: ArchiveMetadata[] = [];
      for (const key of listResult.keys) {
        try {
          const metadataStr = await this.bindings.CHAT_KV.get(key.name);
          if (metadataStr) {
            archives.push(JSON.parse(metadataStr));
          }
        } catch (error) {
          console.error(`Failed to parse archive metadata for ${key.name}:`, error);
        }
      }

      return archives.sort((a, b) => b.archivedAt - a.archivedAt);
    } catch (error) {
      console.error('Failed to list archived conversations:', error);
      return [];
    }
  }

  // KV Cache Operations
  async cacheEmbedding(text: string, embedding: number[], metadata?: Record<string, any>): Promise<void> {
    try {
      const key = `embedding:${this.hashText(text)}`;
      const cacheEntry: CacheEntry<number[]> = {
        key,
        value: embedding,
        timestamp: Date.now(),
        ttl: this.retentionPolicy.cacheTTL,
        metadata: {
          textLength: text.length,
          ...metadata
        }
      };

      await this.bindings.CHAT_KV.put(
        key,
        JSON.stringify(cacheEntry),
        { expirationTtl: Math.floor(this.retentionPolicy.cacheTTL / 1000) }
      );
    } catch (error) {
      console.error('Failed to cache embedding:', error);
      throw new Error(`Cache operation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getCachedEmbedding(text: string): Promise<number[] | null> {
    try {
      const key = `embedding:${this.hashText(text)}`;
      const cacheEntryStr = await this.bindings.CHAT_KV.get(key);
      
      if (!cacheEntryStr) {
        return null;
      }

      const cacheEntry: CacheEntry<number[]> = JSON.parse(cacheEntryStr);
      
      // Check if cache entry is still valid
      if (Date.now() - cacheEntry.timestamp > cacheEntry.ttl) {
        // Clean up expired entry
        await this.bindings.CHAT_KV.delete(key);
        return null;
      }

      return cacheEntry.value;
    } catch (error) {
      console.error('Failed to retrieve cached embedding:', error);
      return null;
    }
  }

  async cacheFrequentQuery(query: string, result: any, metadata?: Record<string, any>): Promise<void> {
    try {
      const key = `query:${this.hashText(query)}`;
      const cacheEntry: CacheEntry = {
        key,
        value: result,
        timestamp: Date.now(),
        ttl: this.retentionPolicy.cacheTTL,
        metadata: {
          queryLength: query.length,
          resultType: typeof result,
          ...metadata
        }
      };

      await this.bindings.CHAT_KV.put(
        key,
        JSON.stringify(cacheEntry),
        { expirationTtl: Math.floor(this.retentionPolicy.cacheTTL / 1000) }
      );
    } catch (error) {
      console.error('Failed to cache query result:', error);
      throw new Error(`Cache operation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getCachedQueryResult(query: string): Promise<any | null> {
    try {
      const key = `query:${this.hashText(query)}`;
      const cacheEntryStr = await this.bindings.CHAT_KV.get(key);
      
      if (!cacheEntryStr) {
        return null;
      }

      const cacheEntry: CacheEntry = JSON.parse(cacheEntryStr);
      
      // Check if cache entry is still valid
      if (Date.now() - cacheEntry.timestamp > cacheEntry.ttl) {
        await this.bindings.CHAT_KV.delete(key);
        return null;
      }

      return cacheEntry.value;
    } catch (error) {
      console.error('Failed to retrieve cached query result:', error);
      return null;
    }
  }

  // Backup and Recovery Operations
  async createBackup(sessionIds: string[]): Promise<string> {
    try {
      const backupId = `backup_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const backupData: any[] = [];
      let totalSize = 0;

      for (const sessionId of sessionIds) {
        try {
          const archived = await this.retrieveArchivedConversation(sessionId);
          if (archived) {
            const serialized = JSON.stringify(archived);
            backupData.push({
              sessionId,
              data: archived,
              size: serialized.length
            });
            totalSize += serialized.length;
          }
        } catch (error) {
          console.error(`Failed to backup session ${sessionId}:`, error);
        }
      }

      const manifest: BackupManifest = {
        backupId,
        timestamp: Date.now(),
        sessionIds: sessionIds.filter(id => backupData.some(b => b.sessionId === id)),
        totalSize,
        checksum: await this.calculateChecksum(JSON.stringify(backupData)),
        metadata: {
          sessionCount: backupData.length,
          createdBy: 'system'
        }
      };

      // Store backup data
      const backupKey = `backups/${backupId}/data.json`;
      await this.bindings.ARCHIVE_R2.put(backupKey, JSON.stringify(backupData));

      // Store backup manifest
      const manifestKey = `backups/${backupId}/manifest.json`;
      await this.bindings.ARCHIVE_R2.put(manifestKey, JSON.stringify(manifest));

      // Cache manifest for quick access
      await this.bindings.CHAT_KV.put(
        `backup_manifest:${backupId}`,
        JSON.stringify(manifest),
        { expirationTtl: Math.floor(this.retentionPolicy.archiveRetention / 1000) }
      );

      return backupId;
    } catch (error) {
      console.error('Failed to create backup:', error);
      throw new Error(`Backup operation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async restoreFromBackup(backupId: string): Promise<string[]> {
    try {
      // Get backup manifest
      const manifestStr = await this.bindings.CHAT_KV.get(`backup_manifest:${backupId}`);
      if (!manifestStr) {
        throw new Error('Backup manifest not found');
      }

      const manifest: BackupManifest = JSON.parse(manifestStr);
      
      // Get backup data
      const backupKey = `backups/${backupId}/data.json`;
      const backupObject = await this.bindings.ARCHIVE_R2.get(backupKey);
      if (!backupObject) {
        throw new Error('Backup data not found');
      }

      const backupData = JSON.parse(await backupObject.text());
      
      // Verify checksum
      const calculatedChecksum = await this.calculateChecksum(JSON.stringify(backupData));
      if (calculatedChecksum !== manifest.checksum) {
        throw new Error('Backup data integrity check failed');
      }

      const restoredSessions: string[] = [];

      // Restore each session
      for (const backup of backupData) {
        try {
          // Re-archive the conversation
          const archiveKey = await this.archiveConversation(backup.data, backup.data.sessionState);
          restoredSessions.push(backup.sessionId);
        } catch (error) {
          console.error(`Failed to restore session ${backup.sessionId}:`, error);
        }
      }

      return restoredSessions;
    } catch (error) {
      console.error('Failed to restore from backup:', error);
      throw new Error(`Restore operation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Data Retention and Cleanup
  async enforceRetentionPolicy(): Promise<void> {
    try {
      const now = Date.now();
      
      // Clean up expired cache entries
      await this.cleanupExpiredCache();
      
      // Clean up old archives
      await this.cleanupOldArchives(now);
      
      // Clean up old backups
      await this.cleanupOldBackups(now);
      
    } catch (error) {
      console.error('Failed to enforce retention policy:', error);
    }
  }

  private async cleanupExpiredCache(): Promise<void> {
    try {
      // List all cache entries
      const cacheKeys = await this.bindings.CHAT_KV.list({ prefix: 'embedding:' });
      const queryKeys = await this.bindings.CHAT_KV.list({ prefix: 'query:' });
      
      const allKeys = [...cacheKeys.keys, ...queryKeys.keys];
      
      for (const key of allKeys) {
        try {
          const entryStr = await this.bindings.CHAT_KV.get(key.name);
          if (entryStr) {
            const entry: CacheEntry = JSON.parse(entryStr);
            if (Date.now() - entry.timestamp > entry.ttl) {
              await this.bindings.CHAT_KV.delete(key.name);
            }
          }
        } catch (error) {
          console.error(`Failed to check cache entry ${key.name}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup expired cache:', error);
    }
  }

  private async cleanupOldArchives(now: number): Promise<void> {
    try {
      const archiveList = await this.bindings.ARCHIVE_R2.list({ prefix: 'conversations/' });
      
      for (const object of archiveList.objects) {
        if (now - object.uploaded.getTime() > this.retentionPolicy.archiveRetention) {
          await this.bindings.ARCHIVE_R2.delete(object.key);
          
          // Also clean up metadata
          const sessionId = this.extractSessionIdFromArchiveKey(object.key);
          if (sessionId) {
            await this.bindings.CHAT_KV.delete(`archive_meta:${sessionId}`);
          }
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old archives:', error);
    }
  }

  private async cleanupOldBackups(now: number): Promise<void> {
    try {
      const backupList = await this.bindings.ARCHIVE_R2.list({ prefix: 'backups/' });
      
      for (const object of backupList.objects) {
        if (now - object.uploaded.getTime() > this.retentionPolicy.archiveRetention) {
          await this.bindings.ARCHIVE_R2.delete(object.key);
          
          // Clean up manifest cache
          const backupId = this.extractBackupIdFromKey(object.key);
          if (backupId) {
            await this.bindings.CHAT_KV.delete(`backup_manifest:${backupId}`);
          }
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old backups:', error);
    }
  }

  // Utility Methods
  private hashText(text: string): string {
    // Simple hash function for cache keys
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private async calculateChecksum(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private extractTopics(messages: ChatMessage[]): string[] {
    const topics = new Set<string>();
    
    messages.forEach(message => {
      const content = message.content.toLowerCase();
      
      if (content.includes('password') || content.includes('login')) topics.add('authentication');
      if (content.includes('billing') || content.includes('payment')) topics.add('billing');
      if (content.includes('bug') || content.includes('error')) topics.add('technical-issue');
      if (content.includes('feature') || content.includes('request')) topics.add('feature-request');
      if (content.includes('account') || content.includes('profile')) topics.add('account-management');
    });
    
    return Array.from(topics);
  }

  private extractSessionIdFromArchiveKey(key: string): string | null {
    const match = key.match(/archive_([^_]+)_\d+\.json$/);
    return match?.[1] ?? null;
  }

  private extractBackupIdFromKey(key: string): string | null {
    const match = key.match(/backups\/([^\/]+)\//);
    return match?.[1] ?? null;
  }
}