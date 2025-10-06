# Comprehensive Logging and Monitoring System

This document describes the comprehensive logging and monitoring system implemented for the Cloudflare AI Support Bot. The system provides structured logging, metrics collection, alerting, health monitoring, and performance tracking.

## Overview

The monitoring system consists of several key components:

- **Logger**: Structured logging with request IDs and latency tracking
- **MetricsCollector**: Collection of counters, gauges, and histograms
- **AlertManager**: Configurable alerting rules and notifications
- **HealthMonitor**: Component health checks and system status
- **PerformanceMonitor**: Execution time measurement and optimization
- **MonitoringMiddleware**: Automatic request/response monitoring

## Features

### ✅ Structured Logging
- Request ID tracking across all components
- Latency measurement for all operations
- Error logging with stack traces
- Metadata enrichment for context
- Automatic log persistence to KV storage

### ✅ Metrics Collection
- **Counters**: Request counts, error rates, token usage
- **Gauges**: Active connections, memory usage, rate limits
- **Histograms**: Response times, tool execution duration
- Prometheus-compatible export format
- Automatic metric aggregation and storage

### ✅ Performance Monitoring
- Request/response latency tracking
- AI model call performance
- Tool execution timing
- Durable Object operation monitoring
- Memory usage and leak detection

### ✅ Alert System
- Configurable alert rules with thresholds
- Multiple severity levels (low, medium, high, critical)
- Automatic alert evaluation and triggering
- Alert history and resolution tracking
- Built-in rules for common issues

### ✅ Health Monitoring
- Component-level health checks
- Overall system health status
- Latency-based degradation detection
- Automatic service availability monitoring
- Uptime tracking

### ✅ Security Monitoring
- Rate limiting event tracking
- PII detection and filtering monitoring
- Security violation logging
- Content filtering metrics
- Request pattern analysis

## Usage

### Basic Setup

```typescript
import { createMonitoringSystem } from './workers/logging';
import { MonitoringMiddleware } from './workers/monitoring_middleware';

// Create monitoring system
const { logger, metrics, alerts, health } = createMonitoringSystem(
  bindings,
  requestId,
  'component-name'
);

// Create middleware for automatic monitoring
const middleware = new MonitoringMiddleware(bindings);
```

### Logging Examples

```typescript
// Basic logging
await logger.info('Operation completed', { userId: 'user123' }, 150);
await logger.warn('High memory usage detected', { memoryMB: 85 });
await logger.error('Database connection failed', error, { retryCount: 3 });

// Child logger with additional context
const childLogger = logger.child({ 
  sessionId: 'sess_123', 
  component: 'ai_processor' 
});
await childLogger.debug('Processing AI request');
```

### Metrics Collection

```typescript
// Counter metrics
metrics.incrementCounter('requests_total', 1, { method: 'POST', status: '200' });
metrics.incrementCounter('ai_tokens_used', 150, { model: 'llama-3.1' });

// Gauge metrics
metrics.setGauge('active_sessions', 42);
metrics.setGauge('memory_usage_bytes', 128 * 1024 * 1024);

// Histogram metrics
metrics.recordHistogram('request_duration_ms', 250);
metrics.recordHistogram('ai_call_latency', 1500);
```

### Performance Monitoring

```typescript
// Manual timing
PerformanceMonitor.startTimer('operation_id');
// ... perform operation
const duration = PerformanceMonitor.endTimer('operation_id');

// Automatic timing with metrics
const { result, duration } = await PerformanceMonitor.measureAsync(
  'ai_processing',
  async () => {
    return await processWithAI(message);
  },
  metrics
);
```

### Middleware Integration

```typescript
// Wrap API handler with monitoring
export default {
  async fetch(request: Request, env: WorkerBindings): Promise<Response> {
    const middleware = new MonitoringMiddleware(env);
    
    return await middleware.wrapRequest(request, async (req, context) => {
      const { logger, metrics, requestId } = context;
      
      // Your API logic here with automatic monitoring
      return await handleRequest(req, logger, metrics);
    });
  }
};
```

### Health Checks

```typescript
// Check system health
const healthStatus = await health.checkHealth();
console.log(`System status: ${healthStatus.overall}`);

// Check individual components
healthStatus.components.forEach(component => {
  console.log(`${component.component}: ${component.status} (${component.latency}ms)`);
});
```

### Alert Management

```typescript
// Add custom alert rule
alerts.addRule({
  id: 'high_error_rate',
  name: 'High Error Rate Alert',
  condition: {
    metric: 'errors_total',
    operator: 'gt',
    aggregation: 'count',
    timeWindow: 300
  },
  threshold: 10,
  duration: 60,
  severity: 'high',
  enabled: true
});

// Evaluate alerts
const triggeredAlerts = await alerts.evaluateRules();
const activeAlerts = alerts.getActiveAlerts();
```

## API Endpoints

The monitoring system exposes several API endpoints:

### GET /api/health
Returns system health status including component checks.

```json
{
  "overall": "healthy",
  "timestamp": 1640995200000,
  "components": [
    {
      "component": "ai_service",
      "status": "healthy",
      "latency": 150,
      "timestamp": 1640995200000
    }
  ],
  "uptime": 86400000,
  "version": "1.0.0"
}
```

### GET /api/metrics
Returns Prometheus-formatted metrics for external monitoring systems.

```
# TYPE requests_total counter
requests_total{method="GET",status="200"} 1234
requests_total{method="POST",status="200"} 567

# TYPE memory_usage_bytes gauge
memory_usage_bytes{component="api"} 134217728

# TYPE request_duration_ms histogram
request_duration_ms_bucket{le="100"} 245
request_duration_ms_bucket{le="500"} 432
request_duration_ms_sum 12345
request_duration_ms_count 500
```

### GET /api/alerts
Returns active alerts and alert history.

```json
{
  "alerts": [
    {
      "id": "alert_high_error_rate_1640995200000",
      "ruleId": "high_error_rate",
      "timestamp": 1640995200000,
      "severity": "high",
      "message": "Alert: High Error Rate",
      "value": 15,
      "threshold": 10,
      "resolved": false
    }
  ],
  "requestId": "req_123",
  "timestamp": 1640995200000
}
```

## Built-in Alert Rules

The system includes several default alert rules:

1. **High Error Rate**: Triggers when error count exceeds 10 in 5 minutes
2. **High Latency**: Triggers when average latency exceeds 5 seconds for 2 minutes
3. **Rate Limit Threshold**: Triggers when rate limit hits exceed 100 per minute
4. **High Memory Usage**: Triggers when memory usage exceeds 100MB for 3 minutes

## Metrics Reference

### Request Metrics
- `requests_total`: Total number of requests (counter)
- `requests_success_total`: Successful requests (counter)
- `request_latency`: Request processing time (histogram)
- `active_connections`: Current active connections (gauge)

### AI Metrics
- `ai_calls_total`: Total AI model calls (counter)
- `ai_tokens_total`: Total tokens processed (counter)
- `ai_call_latency`: AI call response time (histogram)
- `ai_errors_total`: AI call failures (counter)

### Tool Metrics
- `tool_calls_total`: Total tool executions (counter)
- `tool_execution_time`: Tool execution duration (histogram)
- `tool_errors_total`: Tool execution failures (counter)

### System Metrics
- `memory_usage_bytes`: Memory consumption (gauge)
- `do_operations_total`: Durable Object operations (counter)
- `do_operation_latency`: DO operation time (histogram)
- `errors_total`: Total system errors (counter)

### Security Metrics
- `rate_limit_hits_total`: Rate limit encounters (counter)
- `rate_limit_violations_total`: Rate limit violations (counter)
- `security_checks_total`: Security check executions (counter)
- `security_errors_total`: Security check failures (counter)

## Configuration

### Environment Variables
- `MAX_TOKENS`: Maximum tokens per AI request (default: 4096)
- `OPENAI_API_KEY`: OpenAI API key for fallback model

### KV Storage
- Error logs: `log:error:{timestamp}:{requestId}` (7 days TTL)
- Metrics: `metrics:{minute}` (30 days TTL)
- Alerts: `alert:{alertId}` (7 days TTL)

### R2 Storage
- Conversation archives for long-term analysis
- Metric exports for historical reporting

## Best Practices

1. **Use Request IDs**: Always pass request IDs for tracing
2. **Add Context**: Include relevant metadata in logs
3. **Monitor Performance**: Use histograms for timing data
4. **Set Appropriate Thresholds**: Configure alerts based on your SLA
5. **Regular Health Checks**: Monitor component health continuously
6. **Clean Up Resources**: Implement proper TTL for stored data

## Troubleshooting

### High Memory Usage
- Check `memory_usage_bytes` gauge
- Look for memory leak alerts
- Review component-specific usage

### Performance Issues
- Monitor `request_latency` histogram
- Check AI call performance metrics
- Review tool execution times

### Error Rates
- Check `errors_total` counter
- Review error logs in KV storage
- Monitor component health status

### Rate Limiting
- Monitor `rate_limit_hits_total`
- Check session-specific limits
- Review security violation logs

## Integration with External Systems

The monitoring system is designed to integrate with:

- **Prometheus**: Via `/api/metrics` endpoint
- **Grafana**: For visualization and dashboards
- **PagerDuty**: For alert notifications
- **Datadog**: For comprehensive monitoring
- **CloudWatch**: For AWS integration

## Performance Impact

The monitoring system is designed for minimal performance impact:

- Asynchronous logging operations
- Efficient metric aggregation
- Configurable sampling rates
- Automatic cleanup of old data
- Optimized storage patterns

## Security Considerations

- PII detection and filtering in logs
- Secure storage of sensitive metrics
- Access control for monitoring endpoints
- Rate limiting for monitoring APIs
- Audit trails for configuration changes