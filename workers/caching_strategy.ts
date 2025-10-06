// Advanced caching strategies for performance optimization
import { WorkerBindings, ChatMessage, ConversationContext } from './types';
import { Logger, MetricsCollector } from './logging';

export interface CacheConfig {
  ttl: number;
  maxSize?: number;
  compressionThreshold?: number;
  enableCompression?: boolean;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
  compressed?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalEntries: number;
  memoryUsage: number;
}

// Multi-level caching system
export class CachingStrategy {
  private bindings: WorkerBindings;
  private logger: Logger;
  private metrics: MetricsCollector;
  
  // In-memory cache for ultra-fast access
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private maxMemoryCacheSize = 100; // Limit memory cache size
  
  // Cache configurations for different data types
  private cacheConfigs: Map<string, CacheConfig> = new Map([
    ['ai_responses', { ttl: 3600, enableCompression: true, compressionThreshold: 1024 }], // 1 hour
    ['conversation_summaries', { ttl: 7200, enableCompression: true }], // 2 hours
    ['user_profiles', { ttl: 86400 }], // 24 hours
    ['knowledge_base_results', { ttl: 1800, enableCompression: true }], // 30 minutes
    ['tool_results', { ttl: 900 }], // 15 minutes
    ['session_metadata', { ttl: 3600 }], // 1 hour
    ['embeddings', { ttl: 604800, enableCompression: true }], // 1 week
  ]);

  constructor(bindings: WorkerBindings, logger: Logger, metrics: MetricsCollector) {
    this.bindings = bindings;
    this.logger = logger;
    this.metrics = metrics;
  }

  // Get cached data with multi-level fallback
  async get<T>(key: string, cacheType: string): Promise<T | null> {
    const fullKey = `${cacheType}:${key}`;
    
    try {
      // Level 1: Memory cache (fastest)
      const memoryResult = this.getFromMemoryCache<T>(fullKey);
      if (memoryResult !== null) {
        this.recordCacheHit('memory', cacheType);
        return memoryResult;
      }

      // Level 2: KV cache (fast, persistent)
      const kvResult = await this.getFromKVCache<T>(fullKey, cacheType);
      if (kvResult !== null) {
        // Promote to memory cache for future access
        this.setInMemoryCache(fullKey, kvResult, cacheType);
        this.recordCacheHit('kv', cacheType);
        return kvResult;
      }

      // Cache miss
      this.recordCacheMiss(cacheType);
      return null;

    } catch (error) {
      await this.logger.warn('Cache retrieval failed', { 
        key: fullKey, 
        error: (error as Error).message 
      });
      this.recordCacheMiss(cacheType);
      return null;
    }
  }

  // Set cached data in multiple levels
  async set<T>(key: string, data: T, cacheType: string, customTtl?: number): Promise<void> {
    const fullKey = `${cacheType}:${key}`;
    const config = this.cacheConfigs.get(cacheType) || { ttl: 3600 };
    const ttl = customTtl || config.ttl;

    try {
      // Set in memory cache
      this.setInMemoryCache(fullKey, data, cacheType, ttl);

      // Set in KV cache for persistence
      await this.setInKVCache(fullKey, data, config, ttl);

      this.metrics.incrementCounter('cache_sets_total', 1, { type: cacheType });

    } catch (error) {
      await this.logger.error('Cache storage failed', error as Error, { 
        key: fullKey 
      });
    }
  }

  // Invalidate cache entry
  async invalidate(key: string, cacheType: string): Promise<void> {
    const fullKey = `${cacheType}:${key}`;
    
    try {
      // Remove from memory cache
      this.memoryCache.delete(fullKey);

      // Remove from KV cache
      await this.bindings.CHAT_KV.delete(fullKey);

      this.metrics.incrementCounter('cache_invalidations_total', 1, { type: cacheType });

    } catch (error) {
      await this.logger.warn('Cache invalidation failed', { 
        key: fullKey, 
        error: (error as Error).message 
      });
    }
  }

  // Specialized caching methods for common use cases

  // Cache AI responses with intelligent key generation
  async cacheAIResponse(
    prompt: string, 
    context: ConversationContext, 
    response: any
  ): Promise<void> {
    const cacheKey = this.generateAIResponseKey(prompt, context);
    await this.set(cacheKey, response, 'ai_responses');
  }

  async getCachedAIResponse(
    prompt: string, 
    context: ConversationContext
  ): Promise<any> {
    const cacheKey = this.generateAIResponseKey(prompt, context);
    return await this.get(cacheKey, 'ai_responses');
  }

  // Cache conversation summaries
  async cacheConversationSummary(
    sessionId: string, 
    messages: ChatMessage[], 
    summary: string
  ): Promise<void> {
    const cacheKey = this.generateSummaryKey(sessionId, messages);
    await this.set(cacheKey, summary, 'conversation_summaries');
  }

  async getCachedConversationSummary(
    sessionId: string, 
    messages: ChatMessage[]
  ): Promise<string | null> {
    const cacheKey = this.generateSummaryKey(sessionId, messages);
    return await this.get(cacheKey, 'conversation_summaries');
  }

  // Cache knowledge base search results
  async cacheKnowledgeBaseResults(
    query: string, 
    filters: any, 
    results: any[]
  ): Promise<void> {
    const cacheKey = this.generateKBKey(query, filters);
    await this.set(cacheKey, results, 'knowledge_base_results');
  }

  async getCachedKnowledgeBaseResults(
    query: string, 
    filters: any
  ): Promise<any[] | null> {
    const cacheKey = this.generateKBKey(query, filters);
    return await this.get(cacheKey, 'knowledge_base_results');
  }

  // Cache embeddings for semantic search
  async cacheEmbedding(text: string, embedding: number[]): Promise<void> {
    const cacheKey = this.generateEmbeddingKey(text);
    await this.set(cacheKey, embedding, 'embeddings');
  }

  async getCachedEmbedding(text: string): Promise<number[] | null> {
    const cacheKey = this.generateEmbeddingKey(text);
    return await this.get(cacheKey, 'embeddings');
  }

  // Batch operations for efficiency
  async batchGet<T>(keys: string[], cacheType: string): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    
    // Try to get all from memory cache first
    const memoryMisses: string[] = [];
    
    for (const key of keys) {
      const fullKey = `${cacheType}:${key}`;
      const memoryResult = this.getFromMemoryCache<T>(fullKey);
      
      if (memoryResult !== null) {
        results.set(key, memoryResult);
        this.recordCacheHit('memory', cacheType);
      } else {
        memoryMisses.push(key);
      }
    }

    // Batch fetch from KV for memory misses
    if (memoryMisses.length > 0) {
      const kvResults = await this.batchGetFromKV<T>(memoryMisses, cacheType);
      
      for (const [key, value] of kvResults) {
        results.set(key, value);
        // Promote to memory cache
        const fullKey = `${cacheType}:${key}`;
        this.setInMemoryCache(fullKey, value, cacheType);
        this.recordCacheHit('kv', cacheType);
      }
    }

    return results;
  }

  async batchSet<T>(entries: Map<string, T>, cacheType: string): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const [key, value] of entries) {
      promises.push(this.set(key, value, cacheType));
    }

    await Promise.all(promises);
  }

  // Cache warming strategies
  async warmCache(sessionId: string, context: ConversationContext): Promise<void> {
    try {
      // Pre-load frequently accessed data
      const warmingTasks = [
        this.warmUserProfile(sessionId),
        this.warmConversationHistory(sessionId),
        this.warmKnowledgeBaseCache(context),
      ];

      await Promise.allSettled(warmingTasks);
      
      this.metrics.incrementCounter('cache_warming_total', 1);

    } catch (error) {
      await this.logger.warn('Cache warming failed', { 
        sessionId, 
        error: (error as Error).message 
      });
    }
  }

  // Cache statistics and monitoring
  getCacheStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};
    
    // Memory cache stats
    let totalMemoryUsage = 0;
    const memoryCacheEntries = this.memoryCache.size;
    
    for (const [key, entry] of this.memoryCache) {
      totalMemoryUsage += this.estimateEntrySize(entry);
    }

    stats['memory'] = {
      hits: 0, // Would be tracked in real implementation
      misses: 0,
      hitRate: 0,
      totalEntries: memoryCacheEntries,
      memoryUsage: totalMemoryUsage
    };

    return stats;
  }

  // Cleanup and maintenance
  async cleanup(): Promise<void> {
    try {
      // Clean expired entries from memory cache
      const now = Date.now();
      const expiredKeys: string[] = [];

      for (const [key, entry] of this.memoryCache) {
        if (now - entry.timestamp > entry.ttl * 1000) {
          expiredKeys.push(key);
        }
      }

      for (const key of expiredKeys) {
        this.memoryCache.delete(key);
      }

      // Evict least recently used entries if cache is too large
      if (this.memoryCache.size > this.maxMemoryCacheSize) {
        const entries = Array.from(this.memoryCache.entries())
          .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
        
        const toEvict = entries.slice(0, entries.length - this.maxMemoryCacheSize);
        for (const [key] of toEvict) {
          this.memoryCache.delete(key);
        }
      }

      this.metrics.incrementCounter('cache_cleanup_total', 1);

    } catch (error) {
      await this.logger.error('Cache cleanup failed', error as Error);
    }
  }

  // Private helper methods
  private getFromMemoryCache<T>(key: string): T | null {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl * 1000) {
      this.memoryCache.delete(key);
      return null;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = now;

    return entry.data as T;
  }

  private setInMemoryCache<T>(
    key: string, 
    data: T, 
    cacheType: string, 
    ttl?: number
  ): void {
    const config = this.cacheConfigs.get(cacheType) || { ttl: 3600 };
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || config.ttl,
      accessCount: 1,
      lastAccessed: Date.now()
    };

    this.memoryCache.set(key, entry);
  }

  private async getFromKVCache<T>(key: string, cacheType: string): Promise<T | null> {
    try {
      const stored = await this.bindings.CHAT_KV.get(key, 'json');
      if (!stored) return null;

      const entry = stored as CacheEntry<T>;
      const now = Date.now();

      if (now - entry.timestamp > entry.ttl * 1000) {
        // Expired, delete it
        await this.bindings.CHAT_KV.delete(key);
        return null;
      }

      return entry.data;

    } catch (error) {
      await this.logger.warn('KV cache retrieval failed', { 
        key, 
        error: (error as Error).message 
      });
      return null;
    }
  }

  private async setInKVCache<T>(
    key: string, 
    data: T, 
    config: CacheConfig, 
    ttl: number
  ): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      accessCount: 1,
      lastAccessed: Date.now()
    };

    // Compress if needed
    let serialized = JSON.stringify(entry);
    if (config.enableCompression && 
        config.compressionThreshold && 
        serialized.length > config.compressionThreshold) {
      // In real implementation, would use compression library
      entry.compressed = true;
    }

    await this.bindings.CHAT_KV.put(key, JSON.stringify(entry), {
      expirationTtl: ttl
    });
  }

  private async batchGetFromKV<T>(keys: string[], cacheType: string): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    
    // KV doesn't support batch operations, so we'll do parallel requests
    const promises = keys.map(async (key) => {
      const fullKey = `${cacheType}:${key}`;
      const result = await this.getFromKVCache<T>(fullKey, cacheType);
      return { key, result };
    });

    const responses = await Promise.allSettled(promises);
    
    for (const response of responses) {
      if (response.status === 'fulfilled' && response.value.result !== null) {
        results.set(response.value.key, response.value.result);
      }
    }

    return results;
  }

  // Key generation methods
  private generateAIResponseKey(prompt: string, context: ConversationContext): string {
    const contextHash = this.hashObject({
      summary: context.summary,
      activeTopics: context.activeTopics,
      recentMessageCount: context.recentMessages.length
    });
    const promptHash = this.hashString(prompt.slice(0, 200)); // Limit prompt length for key
    return `ai_${promptHash}_${contextHash}`;
  }

  private generateSummaryKey(sessionId: string, messages: ChatMessage[]): string {
    const messageHashes = messages.slice(-5).map(m => this.hashString(m.content.slice(0, 50)));
    return `summary_${sessionId}_${messageHashes.join('_')}`;
  }

  private generateKBKey(query: string, filters: any): string {
    const queryHash = this.hashString(query);
    const filterHash = this.hashObject(filters);
    return `kb_${queryHash}_${filterHash}`;
  }

  private generateEmbeddingKey(text: string): string {
    return `emb_${this.hashString(text)}`;
  }

  private hashString(str: string): string {
    // Simple hash function - in production would use crypto.subtle
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private hashObject(obj: any): string {
    return this.hashString(JSON.stringify(obj));
  }

  private recordCacheHit(level: string, type: string): void {
    this.metrics.incrementCounter('cache_hits_total', 1, { level, type });
  }

  private recordCacheMiss(type: string): void {
    this.metrics.incrementCounter('cache_misses_total', 1, { type });
  }

  private estimateEntrySize(entry: CacheEntry<any>): number {
    // Rough estimation of memory usage
    return JSON.stringify(entry).length * 2; // Approximate bytes
  }

  // Cache warming helper methods
  private async warmUserProfile(sessionId: string): Promise<void> {
    // Pre-load user profile data
    // Implementation would depend on user profile structure
  }

  private async warmConversationHistory(sessionId: string): Promise<void> {
    // Pre-load recent conversation history
    // Implementation would fetch and cache recent messages
  }

  private async warmKnowledgeBaseCache(context: ConversationContext): Promise<void> {
    // Pre-load relevant knowledge base entries based on context
    // Implementation would analyze context and pre-fetch relevant data
  }
}

// Cache-aware data access layer
export class CachedDataAccess {
  private cache: CachingStrategy;
  private bindings: WorkerBindings;

  constructor(cache: CachingStrategy, bindings: WorkerBindings) {
    this.cache = cache;
    this.bindings = bindings;
  }

  // Cached conversation retrieval
  async getConversationWithCache(sessionId: string): Promise<any> {
    const cached = await this.cache.get(sessionId, 'conversation_data');
    if (cached) return cached;

    // Fetch from source and cache
    const conversation = await this.fetchConversationFromSource(sessionId);
    if (conversation) {
      await this.cache.set(sessionId, conversation, 'conversation_data');
    }

    return conversation;
  }

  // Cached user profile retrieval
  async getUserProfileWithCache(userId: string): Promise<any> {
    const cached = await this.cache.get(userId, 'user_profiles');
    if (cached) return cached;

    const profile = await this.fetchUserProfileFromSource(userId);
    if (profile) {
      await this.cache.set(userId, profile, 'user_profiles');
    }

    return profile;
  }

  private async fetchConversationFromSource(sessionId: string): Promise<any> {
    // Implementation would fetch from Durable Object or R2
    return null;
  }

  private async fetchUserProfileFromSource(userId: string): Promise<any> {
    // Implementation would fetch from external user service
    return null;
  }
}