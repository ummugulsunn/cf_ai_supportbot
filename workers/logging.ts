// Comprehensive logging and monitoring system
import {
  LogEntry,
  MetricEntry,
  SystemMetrics,
  HistogramMetric,
  CounterMetric,
  GaugeMetric,
  AlertRule,
  Alert,
  AlertCondition,
  HealthCheck,
  SystemHealth,
  WorkerBindings
} from './types';

export class Logger {
  private requestId: string;
  private sessionId?: string;
  private userId?: string;
  private component: string;
  private bindings?: WorkerBindings;

  constructor(
    requestId: string,
    component: string,
    sessionId?: string,
    userId?: string,
    bindings?: WorkerBindings
  ) {
    this.requestId = requestId;
    this.component = component;
    this.sessionId = sessionId;
    this.userId = userId;
    this.bindings = bindings;
  }

  private createLogEntry(
    level: LogEntry['level'],
    message: string,
    metadata?: Record<string, any>,
    error?: Error,
    latency?: number
  ): LogEntry {
    return {
      timestamp: Date.now(),
      level,
      message,
      requestId: this.requestId,
      sessionId: this.sessionId,
      userId: this.userId,
      component: this.component,
      metadata,
      latency,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    };
  }

  private async persistLog(entry: LogEntry): Promise<void> {
    // Log to console with structured format
    const logData = {
      ...entry,
      '@timestamp': new Date(entry.timestamp).toISOString()
    };
    
    switch (entry.level) {
      case 'debug':
        console.debug(JSON.stringify(logData));
        break;
      case 'info':
        console.info(JSON.stringify(logData));
        break;
      case 'warn':
        console.warn(JSON.stringify(logData));
        break;
      case 'error':
        console.error(JSON.stringify(logData));
        break;
    }

    // Optionally persist to KV for long-term storage
    if (this.bindings?.CHAT_KV && entry.level === 'error') {
      try {
        const key = `log:error:${entry.timestamp}:${entry.requestId}`;
        await this.bindings.CHAT_KV.put(key, JSON.stringify(entry), {
          expirationTtl: 86400 * 7 // 7 days
        });
      } catch (error) {
        console.error('Failed to persist error log to KV:', error);
      }
    }
  }

  async debug(message: string, metadata?: Record<string, any>): Promise<void> {
    const entry = this.createLogEntry('debug', message, metadata);
    await this.persistLog(entry);
  }

  async info(message: string, metadata?: Record<string, any>, latency?: number): Promise<void> {
    const entry = this.createLogEntry('info', message, metadata, undefined, latency);
    await this.persistLog(entry);
  }

  async warn(message: string, metadata?: Record<string, any>): Promise<void> {
    const entry = this.createLogEntry('warn', message, metadata);
    await this.persistLog(entry);
  }

  async error(message: string, error?: Error, metadata?: Record<string, any>): Promise<void> {
    const entry = this.createLogEntry('error', message, metadata, error);
    await this.persistLog(entry);
  }

  // Create child logger with additional context
  child(additionalContext: { sessionId?: string; userId?: string; component?: string }): Logger {
    return new Logger(
      this.requestId,
      additionalContext.component || this.component,
      additionalContext.sessionId || this.sessionId,
      additionalContext.userId || this.userId,
      this.bindings
    );
  }
}

export class MetricsCollector {
  private bindings: WorkerBindings;
  private metrics: Map<string, MetricEntry[]> = new Map();
  private counters: Map<string, CounterMetric> = new Map();
  private gauges: Map<string, GaugeMetric> = new Map();
  private histograms: Map<string, HistogramMetric> = new Map();

  constructor(bindings: WorkerBindings) {
    this.bindings = bindings;
  }

  // Counter operations
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    const existing = this.counters.get(key);
    
    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, {
        name,
        value,
        labels
      });
    }

    this.recordMetric({
      name,
      type: 'counter',
      value,
      timestamp: Date.now(),
      labels
    });
  }

  // Gauge operations
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    this.gauges.set(key, {
      name,
      value,
      labels
    });

    this.recordMetric({
      name,
      type: 'gauge',
      value,
      timestamp: Date.now(),
      labels
    });
  }

  // Histogram operations
  recordHistogram(name: string, value: number, buckets?: number[]): void {
    const defaultBuckets = [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000];
    const histogramBuckets = buckets || defaultBuckets;
    
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = {
        name,
        buckets: histogramBuckets,
        counts: new Array(histogramBuckets.length).fill(0),
        sum: 0,
        count: 0
      };
      this.histograms.set(name, histogram);
    }

    // Update histogram
    histogram.sum += value;
    histogram.count += 1;

    // Update bucket counts
    for (let i = 0; i < histogram.buckets.length; i++) {
      if (value <= histogram.buckets[i]) {
        histogram.counts[i] += 1;
      }
    }

    this.recordMetric({
      name,
      type: 'histogram',
      value,
      timestamp: Date.now()
    });
  }

  private getMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  private recordMetric(metric: MetricEntry): void {
    const key = metric.name;
    const existing = this.metrics.get(key) || [];
    existing.push(metric);
    
    // Keep only last 1000 entries per metric to prevent memory issues
    if (existing.length > 1000) {
      existing.splice(0, existing.length - 1000);
    }
    
    this.metrics.set(key, existing);
  }

  // Get current metrics snapshot
  getMetrics(): SystemMetrics {
    const requestLatency = this.histograms.get('request_latency') || {
      name: 'request_latency',
      buckets: [],
      counts: [],
      sum: 0,
      count: 0
    };

    const errorRate = this.counters.get('errors_total') || {
      name: 'errors_total',
      value: 0
    };

    const activeConnections = this.gauges.get('active_connections') || {
      name: 'active_connections',
      value: 0
    };

    const aiTokenUsage = this.counters.get('ai_tokens_total') || {
      name: 'ai_tokens_total',
      value: 0
    };

    const toolExecutionTime = this.histograms.get('tool_execution_time') || {
      name: 'tool_execution_time',
      buckets: [],
      counts: [],
      sum: 0,
      count: 0
    };

    const memoryUsage = this.gauges.get('memory_usage_bytes') || {
      name: 'memory_usage_bytes',
      value: 0
    };

    const rateLimitHits = this.counters.get('rate_limit_hits_total') || {
      name: 'rate_limit_hits_total',
      value: 0
    };

    return {
      requestLatency,
      errorRate,
      activeConnections,
      aiTokenUsage,
      toolExecutionTime,
      memoryUsage,
      rateLimitHits
    };
  }

  // Export metrics for external monitoring systems
  async exportMetrics(): Promise<string> {
    const lines: string[] = [];
    
    // Export counters
    for (const [key, counter] of this.counters) {
      const labelsStr = counter.labels ? 
        '{' + Object.entries(counter.labels).map(([k, v]) => `${k}="${v}"`).join(',') + '}' : '';
      lines.push(`# TYPE ${counter.name} counter`);
      lines.push(`${counter.name}${labelsStr} ${counter.value}`);
    }

    // Export gauges
    for (const [key, gauge] of this.gauges) {
      const labelsStr = gauge.labels ? 
        '{' + Object.entries(gauge.labels).map(([k, v]) => `${k}="${v}"`).join(',') + '}' : '';
      lines.push(`# TYPE ${gauge.name} gauge`);
      lines.push(`${gauge.name}${labelsStr} ${gauge.value}`);
    }

    // Export histograms
    for (const [key, histogram] of this.histograms) {
      lines.push(`# TYPE ${histogram.name} histogram`);
      for (let i = 0; i < histogram.buckets.length; i++) {
        lines.push(`${histogram.name}_bucket{le="${histogram.buckets[i]}"} ${histogram.counts[i]}`);
      }
      lines.push(`${histogram.name}_bucket{le="+Inf"} ${histogram.count}`);
      lines.push(`${histogram.name}_sum ${histogram.sum}`);
      lines.push(`${histogram.name}_count ${histogram.count}`);
    }

    return lines.join('\n');
  }

  // Persist metrics to KV for historical analysis
  async persistMetrics(): Promise<void> {
    try {
      const timestamp = Date.now();
      const metrics = this.getMetrics();
      const key = `metrics:${Math.floor(timestamp / 60000)}`; // Per minute
      
      await this.bindings.CHAT_KV.put(key, JSON.stringify({
        timestamp,
        metrics
      }), {
        expirationTtl: 86400 * 30 // 30 days
      });
    } catch (error) {
      console.error('Failed to persist metrics:', error);
    }
  }
}

export class AlertManager {
  private bindings: WorkerBindings;
  private rules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private metricsCollector: MetricsCollector;

  constructor(bindings: WorkerBindings, metricsCollector: MetricsCollector) {
    this.bindings = bindings;
    this.metricsCollector = metricsCollector;
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    // High error rate alert
    this.addRule({
      id: 'high_error_rate',
      name: 'High Error Rate',
      condition: {
        metric: 'errors_total',
        operator: 'gt',
        aggregation: 'count',
        timeWindow: 300 // 5 minutes
      },
      threshold: 10,
      duration: 60, // 1 minute
      severity: 'high',
      enabled: true
    });

    // High latency alert
    this.addRule({
      id: 'high_latency',
      name: 'High Request Latency',
      condition: {
        metric: 'request_latency',
        operator: 'gt',
        aggregation: 'avg',
        timeWindow: 300
      },
      threshold: 5000, // 5 seconds
      duration: 120, // 2 minutes
      severity: 'medium',
      enabled: true
    });

    // Rate limit threshold alert
    this.addRule({
      id: 'rate_limit_threshold',
      name: 'Rate Limit Threshold Exceeded',
      condition: {
        metric: 'rate_limit_hits_total',
        operator: 'gt',
        aggregation: 'count',
        timeWindow: 60
      },
      threshold: 100,
      duration: 30,
      severity: 'medium',
      enabled: true
    });

    // Memory usage alert
    this.addRule({
      id: 'high_memory_usage',
      name: 'High Memory Usage',
      condition: {
        metric: 'memory_usage_bytes',
        operator: 'gt',
        aggregation: 'max',
        timeWindow: 60
      },
      threshold: 100 * 1024 * 1024, // 100MB
      duration: 180, // 3 minutes
      severity: 'high',
      enabled: true
    });
  }

  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  async evaluateRules(): Promise<Alert[]> {
    const newAlerts: Alert[] = [];
    const currentTime = Date.now();

    for (const [ruleId, rule] of this.rules) {
      if (!rule.enabled) continue;

      try {
        const shouldAlert = await this.evaluateRule(rule);
        
        if (shouldAlert) {
          const existingAlert = this.activeAlerts.get(ruleId);
          
          if (!existingAlert) {
            // Create new alert
            const alert: Alert = {
              id: `alert_${ruleId}_${currentTime}`,
              ruleId,
              timestamp: currentTime,
              severity: rule.severity,
              message: `Alert: ${rule.name}`,
              value: 0, // Will be populated by evaluateRule
              threshold: rule.threshold,
              resolved: false
            };
            
            this.activeAlerts.set(ruleId, alert);
            newAlerts.push(alert);
            
            // Update rule last triggered time
            rule.lastTriggered = currentTime;
          }
        } else {
          // Check if we should resolve existing alert
          const existingAlert = this.activeAlerts.get(ruleId);
          if (existingAlert && !existingAlert.resolved) {
            existingAlert.resolved = true;
            existingAlert.resolvedAt = currentTime;
          }
        }
      } catch (error) {
        console.error(`Failed to evaluate alert rule ${ruleId}:`, error);
      }
    }

    // Persist alerts
    if (newAlerts.length > 0) {
      await this.persistAlerts(newAlerts);
    }

    return newAlerts;
  }

  private async evaluateRule(rule: AlertRule): Promise<boolean> {
    // This is a simplified evaluation - in a real system, you'd query
    // historical metrics data to evaluate the condition properly
    const metrics = this.metricsCollector.getMetrics();
    
    switch (rule.condition.metric) {
      case 'errors_total':
        return metrics.errorRate.value > rule.threshold;
      case 'request_latency':
        const avgLatency = metrics.requestLatency.count > 0 ? 
          metrics.requestLatency.sum / metrics.requestLatency.count : 0;
        return avgLatency > rule.threshold;
      case 'rate_limit_hits_total':
        return metrics.rateLimitHits.value > rule.threshold;
      case 'memory_usage_bytes':
        return metrics.memoryUsage.value > rule.threshold;
      default:
        return false;
    }
  }

  private async persistAlerts(alerts: Alert[]): Promise<void> {
    try {
      for (const alert of alerts) {
        const key = `alert:${alert.id}`;
        await this.bindings.CHAT_KV.put(key, JSON.stringify(alert), {
          expirationTtl: 86400 * 7 // 7 days
        });
      }
    } catch (error) {
      console.error('Failed to persist alerts:', error);
    }
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(alert => !alert.resolved);
  }

  async getAlertHistory(limit: number = 100): Promise<Alert[]> {
    try {
      const list = await this.bindings.CHAT_KV.list({ prefix: 'alert:' });
      const alerts: Alert[] = [];
      
      for (const key of list.keys.slice(0, limit)) {
        const alertData = await this.bindings.CHAT_KV.get(key.name);
        if (alertData) {
          alerts.push(JSON.parse(alertData));
        }
      }
      
      return alerts.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Failed to get alert history:', error);
      return [];
    }
  }
}

export class HealthMonitor {
  private bindings: WorkerBindings;
  private logger: Logger;
  private startTime: number;

  constructor(bindings: WorkerBindings, logger: Logger) {
    this.bindings = bindings;
    this.logger = logger;
    this.startTime = Date.now();
  }

  async checkHealth(): Promise<SystemHealth> {
    const components: HealthCheck[] = [];
    
    // Check AI service
    components.push(await this.checkAIService());
    
    // Check Durable Objects
    components.push(await this.checkDurableObjects());
    
    // Check KV store
    components.push(await this.checkKVStore());
    
    // Check R2 storage
    components.push(await this.checkR2Storage());

    // Determine overall health
    const unhealthyComponents = components.filter(c => c.status === 'unhealthy');
    const degradedComponents = components.filter(c => c.status === 'degraded');
    
    let overall: SystemHealth['overall'];
    if (unhealthyComponents.length > 0) {
      overall = 'unhealthy';
    } else if (degradedComponents.length > 0) {
      overall = 'degraded';
    } else {
      overall = 'healthy';
    }

    return {
      overall,
      timestamp: Date.now(),
      components,
      uptime: Date.now() - this.startTime,
      version: '1.0.0'
    };
  }

  private async checkAIService(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Simple health check - try to get model info or make a minimal request
      const response = await this.bindings.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      });
      
      const latency = Date.now() - startTime;
      
      return {
        component: 'ai_service',
        status: latency > 1500 ? 'degraded' : 'healthy',
        timestamp: Date.now(),
        latency,
        metadata: { model: 'llama-3.1-8b-instruct' }
      };
    } catch (error) {
      await this.logger.error('AI service health check failed', error as Error);
      return {
        component: 'ai_service',
        status: 'unhealthy',
        timestamp: Date.now(),
        latency: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  private async checkDurableObjects(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Create a test DO instance and perform a simple operation
      const testId = this.bindings.MEMORY_DO.idFromName('health_check');
      const doStub = this.bindings.MEMORY_DO.get(testId);
      
      const response = await doStub.fetch('https://memory-do/health_check?action=ping');
      const latency = Date.now() - startTime;
      
      return {
        component: 'durable_objects',
        status: response.ok ? (latency > 5000 ? 'degraded' : 'healthy') : 'unhealthy',
        timestamp: Date.now(),
        latency
      };
    } catch (error) {
      await this.logger.error('Durable Objects health check failed', error as Error);
      return {
        component: 'durable_objects',
        status: 'unhealthy',
        timestamp: Date.now(),
        latency: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  private async checkKVStore(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Test KV read/write
      const testKey = `health_check_${Date.now()}`;
      const testValue = 'ping';
      
      await this.bindings.CHAT_KV.put(testKey, testValue, { expirationTtl: 60 });
      const retrieved = await this.bindings.CHAT_KV.get(testKey);
      
      const latency = Date.now() - startTime;
      const isHealthy = retrieved === testValue;
      
      // Clean up
      await this.bindings.CHAT_KV.delete(testKey);
      
      return {
        component: 'kv_store',
        status: isHealthy ? (latency > 2000 ? 'degraded' : 'healthy') : 'unhealthy',
        timestamp: Date.now(),
        latency
      };
    } catch (error) {
      await this.logger.error('KV store health check failed', error as Error);
      return {
        component: 'kv_store',
        status: 'unhealthy',
        timestamp: Date.now(),
        latency: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  private async checkR2Storage(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Test R2 by listing objects (minimal operation)
      const list = await this.bindings.ARCHIVE_R2.list({ limit: 1 });
      const latency = Date.now() - startTime;
      
      return {
        component: 'r2_storage',
        status: latency > 3000 ? 'degraded' : 'healthy',
        timestamp: Date.now(),
        latency,
        metadata: { objectCount: list.objects.length }
      };
    } catch (error) {
      await this.logger.error('R2 storage health check failed', error as Error);
      return {
        component: 'r2_storage',
        status: 'unhealthy',
        timestamp: Date.now(),
        latency: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }
}

// Performance monitoring utilities
export class PerformanceMonitor {
  private static timers: Map<string, number> = new Map();
  
  static startTimer(id: string): void {
    this.timers.set(id, Date.now());
  }
  
  static endTimer(id: string): number {
    const startTime = this.timers.get(id);
    if (!startTime) {
      throw new Error(`Timer ${id} not found`);
    }
    
    const duration = Date.now() - startTime;
    this.timers.delete(id);
    return duration;
  }
  
  static async measureAsync<T>(
    id: string, 
    fn: () => Promise<T>,
    metricsCollector?: MetricsCollector
  ): Promise<{ result: T; duration: number }> {
    // Use unique ID to avoid conflicts in concurrent execution
    const uniqueId = `${id}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.startTimer(uniqueId);
    try {
      const result = await fn();
      const duration = this.endTimer(uniqueId);
      
      if (metricsCollector) {
        metricsCollector.recordHistogram(`${id}_duration`, duration);
      }
      
      return { result, duration };
    } catch (error) {
      // Clean up timer even on error
      if (this.timers.has(uniqueId)) {
        this.timers.delete(uniqueId);
      }
      throw error;
    }
  }
}

// Factory function to create monitoring instances
export function createMonitoringSystem(
  bindings: WorkerBindings,
  requestId: string,
  component: string = 'api'
): {
  logger: Logger;
  metrics: MetricsCollector;
  alerts: AlertManager;
  health: HealthMonitor;
} {
  const logger = new Logger(requestId, component, undefined, undefined, bindings);
  const metrics = new MetricsCollector(bindings);
  const alerts = new AlertManager(bindings, metrics);
  const health = new HealthMonitor(bindings, logger);

  return { logger, metrics, alerts, health };
}