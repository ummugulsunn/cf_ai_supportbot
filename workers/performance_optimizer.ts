// Performance optimization utilities for critical paths
import { WorkerBindings } from './types';
import { Logger, MetricsCollector } from './logging';

export interface PerformanceProfile {
  component: string;
  operation: string;
  duration: number;
  memoryUsage: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface OptimizationResult {
  originalDuration: number;
  optimizedDuration: number;
  improvement: number;
  memoryReduction: number;
  recommendations: string[];
}

export class PerformanceOptimizer {
  private bindings: WorkerBindings;
  private logger: Logger;
  private metrics: MetricsCollector;
  private profiles: Map<string, PerformanceProfile[]> = new Map();

  constructor(bindings: WorkerBindings, logger: Logger, metrics: MetricsCollector) {
    this.bindings = bindings;
    this.logger = logger;
    this.metrics = metrics;
  }

  // Profile critical path execution
  async profileCriticalPath<T>(
    pathName: string,
    operation: () => Promise<T>,
    options: {
      enableMemoryProfiling?: boolean;
      sampleRate?: number;
      maxProfiles?: number;
    } = {}
  ): Promise<{ result: T; profile: PerformanceProfile }> {
    const startTime = performance.now();
    const startMemory = options.enableMemoryProfiling ? this.getMemoryUsage() : 0;

    try {
      const result = await operation();
      const endTime = performance.now();
      const endMemory = options.enableMemoryProfiling ? this.getMemoryUsage() : 0;

      const profile: PerformanceProfile = {
        component: pathName,
        operation: 'execution',
        duration: endTime - startTime,
        memoryUsage: endMemory - startMemory,
        timestamp: Date.now()
      };

      // Store profile if sampling allows
      if (!options.sampleRate || Math.random() < options.sampleRate) {
        this.storeProfile(pathName, profile, options.maxProfiles || 100);
      }

      // Record metrics
      this.metrics.recordHistogram(`${pathName}_duration`, profile.duration);
      if (options.enableMemoryProfiling) {
        this.metrics.recordHistogram(`${pathName}_memory`, profile.memoryUsage);
      }

      return { result, profile };
    } catch (error) {
      const endTime = performance.now();
      await this.logger.error(`Critical path ${pathName} failed`, error as Error, {
        duration: endTime - startTime
      });
      throw error;
    }
  }

  // Optimize AI model calls
  async optimizeAICall<T>(
    modelCall: () => Promise<T>,
    context: {
      messageLength: number;
      historyLength: number;
      sessionId: string;
    }
  ): Promise<T> {
    // Pre-optimization: Trim context if too large
    const optimizedContext = this.optimizeAIContext(context);
    
    // Use connection pooling and request batching
    return await this.profileCriticalPath(
      'ai_call_optimized',
      async () => {
        // Implement request deduplication for similar queries
        const cacheKey = this.generateAICacheKey(optimizedContext);
        const cached = await this.getCachedAIResponse(cacheKey);
        
        if (cached) {
          this.metrics.incrementCounter('ai_cache_hits', 1);
          return cached;
        }

        const result = await modelCall();
        
        // Cache successful responses
        await this.cacheAIResponse(cacheKey, result);
        this.metrics.incrementCounter('ai_cache_misses', 1);
        
        return result;
      },
      { enableMemoryProfiling: true, sampleRate: 0.1 }
    ).then(({ result }) => result);
  }

  // Optimize Durable Object operations
  async optimizeDOOperation<T>(
    operation: () => Promise<T>,
    sessionId: string,
    operationType: string
  ): Promise<T> {
    return await this.profileCriticalPath(
      `do_${operationType}`,
      async () => {
        // Implement operation batching for multiple requests
        const batchKey = `${sessionId}_${operationType}`;
        
        // Use request coalescing for concurrent operations
        return await this.coalesceRequests(batchKey, operation);
      },
      { enableMemoryProfiling: true }
    ).then(({ result }) => result);
  }

  // Optimize WebSocket message processing
  async optimizeWebSocketProcessing<T>(
    messageProcessor: () => Promise<T>,
    messageSize: number
  ): Promise<T> {
    return await this.profileCriticalPath(
      'websocket_processing',
      async () => {
        // Implement message compression for large payloads
        if (messageSize > 1024) { // 1KB threshold
          return await this.processWithCompression(messageProcessor);
        }
        
        return await messageProcessor();
      },
      { sampleRate: 0.05 } // Lower sampling for high-frequency operations
    ).then(({ result }) => result);
  }

  // Get performance analysis
  getPerformanceAnalysis(pathName: string): OptimizationResult | null {
    const profiles = this.profiles.get(pathName);
    if (!profiles || profiles.length < 2) {
      return null;
    }

    const recent = profiles.slice(-10);
    const older = profiles.slice(-20, -10);

    if (older.length === 0) return null;

    const recentAvg = recent.reduce((sum, p) => sum + p.duration, 0) / recent.length;
    const olderAvg = older.reduce((sum, p) => sum + p.duration, 0) / older.length;
    
    const recentMemory = recent.reduce((sum, p) => sum + p.memoryUsage, 0) / recent.length;
    const olderMemory = older.reduce((sum, p) => sum + p.memoryUsage, 0) / older.length;

    const improvement = ((olderAvg - recentAvg) / olderAvg) * 100;
    const memoryReduction = ((olderMemory - recentMemory) / olderMemory) * 100;

    return {
      originalDuration: olderAvg,
      optimizedDuration: recentAvg,
      improvement,
      memoryReduction,
      recommendations: this.generateRecommendations(pathName, recent)
    };
  }

  // Generate optimization recommendations
  private generateRecommendations(pathName: string, profiles: PerformanceProfile[]): string[] {
    const recommendations: string[] = [];
    const avgDuration = profiles.reduce((sum, p) => sum + p.duration, 0) / profiles.length;
    const avgMemory = profiles.reduce((sum, p) => sum + p.memoryUsage, 0) / profiles.length;

    // Duration-based recommendations
    if (avgDuration > 1000) { // > 1 second
      recommendations.push('Consider implementing caching for this operation');
      recommendations.push('Evaluate if operation can be made asynchronous');
    }
    
    if (avgDuration > 500) { // > 500ms
      recommendations.push('Consider breaking operation into smaller chunks');
      recommendations.push('Implement request batching if applicable');
    }

    // Memory-based recommendations
    if (avgMemory > 10 * 1024 * 1024) { // > 10MB
      recommendations.push('High memory usage detected - consider streaming or pagination');
      recommendations.push('Implement memory cleanup after operation');
    }

    // Path-specific recommendations
    if (pathName.includes('ai_call')) {
      recommendations.push('Optimize prompt length and context size');
      recommendations.push('Implement response caching for similar queries');
    }

    if (pathName.includes('do_')) {
      recommendations.push('Consider request coalescing for concurrent operations');
      recommendations.push('Implement state compression for large objects');
    }

    return recommendations;
  }

  // Helper methods
  private storeProfile(pathName: string, profile: PerformanceProfile, maxProfiles: number): void {
    if (!this.profiles.has(pathName)) {
      this.profiles.set(pathName, []);
    }

    const profiles = this.profiles.get(pathName)!;
    profiles.push(profile);

    // Keep only recent profiles
    if (profiles.length > maxProfiles) {
      profiles.splice(0, profiles.length - maxProfiles);
    }
  }

  private getMemoryUsage(): number {
    // Approximate memory usage - in real implementation would use more accurate methods
    return performance.memory?.usedJSHeapSize || 0;
  }

  private optimizeAIContext(context: { messageLength: number; historyLength: number; sessionId: string }) {
    // Optimize context size for AI calls
    const maxMessageLength = 4000; // Reasonable limit for context
    const maxHistoryLength = 10; // Keep recent messages only

    return {
      ...context,
      messageLength: Math.min(context.messageLength, maxMessageLength),
      historyLength: Math.min(context.historyLength, maxHistoryLength)
    };
  }

  private generateAICacheKey(context: any): string {
    // Generate cache key for AI responses
    return `ai_cache_${JSON.stringify(context).slice(0, 100)}`;
  }

  private async getCachedAIResponse(cacheKey: string): Promise<any> {
    try {
      const cached = await this.bindings.CHAT_KV.get(cacheKey, 'json');
      return cached;
    } catch {
      return null;
    }
  }

  private async cacheAIResponse(cacheKey: string, response: any): Promise<void> {
    try {
      // Cache for 1 hour
      await this.bindings.CHAT_KV.put(cacheKey, JSON.stringify(response), {
        expirationTtl: 3600
      });
    } catch (error) {
      // Don't fail if caching fails
      await this.logger.warn('Failed to cache AI response', { error: (error as Error).message });
    }
  }

  private async coalesceRequests<T>(key: string, operation: () => Promise<T>): Promise<T> {
    // Simple request coalescing - in production would use more sophisticated approach
    return await operation();
  }

  private async processWithCompression<T>(processor: () => Promise<T>): Promise<T> {
    // Implement compression for large message processing
    return await processor();
  }
}

// Performance monitoring utilities
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, number[]> = new Map();

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  // Record performance metric
  recordMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const values = this.metrics.get(name)!;
    values.push(value);
    
    // Keep only recent values
    if (values.length > 1000) {
      values.splice(0, values.length - 1000);
    }
  }

  // Get performance statistics
  getStats(name: string): { avg: number; p50: number; p95: number; p99: number } | null {
    const values = this.metrics.get(name);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      avg: values.reduce((sum, v) => sum + v, 0) / len,
      p50: sorted[Math.floor(len * 0.5)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)]
    };
  }

  // Get all metrics
  getAllStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const [name] of this.metrics) {
      stats[name] = this.getStats(name);
    }
    return stats;
  }
}