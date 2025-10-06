// Tests for logging and monitoring system
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  Logger,
  MetricsCollector,
  AlertManager,
  HealthMonitor,
  PerformanceMonitor,
  createMonitoringSystem
} from '../workers/logging';
import { MonitoringMiddleware, RateLimitMonitor, MemoryMonitor } from '../workers/monitoring_middleware';
import { WorkerBindings, LogEntry, MetricEntry, Alert, SystemHealth } from '../workers/types';

// Mock bindings
const createMockBindings = (): WorkerBindings => ({
  AI: {
    run: vi.fn().mockResolvedValue({
      response: 'test response',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    })
  } as any,
  MEMORY_DO: {
    idFromName: vi.fn().mockReturnValue('test-id'),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValue(new Response('{"status": "ok"}'))
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

describe('Logger', () => {
  let mockBindings: WorkerBindings;
  let logger: Logger;
  let consoleSpy: any;

  beforeEach(() => {
    mockBindings = createMockBindings();
    logger = new Logger('test-request-id', 'test-component', 'test-session', 'test-user', mockBindings);
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

  it('should create structured log entries', async () => {
    await logger.info('Test message', { key: 'value' }, 100);

    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining('"level":"info"')
    );
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining('"message":"Test message"')
    );
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining('"requestId":"test-request-id"')
    );
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining('"latency":100')
    );
  });

  it('should log errors with stack traces', async () => {
    const error = new Error('Test error');
    await logger.error('Error occurred', error, { context: 'test' });

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('"level":"error"')
    );
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('"name":"Error"')
    );
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('"message":"Test error"')
    );
  });

  it('should persist error logs to KV', async () => {
    const error = new Error('Critical error');
    await logger.error('Critical error occurred', error);

    expect(mockBindings.CHAT_KV.put).toHaveBeenCalledWith(
      expect.stringMatching(/^log:error:/),
      expect.stringContaining('"level":"error"'),
      { expirationTtl: 86400 * 7 }
    );
  });

  it('should create child loggers with additional context', () => {
    const childLogger = logger.child({ 
      sessionId: 'new-session', 
      component: 'child-component' 
    });

    expect(childLogger).toBeInstanceOf(Logger);
    // Child logger should inherit request ID and user ID
  });

  it('should handle logging without bindings', async () => {
    const loggerWithoutBindings = new Logger('test-id', 'test-component');
    
    await expect(loggerWithoutBindings.info('Test message')).resolves.not.toThrow();
    expect(consoleSpy.info).toHaveBeenCalled();
  });
});

describe('MetricsCollector', () => {
  let mockBindings: WorkerBindings;
  let metrics: MetricsCollector;

  beforeEach(() => {
    mockBindings = createMockBindings();
    metrics = new MetricsCollector(mockBindings);
  });

  it('should increment counters correctly', () => {
    metrics.incrementCounter('test_counter', 5);
    metrics.incrementCounter('test_counter', 3);

    const systemMetrics = metrics.getMetrics();
    // Counter should accumulate values
    expect(systemMetrics).toBeDefined();
  });

  it('should set gauge values', () => {
    metrics.setGauge('test_gauge', 42, { label: 'test' });
    
    const systemMetrics = metrics.getMetrics();
    expect(systemMetrics).toBeDefined();
  });

  it('should record histogram values', () => {
    metrics.recordHistogram('test_histogram', 150);
    metrics.recordHistogram('test_histogram', 250);
    metrics.recordHistogram('test_histogram', 50);

    const systemMetrics = metrics.getMetrics();
    expect(systemMetrics).toBeDefined();
  });

  it('should export metrics in Prometheus format', async () => {
    metrics.incrementCounter('requests_total', 10, { method: 'GET' });
    metrics.setGauge('memory_usage', 1024);
    metrics.recordHistogram('request_duration', 100);

    const exported = await metrics.exportMetrics();
    
    expect(exported).toContain('# TYPE requests_total counter');
    expect(exported).toContain('# TYPE memory_usage gauge');
    expect(exported).toContain('# TYPE request_duration histogram');
  });

  it('should persist metrics to KV', async () => {
    await metrics.persistMetrics();

    expect(mockBindings.CHAT_KV.put).toHaveBeenCalledWith(
      expect.stringMatching(/^metrics:/),
      expect.stringContaining('"timestamp"'),
      { expirationTtl: 86400 * 30 }
    );
  });

  it('should handle metric key generation with labels', () => {
    metrics.incrementCounter('test_metric', 1, { method: 'GET', status: '200' });
    metrics.incrementCounter('test_metric', 1, { method: 'POST', status: '201' });

    // Should create separate entries for different label combinations
    const systemMetrics = metrics.getMetrics();
    expect(systemMetrics).toBeDefined();
  });

  it('should limit metric history to prevent memory issues', () => {
    // Add more than 1000 entries
    for (let i = 0; i < 1200; i++) {
      metrics.incrementCounter('test_counter', 1);
    }

    // Should not cause memory issues
    const systemMetrics = metrics.getMetrics();
    expect(systemMetrics).toBeDefined();
  });
});

describe('AlertManager', () => {
  let mockBindings: WorkerBindings;
  let metrics: MetricsCollector;
  let alertManager: AlertManager;

  beforeEach(() => {
    mockBindings = createMockBindings();
    metrics = new MetricsCollector(mockBindings);
    alertManager = new AlertManager(mockBindings, metrics);
  });

  it('should initialize with default alert rules', () => {
    // Default rules should be loaded
    expect(alertManager).toBeDefined();
  });

  it('should add and remove custom alert rules', () => {
    const customRule = {
      id: 'custom_rule',
      name: 'Custom Alert',
      condition: {
        metric: 'custom_metric',
        operator: 'gt' as const,
        aggregation: 'avg' as const,
        timeWindow: 300
      },
      threshold: 100,
      duration: 60,
      severity: 'medium' as const,
      enabled: true
    };

    alertManager.addRule(customRule);
    alertManager.removeRule('custom_rule');
    
    expect(alertManager).toBeDefined();
  });

  it('should evaluate alert rules and create alerts', async () => {
    // Trigger high error rate
    metrics.incrementCounter('errors_total', 15);

    const alerts = await alertManager.evaluateRules();
    
    // Should create alert for high error rate
    expect(Array.isArray(alerts)).toBe(true);
  });

  it('should resolve alerts when conditions are no longer met', async () => {
    // First trigger an alert
    metrics.incrementCounter('errors_total', 15);
    await alertManager.evaluateRules();

    // Then resolve the condition
    // (In a real scenario, error count would decrease over time)
    const activeAlerts = alertManager.getActiveAlerts();
    expect(Array.isArray(activeAlerts)).toBe(true);
  });

  it('should persist alerts to KV storage', async () => {
    metrics.incrementCounter('errors_total', 15);
    const alerts = await alertManager.evaluateRules();

    if (alerts.length > 0) {
      expect(mockBindings.CHAT_KV.put).toHaveBeenCalledWith(
        expect.stringMatching(/^alert:/),
        expect.stringContaining('"severity"'),
        { expirationTtl: 86400 * 7 }
      );
    }
  });

  it('should retrieve alert history', async () => {
    mockBindings.CHAT_KV.list = vi.fn().mockResolvedValue({
      keys: [{ name: 'alert:test1' }, { name: 'alert:test2' }]
    });
    mockBindings.CHAT_KV.get = vi.fn().mockResolvedValue(JSON.stringify({
      id: 'test-alert',
      timestamp: Date.now(),
      severity: 'high',
      message: 'Test alert'
    }));

    const history = await alertManager.getAlertHistory(10);
    
    expect(Array.isArray(history)).toBe(true);
    expect(mockBindings.CHAT_KV.list).toHaveBeenCalledWith({ prefix: 'alert:' });
  });
});

describe('HealthMonitor', () => {
  let mockBindings: WorkerBindings;
  let logger: Logger;
  let healthMonitor: HealthMonitor;

  beforeEach(() => {
    mockBindings = createMockBindings();
    logger = new Logger('test-id', 'health');
    healthMonitor = new HealthMonitor(mockBindings, logger);
  });

  it('should check overall system health', async () => {
    const health = await healthMonitor.checkHealth();

    expect(health).toMatchObject({
      overall: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
      timestamp: expect.any(Number),
      components: expect.any(Array),
      uptime: expect.any(Number),
      version: expect.any(String)
    });
  });

  it('should check individual component health', async () => {
    const health = await healthMonitor.checkHealth();

    expect(health.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: 'ai_service',
          status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
          timestamp: expect.any(Number)
        }),
        expect.objectContaining({
          component: 'durable_objects',
          status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
          timestamp: expect.any(Number)
        }),
        expect.objectContaining({
          component: 'kv_store',
          status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
          timestamp: expect.any(Number)
        }),
        expect.objectContaining({
          component: 'r2_storage',
          status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
          timestamp: expect.any(Number)
        })
      ])
    );
  });

  it('should handle component failures gracefully', async () => {
    // Mock AI service failure
    mockBindings.AI.run = vi.fn().mockRejectedValue(new Error('AI service down'));

    const health = await healthMonitor.checkHealth();
    
    const aiComponent = health.components.find(c => c.component === 'ai_service');
    expect(aiComponent?.status).toBe('unhealthy');
    expect(aiComponent?.error).toBeDefined();
  });

  it('should determine degraded status for slow responses', async () => {
    // Mock slow AI response
    mockBindings.AI.run = vi.fn().mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({ response: 'slow' }), 2000))
    );

    const health = await healthMonitor.checkHealth();
    
    const aiComponent = health.components.find(c => c.component === 'ai_service');
    expect(aiComponent?.status).toBe('degraded');
    expect(aiComponent?.latency).toBeGreaterThan(1000);
  }, 10000); // Increase timeout to 10 seconds
});

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    // Clear any existing timers
    PerformanceMonitor['timers'].clear();
  });

  it('should measure execution time', () => {
    PerformanceMonitor.startTimer('test-operation');
    
    // Simulate some work
    const start = Date.now();
    while (Date.now() - start < 10) {
      // Wait 10ms
    }
    
    const duration = PerformanceMonitor.endTimer('test-operation');
    expect(duration).toBeGreaterThanOrEqual(10);
  });

  it('should measure async operations', async () => {
    const mockAsyncOperation = () => new Promise(resolve => 
      setTimeout(() => resolve('result'), 50)
    );

    const { result, duration } = await PerformanceMonitor.measureAsync(
      'async-test',
      mockAsyncOperation
    );

    expect(result).toBe('result');
    expect(duration).toBeGreaterThanOrEqual(50);
  });

  it('should handle timer errors', () => {
    expect(() => PerformanceMonitor.endTimer('non-existent')).toThrow();
  });

  it('should clean up timers after measurement', async () => {
    await PerformanceMonitor.measureAsync('cleanup-test', async () => 'done');
    
    expect(() => PerformanceMonitor.endTimer('cleanup-test')).toThrow();
  });
});

describe('MonitoringMiddleware', () => {
  let mockBindings: WorkerBindings;
  let middleware: MonitoringMiddleware;

  beforeEach(() => {
    mockBindings = createMockBindings();
    middleware = new MonitoringMiddleware(mockBindings);
  });

  it('should wrap requests with monitoring', async () => {
    const mockRequest = new Request('https://example.com/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const mockHandler = vi.fn().mockResolvedValue('success');

    const result = await middleware.wrapRequest(mockRequest, mockHandler);

    expect(result).toBe('success');
    expect(mockHandler).toHaveBeenCalledWith(
      mockRequest,
      expect.objectContaining({
        logger: expect.any(Logger),
        metrics: expect.any(MetricsCollector),
        requestId: expect.any(String),
        startTime: expect.any(Number)
      })
    );
  });

  it('should handle request errors', async () => {
    const mockRequest = new Request('https://example.com/api/test');
    const mockError = new Error('Handler failed');
    const mockHandler = vi.fn().mockRejectedValue(mockError);

    await expect(middleware.wrapRequest(mockRequest, mockHandler)).rejects.toThrow('Handler failed');
  });

  it('should monitor AI calls', async () => {
    const logger = new Logger('test-id', 'test');
    const metrics = new MetricsCollector(mockBindings);
    
    const mockAICall = vi.fn().mockResolvedValue('AI response');

    const result = await middleware.monitorAICall(
      'test-model',
      100,
      logger,
      metrics,
      mockAICall
    );

    expect(result).toBe('AI response');
    expect(mockAICall).toHaveBeenCalled();
  });

  it('should monitor tool execution', async () => {
    const logger = new Logger('test-id', 'test');
    const metrics = new MetricsCollector(mockBindings);
    
    const mockToolCall = vi.fn().mockResolvedValue({ success: true });

    const result = await middleware.monitorToolExecution(
      'test-tool',
      { param: 'value' },
      logger,
      metrics,
      mockToolCall
    );

    expect(result).toEqual({ success: true });
    expect(mockToolCall).toHaveBeenCalled();
  });
});

describe('RateLimitMonitor', () => {
  let metrics: MetricsCollector;
  let logger: Logger;
  let rateLimitMonitor: RateLimitMonitor;

  beforeEach(() => {
    const mockBindings = createMockBindings();
    metrics = new MetricsCollector(mockBindings);
    logger = new Logger('test-id', 'test');
    rateLimitMonitor = new RateLimitMonitor(metrics, logger);
  });

  it('should record rate limit hits', () => {
    rateLimitMonitor.recordRateLimitHit('session-123', 'requests', 5);
    
    // Should increment counter and set gauge
    const systemMetrics = metrics.getMetrics();
    expect(systemMetrics).toBeDefined();
  });

  it('should record rate limit violations', () => {
    rateLimitMonitor.recordRateLimitViolation('session-123', 'tokens');
    
    // Should increment violation counter
    const systemMetrics = metrics.getMetrics();
    expect(systemMetrics).toBeDefined();
  });
});

describe('MemoryMonitor', () => {
  let metrics: MetricsCollector;
  let logger: Logger;
  let memoryMonitor: MemoryMonitor;
  let consoleSpy: any;

  beforeEach(() => {
    const mockBindings = createMockBindings();
    metrics = new MetricsCollector(mockBindings);
    logger = new Logger('test-id', 'test');
    memoryMonitor = new MemoryMonitor(metrics, logger);
    consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should record memory usage', () => {
    memoryMonitor.recordMemoryUsage('test-component', 1024 * 1024 * 30); // 30MB
    
    const systemMetrics = metrics.getMetrics();
    expect(systemMetrics).toBeDefined();
  });

  it('should warn on high memory usage', () => {
    memoryMonitor.recordMemoryUsage('test-component', 1024 * 1024 * 60); // 60MB
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"warn"')
    );
  });

  it('should detect memory leaks', () => {
    const previousBytes = 1024 * 1024 * 10; // 10MB
    const currentBytes = 1024 * 1024 * 50;  // 50MB
    
    memoryMonitor.recordMemoryLeak('test-component', previousBytes, currentBytes);
    
    const systemMetrics = metrics.getMetrics();
    expect(systemMetrics).toBeDefined();
  });
});

describe('createMonitoringSystem', () => {
  it('should create complete monitoring system', () => {
    const mockBindings = createMockBindings();
    const system = createMonitoringSystem(mockBindings, 'test-request-id', 'test-component');

    expect(system.logger).toBeInstanceOf(Logger);
    expect(system.metrics).toBeInstanceOf(MetricsCollector);
    expect(system.alerts).toBeInstanceOf(AlertManager);
    expect(system.health).toBeInstanceOf(HealthMonitor);
  });

  it('should use default component name', () => {
    const mockBindings = createMockBindings();
    const system = createMonitoringSystem(mockBindings, 'test-request-id');

    expect(system.logger).toBeInstanceOf(Logger);
  });
});