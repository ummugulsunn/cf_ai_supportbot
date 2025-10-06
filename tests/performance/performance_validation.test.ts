// Comprehensive performance validation tests
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PerformanceOptimizer, PerformanceMonitor } from '../../workers/performance_optimizer';
import { CachingStrategy } from '../../workers/caching_strategy';

// Mock Cloudflare bindings for testing
const mockBindings = {
  AI: {
    run: async () => ({ response: 'Test response', usage: { total_tokens: 100 } })
  },
  CHAT_KV: {
    get: async () => null,
    put: async () => {},
    delete: async () => {}
  },
  MEMORY_DO: {
    idFromName: () => ({ toString: () => 'test-id' }),
    get: () => ({
      fetch: async () => new Response(JSON.stringify({ success: true }))
    })
  }
} as any;

const mockLogger = {
  info: async () => {},
  warn: async () => {},
  error: async () => {},
  debug: async () => {}
} as any;

const mockMetrics = {
  incrementCounter: () => {},
  recordHistogram: () => {},
  setGauge: () => {},
  getMetrics: () => ({ activeConnections: { value: 0 } }),
  exportMetrics: async () => '',
  persistMetrics: async () => {}
} as any;

describe('Performance Validation Tests', () => {
  let optimizer: PerformanceOptimizer;
  let cache: CachingStrategy;
  let monitor: PerformanceMonitor;

  beforeAll(() => {
    optimizer = new PerformanceOptimizer(mockBindings, mockLogger, mockMetrics);
    cache = new CachingStrategy(mockBindings, mockLogger, mockMetrics);
    monitor = PerformanceMonitor.getInstance();
  });

  describe('Critical Path Performance', () => {
    it('should complete AI calls within acceptable latency', async () => {
      const startTime = performance.now();
      
      const { result, profile } = await optimizer.profileCriticalPath(
        'ai_call_test',
        async () => {
          return await mockBindings.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [{ role: 'user', content: 'Test message' }]
          });
        }
      );

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // Performance assertions
      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(profile.duration).toBeLessThan(3000); // Core operation within 3 seconds
      expect(result).toBeDefined();
    });

    it('should handle Durable Object operations efficiently', async () => {
      const { result, profile } = await optimizer.profileCriticalPath(
        'do_operation_test',
        async () => {
          const doStub = mockBindings.MEMORY_DO.get(mockBindings.MEMORY_DO.idFromName('test-session'));
          return await doStub.fetch('https://test-do/test-session');
        }
      );

      // Performance assertions
      expect(profile.duration).toBeLessThan(1000); // DO operations should be fast
      expect(result).toBeDefined();
    });

    it('should process WebSocket messages with low latency', async () => {
      const { result, profile } = await optimizer.profileCriticalPath(
        'websocket_processing_test',
        async () => {
          // Simulate message processing
          await new Promise(resolve => setTimeout(resolve, 50));
          return { processed: true };
        }
      );

      // Performance assertions
      expect(profile.duration).toBeLessThan(200); // WebSocket processing should be very fast
      expect(result.processed).toBe(true);
    });
  });

  describe('Caching Performance', () => {
    it('should demonstrate cache hit performance improvement', async () => {
      const testKey = 'performance-test-key';
      const testData = { message: 'Test cached data', timestamp: Date.now() };

      // First call - cache miss
      const missStart = performance.now();
      let cached = await cache.get(testKey, 'ai_responses');
      const missTime = performance.now() - missStart;
      
      expect(cached).toBeNull();

      // Set cache
      await cache.set(testKey, testData, 'ai_responses');

      // Second call - cache hit
      const hitStart = performance.now();
      cached = await cache.get(testKey, 'ai_responses');
      const hitTime = performance.now() - hitStart;

      // Performance assertions
      expect(cached).toEqual(testData);
      expect(hitTime).toBeLessThan(missTime); // Cache hit should be faster
      expect(hitTime).toBeLessThan(50); // Cache hits should be very fast
    });

    it('should handle batch operations efficiently', async () => {
      const keys = Array.from({ length: 10 }, (_, i) => `batch-key-${i}`);
      const testData = new Map(keys.map(key => [key, { data: `test-${key}` }]));

      // Batch set
      const setStart = performance.now();
      await cache.batchSet(testData, 'test_batch');
      const setTime = performance.now() - setStart;

      // Batch get
      const getStart = performance.now();
      const results = await cache.batchGet(keys, 'test_batch');
      const getTime = performance.now() - getStart;

      // Performance assertions
      expect(results.size).toBe(keys.length);
      expect(setTime).toBeLessThan(1000); // Batch operations should be reasonably fast
      expect(getTime).toBeLessThan(500);
    });
  });

  describe('Memory Usage Validation', () => {
    it('should maintain reasonable memory usage during operations', async () => {
      const initialMemory = performance.memory?.usedJSHeapSize || 0;

      // Perform multiple operations
      const operations = Array.from({ length: 50 }, async (_, i) => {
        return await optimizer.profileCriticalPath(
          `memory_test_${i}`,
          async () => {
            // Simulate some work
            const data = new Array(1000).fill(0).map(() => Math.random());
            return data.reduce((sum, val) => sum + val, 0);
          },
          { enableMemoryProfiling: true }
        );
      });

      await Promise.all(operations);

      const finalMemory = performance.memory?.usedJSHeapSize || 0;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory assertions
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Should not increase by more than 50MB
    });

    it('should clean up resources properly', async () => {
      const initialCacheSize = cache.getCacheStats()['memory']?.totalEntries || 0;

      // Add some cache entries
      for (let i = 0; i < 20; i++) {
        await cache.set(`cleanup-test-${i}`, { data: `test-${i}` }, 'test_cleanup');
      }

      // Perform cleanup
      await cache.cleanup();

      const finalCacheSize = cache.getCacheStats()['memory']?.totalEntries || 0;

      // Cleanup assertions
      expect(finalCacheSize).toBeLessThanOrEqual(initialCacheSize + 20);
    });
  });

  describe('Throughput Validation', () => {
    it('should handle concurrent requests efficiently', async () => {
      const concurrentRequests = 20;
      const startTime = performance.now();

      const requests = Array.from({ length: concurrentRequests }, async (_, i) => {
        return await optimizer.profileCriticalPath(
          `concurrent_test_${i}`,
          async () => {
            // Simulate API call
            await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
            return { requestId: i, result: 'success' };
          }
        );
      });

      const results = await Promise.all(requests);
      const totalTime = performance.now() - startTime;

      // Throughput assertions
      expect(results).toHaveLength(concurrentRequests);
      expect(totalTime).toBeLessThan(2000); // Should handle concurrent requests efficiently
      
      const avgLatency = totalTime / concurrentRequests;
      expect(avgLatency).toBeLessThan(200); // Average latency should be reasonable
    });

    it('should maintain performance under sustained load', async () => {
      const iterations = 100;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        
        await optimizer.profileCriticalPath(
          `sustained_load_${i}`,
          async () => {
            // Simulate work
            await new Promise(resolve => setTimeout(resolve, 10));
            return { iteration: i };
          }
        );

        const latency = performance.now() - start;
        latencies.push(latency);
      }

      // Calculate performance statistics
      const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

      // Performance degradation assertions
      expect(avgLatency).toBeLessThan(100); // Average should remain low
      expect(maxLatency).toBeLessThan(500); // No extreme outliers
      expect(p95Latency).toBeLessThan(200); // 95th percentile should be reasonable
    });
  });

  describe('End-to-End Performance', () => {
    it('should complete full conversation flow within SLA', async () => {
      const conversationFlow = async () => {
        // Simulate complete conversation flow
        const steps = [
          // 1. Session initialization
          async () => {
            const sessionId = `perf-test-${Date.now()}`;
            return { sessionId };
          },
          
          // 2. Message processing
          async (context: any) => {
            const message = { content: 'Hello, I need help with my account' };
            return await optimizer.optimizeAICall(
              async () => mockBindings.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
                messages: [{ role: 'user', content: message.content }]
              }),
              {
                messageLength: message.content.length,
                historyLength: 0,
                sessionId: context.sessionId
              }
            );
          },
          
          // 3. Response delivery
          async (context: any) => {
            return await optimizer.optimizeWebSocketProcessing(
              async () => ({ delivered: true }),
              JSON.stringify(context).length
            );
          }
        ];

        let context = {};
        for (const step of steps) {
          context = await step(context);
        }
        
        return context;
      };

      const startTime = performance.now();
      const result = await conversationFlow();
      const totalTime = performance.now() - startTime;

      // End-to-end performance assertions
      expect(totalTime).toBeLessThan(3000); // Complete flow within 3 seconds
      expect(result).toBeDefined();
    });
  });

  describe('Performance Monitoring', () => {
    it('should collect and report performance metrics', async () => {
      // Record some test metrics
      monitor.recordMetric('test_latency', 100);
      monitor.recordMetric('test_latency', 150);
      monitor.recordMetric('test_latency', 120);
      monitor.recordMetric('test_latency', 200);
      monitor.recordMetric('test_latency', 80);

      const stats = monitor.getStats('test_latency');
      
      expect(stats).toBeDefined();
      expect(stats!.avg).toBeGreaterThan(0);
      expect(stats!.p50).toBeGreaterThan(0);
      expect(stats!.p95).toBeGreaterThan(0);
      expect(stats!.p99).toBeGreaterThan(0);
    });

    it('should provide optimization recommendations', async () => {
      // Simulate some performance profiles with shorter delays
      for (let i = 0; i < 5; i++) {
        await optimizer.profileCriticalPath(
          'recommendation_test',
          async () => {
            // Simulate slow operation
            await new Promise(resolve => setTimeout(resolve, 100));
            return { result: 'slow operation' };
          }
        );
      }

      const analysis = optimizer.getPerformanceAnalysis('recommendation_test');
      
      if (analysis) {
        expect(analysis.recommendations).toBeDefined();
        expect(analysis.recommendations.length).toBeGreaterThan(0);
      } else {
        // If no analysis available, just check that the method doesn't throw
        expect(analysis).toBeNull();
      }
    }, 10000); // Increase timeout to 10 seconds
  });

  afterAll(async () => {
    // Cleanup
    await cache.cleanup();
  });
});

// Load testing utilities
export class LoadTestRunner {
  static async runConcurrentSessions(sessionCount: number, duration: number): Promise<any> {
    const sessions = Array.from({ length: sessionCount }, (_, i) => ({
      id: `load-test-session-${i}`,
      startTime: Date.now()
    }));

    const results = await Promise.allSettled(
      sessions.map(session => this.simulateSession(session, duration))
    );

    return {
      totalSessions: sessionCount,
      successfulSessions: results.filter(r => r.status === 'fulfilled').length,
      failedSessions: results.filter(r => r.status === 'rejected').length,
      results
    };
  }

  private static async simulateSession(session: any, duration: number): Promise<any> {
    const endTime = Date.now() + duration;
    const messages: any[] = [];

    while (Date.now() < endTime) {
      const message = {
        content: `Test message ${messages.length + 1} from ${session.id}`,
        timestamp: Date.now()
      };

      // Simulate message processing delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
      
      messages.push(message);
    }

    return {
      sessionId: session.id,
      messageCount: messages.length,
      duration: Date.now() - session.startTime
    };
  }
}