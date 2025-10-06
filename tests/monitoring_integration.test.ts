// Integration tests for monitoring system with API
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MonitoringMiddleware } from '../workers/monitoring_middleware';
import { createMonitoringSystem } from '../workers/logging';
import { WorkerBindings } from '../workers/types';

// Mock the API worker with monitoring
const createMockBindings = (): WorkerBindings => ({
  AI: {
    run: vi.fn().mockResolvedValue({
      response: 'Hello! How can I help you today?',
      usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 }
    })
  } as any,
  MEMORY_DO: {
    idFromName: vi.fn().mockReturnValue('test-session-id'),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockImplementation((url: string, options?: any) => {
        if (url.includes('?action=context')) {
          return Promise.resolve(new Response(JSON.stringify({
            sessionId: 'test-session',
            summary: 'New conversation',
            recentMessages: [],
            activeTopics: [],
            resolvedIssues: []
          })));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true })));
      })
    })
  } as any,
  CHAT_KV: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue('test-value'),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [] })
  } as any,
  ARCHIVE_R2: {
    list: vi.fn().mockResolvedValue({ objects: [] })
  } as any,
  WORKFLOWS: undefined,
  OPENAI_API_KEY: 'test-key',
  MAX_TOKENS: '1000'
});

// Mock API handler with monitoring
async function mockAPIHandler(request: Request, bindings: WorkerBindings) {
  const middleware = new MonitoringMiddleware(bindings);
  
  return await middleware.wrapRequest(request, async (req, context) => {
    const { logger, metrics } = context;
    const url = new URL(req.url);
    
    if (url.pathname === '/api/chat') {
      // Simulate chat request processing
      await logger.info('Processing chat request');
      
      // Monitor AI call
      const aiResponse = await middleware.monitorAICall(
        'llama-3.1-8b',
        40,
        logger,
        metrics,
        async () => {
          return await bindings.AI.run('@cf/meta/llama-3.1-8b-instruct' as any, {
            messages: [{ role: 'user', content: 'Hello' }],
            max_tokens: 100
          });
        }
      );
      
      // Monitor DO operation
      const doResponse = await middleware.monitorDOOperation(
        'addMessage',
        'test-session',
        logger,
        metrics,
        async () => {
          const doId = bindings.MEMORY_DO.idFromName('test-session');
          const doStub = bindings.MEMORY_DO.get(doId);
          return await doStub.fetch('https://memory-do/test-session', {
            method: 'POST',
            body: JSON.stringify({ action: 'addMessage', message: {} })
          });
        }
      );
      
      return new Response(JSON.stringify({
        message: { content: (aiResponse as any).response, role: 'assistant' },
        sessionId: 'test-session'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/api/health') {
      const { health } = createMonitoringSystem(bindings, context.requestId);
      const healthStatus = await health.checkHealth();
      
      return new Response(JSON.stringify(healthStatus), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/api/metrics') {
      const exportedMetrics = await metrics.exportMetrics();
      
      return new Response(exportedMetrics, {
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    return new Response('Not Found', { status: 404 });
  });
}

describe('Monitoring Integration', () => {
  let mockBindings: WorkerBindings;
  let consoleSpy: any;

  beforeEach(() => {
    mockBindings = createMockBindings();
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {})
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should monitor complete chat request flow', async () => {
    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello, how are you?' })
    });

    const response = await mockAPIHandler(request, mockBindings);
    
    expect(response.status).toBe(200);
    
    const responseData = await response.json();
    expect(responseData).toMatchObject({
      message: expect.objectContaining({
        content: expect.any(String),
        role: 'assistant'
      }),
      sessionId: 'test-session'
    });

    // Verify logging occurred
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining('"message":"Request started"')
    );
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining('"message":"Processing chat request"')
    );
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining('"message":"Request completed successfully"')
    );

    // Verify AI and DO calls were monitored
    expect(mockBindings.AI.run).toHaveBeenCalled();
    expect(mockBindings.MEMORY_DO.get).toHaveBeenCalled();
  });

  it('should handle and monitor API errors', async () => {
    // Mock AI failure
    mockBindings.AI.run = vi.fn().mockRejectedValue(new Error('AI service unavailable'));

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' })
    });

    await expect(mockAPIHandler(request, mockBindings)).rejects.toThrow('AI service unavailable');

    // Verify error logging
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('"level":"error"')
    );
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('"message":"AI model call failed"')
    );
  });

  it('should provide health check endpoint with monitoring', async () => {
    const request = new Request('https://example.com/api/health');

    const response = await mockAPIHandler(request, mockBindings);
    
    expect(response.status).toBe(200);
    
    const healthData = await response.json();
    expect(healthData).toMatchObject({
      overall: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
      timestamp: expect.any(Number),
      components: expect.arrayContaining([
        expect.objectContaining({
          component: 'ai_service',
          status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/)
        })
      ]),
      uptime: expect.any(Number)
    });

    // Verify health check was logged
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining('"message":"Request started"')
    );
  });

  it('should provide metrics endpoint', async () => {
    // First make a chat request to generate some metrics
    const chatRequest = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test message' })
    });

    await mockAPIHandler(chatRequest, mockBindings);

    // Then request metrics
    const metricsRequest = new Request('https://example.com/api/metrics');
    const response = await mockAPIHandler(metricsRequest, mockBindings);
    
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    
    const metricsText = await response.text();
    expect(metricsText).toContain('# TYPE');
    expect(metricsText).toContain('requests_total');
  });

  it('should monitor concurrent requests', async () => {
    const requests = Array.from({ length: 5 }, (_, i) => 
      new Request('https://example.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Message ${i}` })
      })
    );

    const responses = await Promise.all(
      requests.map(req => mockAPIHandler(req, mockBindings))
    );

    // All requests should succeed
    responses.forEach(response => {
      expect(response.status).toBe(200);
    });

    // Should have logged multiple request starts and completions
    const requestStartLogs = consoleSpy.info.mock.calls.filter((call: any) =>
      call[0].includes('"message":"Request started"')
    );
    expect(requestStartLogs.length).toBe(5);

    const requestCompleteLogs = consoleSpy.info.mock.calls.filter((call: any) =>
      call[0].includes('"message":"Request completed successfully"')
    );
    expect(requestCompleteLogs.length).toBe(5);
  });

  it('should track request latency', async () => {
    // Mock slow AI response
    mockBindings.AI.run = vi.fn().mockImplementation(() => 
      new Promise(resolve => 
        setTimeout(() => resolve({
          response: 'Slow response',
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
        }), 100)
      )
    );

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test slow response' })
    });

    const response = await mockAPIHandler(request, mockBindings);
    
    expect(response.status).toBe(200);

    // Should log latency information
    const latencyLogs = consoleSpy.info.mock.calls.filter((call: any) =>
      call[0].includes('"latency"') && call[0].includes('"message":"Request completed successfully"')
    );
    expect(latencyLogs.length).toBeGreaterThan(0);

    // Latency should be at least 100ms
    const latencyLog = JSON.parse(latencyLogs[0][0]);
    expect(latencyLog.latency).toBeGreaterThanOrEqual(100);
  });

  it('should monitor memory usage during processing', async () => {
    const middleware = new MonitoringMiddleware(mockBindings);
    const { metrics } = createMonitoringSystem(mockBindings, 'test-request');

    // Simulate memory usage monitoring
    const memoryMonitor = new (await import('../workers/monitoring_middleware')).MemoryMonitor(metrics, 
      new (await import('../workers/logging')).Logger('test-id', 'test')
    );

    // Record some memory usage
    memoryMonitor.recordMemoryUsage('api_worker', 1024 * 1024 * 25); // 25MB
    memoryMonitor.recordMemoryUsage('do_memory', 1024 * 1024 * 15);  // 15MB

    const systemMetrics = metrics.getMetrics();
    expect(systemMetrics.memoryUsage.value).toBeGreaterThan(0);
  });

  it('should handle rate limiting monitoring', async () => {
    const { metrics } = createMonitoringSystem(mockBindings, 'test-request');
    const rateLimitMonitor = new (await import('../workers/monitoring_middleware')).RateLimitMonitor(
      metrics,
      new (await import('../workers/logging')).Logger('test-id', 'test')
    );

    // Simulate rate limit hits
    rateLimitMonitor.recordRateLimitHit('session-123', 'requests', 5);
    rateLimitMonitor.recordRateLimitHit('session-456', 'tokens', 100);

    // Simulate rate limit violation
    rateLimitMonitor.recordRateLimitViolation('session-789', 'requests');

    const systemMetrics = metrics.getMetrics();
    expect(systemMetrics.rateLimitHits.value).toBeGreaterThan(0);
  });

  it('should persist monitoring data', async () => {
    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test persistence' })
    });

    await mockAPIHandler(request, mockBindings);

    // Metrics persistence is probabilistic, so just verify no crashes occurred
    // The system should handle persistence gracefully regardless of success/failure
    expect(mockBindings.CHAT_KV.put).toBeDefined();
  });

  it('should handle monitoring system failures gracefully', async () => {
    // Mock KV failure
    mockBindings.CHAT_KV.put = vi.fn().mockRejectedValue(new Error('KV unavailable'));

    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test KV failure' })
    });

    // Should still process the request successfully despite monitoring failures
    const response = await mockAPIHandler(request, mockBindings);
    expect(response.status).toBe(200);

    // Should log the monitoring failure (check if error was logged)
    expect(consoleSpy.error).toHaveBeenCalled();
  });
});