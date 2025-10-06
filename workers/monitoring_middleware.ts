// Monitoring middleware for request/response tracking
import { Logger, MetricsCollector, PerformanceMonitor } from './logging';
import { WorkerBindings } from './types';

export interface MonitoringContext {
  logger: Logger;
  metrics: MetricsCollector;
  requestId: string;
  startTime: number;
}

export class MonitoringMiddleware {
  private bindings: WorkerBindings;
  private globalMetrics: MetricsCollector;

  constructor(bindings: WorkerBindings) {
    this.bindings = bindings;
    this.globalMetrics = new MetricsCollector(bindings);
  }

  // Wrap request handler with monitoring
  async wrapRequest<T>(
    request: Request,
    handler: (request: Request, context: MonitoringContext) => Promise<T>
  ): Promise<T> {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    const url = new URL(request.url);
    
    // Create monitoring context
    const logger = new Logger(requestId, 'api', undefined, undefined, this.bindings);
    const metrics = new MetricsCollector(this.bindings);
    
    const context: MonitoringContext = {
      logger,
      metrics,
      requestId,
      startTime
    };

    // Log request start
    await logger.info('Request started', {
      method: request.method,
      path: url.pathname,
      userAgent: request.headers.get('User-Agent'),
      contentLength: request.headers.get('Content-Length')
    });

    // Increment request counter
    metrics.incrementCounter('requests_total', 1, {
      method: request.method,
      path: url.pathname
    });

    // Track active connections
    this.globalMetrics.setGauge('active_connections', 
      (this.globalMetrics.getMetrics().activeConnections.value || 0) + 1
    );

    try {
      // Execute handler with performance monitoring
      const { result, duration } = await PerformanceMonitor.measureAsync(
        `request_${requestId}`,
        () => handler(request, context),
        metrics
      );

      // Record successful request
      metrics.recordHistogram('request_latency', duration);
      metrics.incrementCounter('requests_success_total', 1, {
        method: request.method,
        path: url.pathname
      });

      // Log successful completion
      await logger.info('Request completed successfully', {
        method: request.method,
        path: url.pathname,
        statusCode: 200,
        responseTime: duration
      }, duration);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Record error metrics
      metrics.incrementCounter('errors_total', 1, {
        method: request.method,
        path: url.pathname,
        errorType: (error as Error).name
      });

      // Log error
      await logger.error('Request failed', error as Error, {
        method: request.method,
        path: url.pathname,
        responseTime: duration
      });

      throw error;

    } finally {
      // Decrement active connections
      this.globalMetrics.setGauge('active_connections', 
        Math.max(0, (this.globalMetrics.getMetrics().activeConnections.value || 1) - 1)
      );

      // Persist metrics periodically
      if (Math.random() < 0.1) { // 10% chance to persist
        await metrics.persistMetrics();
      }
    }
  }

  // Monitor AI model calls
  async monitorAICall<T>(
    modelName: string,
    tokenCount: number,
    logger: Logger,
    metrics: MetricsCollector,
    aiCall: () => Promise<T>
  ): Promise<T> {
    const callId = `ai_call_${Date.now()}`;
    
    await logger.debug('AI model call started', {
      model: modelName,
      estimatedTokens: tokenCount
    });

    try {
      const { result, duration } = await PerformanceMonitor.measureAsync(
        callId,
        aiCall,
        metrics
      );

      // Record AI metrics
      metrics.recordHistogram('ai_call_latency', duration, [100, 500, 1000, 2000, 5000, 10000]);
      metrics.incrementCounter('ai_calls_total', 1, { model: modelName });
      metrics.incrementCounter('ai_tokens_total', tokenCount, { model: modelName });

      await logger.info('AI model call completed', {
        model: modelName,
        tokens: tokenCount,
        duration
      }, duration);

      return result;

    } catch (error) {
      metrics.incrementCounter('ai_errors_total', 1, { 
        model: modelName,
        errorType: (error as Error).name 
      });

      await logger.error('AI model call failed', error as Error, {
        model: modelName,
        tokens: tokenCount
      });

      throw error;
    }
  }

  // Monitor tool execution
  async monitorToolExecution<T>(
    toolName: string,
    parameters: Record<string, any>,
    logger: Logger,
    metrics: MetricsCollector,
    toolCall: () => Promise<T>
  ): Promise<T> {
    const executionId = `tool_${toolName}_${Date.now()}`;
    
    await logger.debug('Tool execution started', {
      tool: toolName,
      parameters: Object.keys(parameters)
    });

    try {
      const { result, duration } = await PerformanceMonitor.measureAsync(
        executionId,
        toolCall,
        metrics
      );

      // Record tool metrics
      metrics.recordHistogram('tool_execution_time', duration);
      metrics.incrementCounter('tool_calls_total', 1, { tool: toolName });

      await logger.info('Tool execution completed', {
        tool: toolName,
        duration,
        success: true
      }, duration);

      return result;

    } catch (error) {
      metrics.incrementCounter('tool_errors_total', 1, { 
        tool: toolName,
        errorType: (error as Error).name 
      });

      await logger.error('Tool execution failed', error as Error, {
        tool: toolName,
        parameters: Object.keys(parameters)
      });

      throw error;
    }
  }

  // Monitor Durable Object operations
  async monitorDOOperation<T>(
    operation: string,
    sessionId: string,
    logger: Logger,
    metrics: MetricsCollector,
    doCall: () => Promise<T>
  ): Promise<T> {
    const operationId = `do_${operation}_${Date.now()}`;
    
    await logger.debug('Durable Object operation started', {
      operation,
      sessionId
    });

    try {
      const { result, duration } = await PerformanceMonitor.measureAsync(
        operationId,
        doCall,
        metrics
      );

      // Record DO metrics
      metrics.recordHistogram('do_operation_latency', duration);
      metrics.incrementCounter('do_operations_total', 1, { operation });

      await logger.info('Durable Object operation completed', {
        operation,
        sessionId,
        duration
      }, duration);

      return result;

    } catch (error) {
      metrics.incrementCounter('do_errors_total', 1, { 
        operation,
        errorType: (error as Error).name 
      });

      await logger.error('Durable Object operation failed', error as Error, {
        operation,
        sessionId
      });

      throw error;
    }
  }

  // Monitor security checks
  async monitorSecurityCheck<T>(
    checkType: string,
    sessionId: string,
    logger: Logger,
    metrics: MetricsCollector,
    securityCheck: () => Promise<T>
  ): Promise<T> {
    const checkId = `security_${checkType}_${Date.now()}`;
    
    try {
      const { result, duration } = await PerformanceMonitor.measureAsync(
        checkId,
        securityCheck,
        metrics
      );

      // Record security metrics
      metrics.recordHistogram('security_check_latency', duration);
      metrics.incrementCounter('security_checks_total', 1, { type: checkType });

      await logger.debug('Security check completed', {
        type: checkType,
        sessionId,
        duration
      });

      return result;

    } catch (error) {
      metrics.incrementCounter('security_errors_total', 1, { 
        type: checkType,
        errorType: (error as Error).name 
      });

      await logger.warn('Security check failed', {
        type: checkType,
        sessionId,
        error: (error as Error).message
      });

      throw error;
    }
  }

  // Get global metrics
  getGlobalMetrics(): MetricsCollector {
    return this.globalMetrics;
  }
}

// Rate limiting monitoring
export class RateLimitMonitor {
  private metrics: MetricsCollector;
  private logger: Logger;

  constructor(metrics: MetricsCollector, logger: Logger) {
    this.metrics = metrics;
    this.logger = logger;
  }

  recordRateLimitHit(sessionId: string, limitType: string, remaining: number): void {
    // Record with labels for detailed tracking
    this.metrics.incrementCounter('rate_limit_hits_total', 1, {
      type: limitType,
      sessionId
    });
    
    // Also update the base counter for aggregate metrics
    this.metrics.incrementCounter('rate_limit_hits_total', 1);

    this.metrics.setGauge('rate_limit_remaining', remaining, {
      type: limitType,
      sessionId
    });

    this.logger.warn('Rate limit hit', {
      sessionId,
      limitType,
      remaining
    });
  }

  recordRateLimitViolation(sessionId: string, limitType: string): void {
    this.metrics.incrementCounter('rate_limit_violations_total', 1, {
      type: limitType,
      sessionId
    });

    this.logger.error('Rate limit violation', undefined, {
      sessionId,
      limitType
    });
  }
}

// Memory usage monitoring
export class MemoryMonitor {
  private metrics: MetricsCollector;
  private logger: Logger;

  constructor(metrics: MetricsCollector, logger: Logger) {
    this.metrics = metrics;
    this.logger = logger;
  }

  recordMemoryUsage(component: string, bytes: number): void {
    // Record with component label for detailed tracking
    this.metrics.setGauge('memory_usage_bytes', bytes, { component });
    
    // Also update the base gauge for aggregate metrics
    const currentTotal = this.metrics.getMetrics().memoryUsage.value || 0;
    this.metrics.setGauge('memory_usage_bytes', Math.max(currentTotal, bytes));
    
    // Log warning if memory usage is high
    const mbUsage = bytes / (1024 * 1024);
    if (mbUsage > 50) { // 50MB threshold
      this.logger.warn('High memory usage detected', {
        component,
        memoryMB: mbUsage
      });
    }
  }

  recordMemoryLeak(component: string, previousBytes: number, currentBytes: number): void {
    const increase = currentBytes - previousBytes;
    const increasePercent = (increase / previousBytes) * 100;

    this.metrics.incrementCounter('memory_leaks_detected', 1, { component });
    
    this.logger.error('Potential memory leak detected', undefined, {
      component,
      previousMB: previousBytes / (1024 * 1024),
      currentMB: currentBytes / (1024 * 1024),
      increaseMB: increase / (1024 * 1024),
      increasePercent
    });
  }
}