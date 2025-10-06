// Demonstration of the comprehensive logging and monitoring system
import { createMonitoringSystem, PerformanceMonitor } from './logging';
import { MonitoringMiddleware, RateLimitMonitor, MemoryMonitor } from './monitoring_middleware';
import { WorkerBindings } from './types';

// Mock bindings for demonstration
const createDemoBindings = (): WorkerBindings => ({
  AI: {
    run: async () => ({
      response: 'Hello! This is a demo response from the AI model.',
      usage: { prompt_tokens: 25, completion_tokens: 45, total_tokens: 70 }
    })
  } as any,
  MEMORY_DO: {
    idFromName: () => 'demo-session-id',
    get: () => ({
      fetch: async () => new Response(JSON.stringify({ success: true }))
    })
  } as any,
  CHAT_KV: {
    put: async () => undefined,
    get: async () => 'demo-value',
    delete: async () => undefined,
    list: async () => ({ keys: [] })
  } as any,
  ARCHIVE_R2: {
    list: async () => ({ objects: [] })
  } as any,
  WORKFLOWS: undefined,
  OPENAI_API_KEY: 'demo-key',
  MAX_TOKENS: '1000'
});

export async function demonstrateMonitoring(): Promise<void> {
  console.log('🚀 Starting Cloudflare AI Support Bot Monitoring System Demo\n');

  const bindings = createDemoBindings();
  const requestId = crypto.randomUUID();
  
  // Create monitoring system
  const { logger, metrics, alerts, health } = createMonitoringSystem(
    bindings, 
    requestId, 
    'demo'
  );

  console.log('📊 1. Basic Logging Demonstration');
  console.log('================================');
  
  await logger.info('Demo started', { 
    feature: 'monitoring_system',
    version: '1.0.0' 
  });
  
  await logger.debug('Debug information', { 
    debugLevel: 'verbose',
    component: 'demo' 
  });
  
  await logger.warn('Warning example', { 
    warningType: 'performance',
    threshold: '5s' 
  });

  try {
    throw new Error('Demo error for logging');
  } catch (error) {
    await logger.error('Error demonstration', error as Error, {
      context: 'demo_error_handling'
    });
  }

  console.log('\n📈 2. Metrics Collection Demonstration');
  console.log('====================================');

  // Demonstrate counter metrics
  metrics.incrementCounter('demo_requests_total', 1, { method: 'POST' });
  metrics.incrementCounter('demo_requests_total', 1, { method: 'GET' });
  metrics.incrementCounter('demo_requests_total', 3, { method: 'POST' });

  // Demonstrate gauge metrics
  metrics.setGauge('demo_active_sessions', 42);
  metrics.setGauge('demo_memory_usage_mb', 128);

  // Demonstrate histogram metrics
  metrics.recordHistogram('demo_response_time_ms', 150);
  metrics.recordHistogram('demo_response_time_ms', 75);
  metrics.recordHistogram('demo_response_time_ms', 300);
  metrics.recordHistogram('demo_response_time_ms', 45);

  console.log('Metrics recorded successfully ✅');

  console.log('\n⏱️  3. Performance Monitoring Demonstration');
  console.log('==========================================');

  // Demonstrate performance monitoring
  const { result: aiResult, duration: aiDuration } = await PerformanceMonitor.measureAsync(
    'demo_ai_call',
    async () => {
      // Simulate AI processing time
      await new Promise(resolve => setTimeout(resolve, 100));
      return await bindings.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: 'Hello demo!' }]
      });
    },
    metrics
  );

  console.log(`AI call completed in ${aiDuration}ms ✅`);

  console.log('\n🛡️  4. Security and Rate Limiting Monitoring');
  console.log('============================================');

  const rateLimitMonitor = new RateLimitMonitor(metrics, logger);
  
  // Simulate rate limiting events
  rateLimitMonitor.recordRateLimitHit('demo-session-1', 'requests', 8);
  rateLimitMonitor.recordRateLimitHit('demo-session-2', 'tokens', 450);
  rateLimitMonitor.recordRateLimitViolation('demo-session-3', 'requests');

  console.log('Rate limiting events recorded ✅');

  console.log('\n💾 5. Memory Usage Monitoring');
  console.log('=============================');

  const memoryMonitor = new MemoryMonitor(metrics, logger);
  
  // Simulate memory usage tracking
  memoryMonitor.recordMemoryUsage('api_worker', 25 * 1024 * 1024); // 25MB
  memoryMonitor.recordMemoryUsage('durable_objects', 15 * 1024 * 1024); // 15MB
  
  // Simulate memory leak detection
  memoryMonitor.recordMemoryLeak('session_cache', 10 * 1024 * 1024, 45 * 1024 * 1024);

  console.log('Memory monitoring events recorded ✅');

  console.log('\n🚨 6. Alert System Demonstration');
  console.log('================================');

  // Trigger some alerts by creating high metric values
  metrics.incrementCounter('errors_total', 15); // Should trigger high error rate alert
  metrics.recordHistogram('request_latency', 8000); // Should trigger high latency alert

  const triggeredAlerts = await alerts.evaluateRules();
  console.log(`Evaluated alert rules, ${triggeredAlerts.length} alerts triggered`);

  const activeAlerts = alerts.getActiveAlerts();
  console.log(`Active alerts: ${activeAlerts.length}`);

  console.log('\n🏥 7. Health Check Demonstration');
  console.log('================================');

  const healthStatus = await health.checkHealth();
  console.log(`Overall system health: ${healthStatus.overall}`);
  console.log(`Components checked: ${healthStatus.components.length}`);
  
  healthStatus.components.forEach(component => {
    const statusIcon = component.status === 'healthy' ? '✅' : 
                      component.status === 'degraded' ? '⚠️' : '❌';
    console.log(`  ${statusIcon} ${component.component}: ${component.status} (${component.latency}ms)`);
  });

  console.log('\n📊 8. Metrics Export Demonstration');
  console.log('==================================');

  const exportedMetrics = await metrics.exportMetrics();
  const metricsLines = exportedMetrics.split('\n').filter(line => line.trim());
  console.log(`Exported ${metricsLines.length} metric lines in Prometheus format`);
  console.log('Sample metrics:');
  metricsLines.slice(0, 5).forEach(line => console.log(`  ${line}`));
  if (metricsLines.length > 5) {
    console.log(`  ... and ${metricsLines.length - 5} more`);
  }

  console.log('\n🔄 9. Middleware Integration Demonstration');
  console.log('=========================================');

  const middleware = new MonitoringMiddleware(bindings);
  
  // Simulate a request through the monitoring middleware
  const mockRequest = new Request('https://demo.example.com/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello from demo!' })
  });

  try {
    await middleware.wrapRequest(mockRequest, async (req, context) => {
      const { logger: reqLogger, metrics: reqMetrics } = context;
      
      await reqLogger.info('Processing demo request');
      
      // Simulate AI call monitoring
      await middleware.monitorAICall(
        'demo-model',
        50,
        reqLogger,
        reqMetrics,
        async () => 'Demo AI response'
      );
      
      // Simulate tool execution monitoring
      await middleware.monitorToolExecution(
        'demo-tool',
        { query: 'demo' },
        reqLogger,
        reqMetrics,
        async () => ({ success: true, data: 'demo result' })
      );
      
      return new Response(JSON.stringify({ success: true }));
    });
    
    console.log('Request processed through monitoring middleware ✅');
  } catch (error) {
    console.log('Request processing failed (expected for demo) ❌');
  }

  console.log('\n📈 10. Final Metrics Summary');
  console.log('============================');

  const finalMetrics = metrics.getMetrics();
  console.log('System Metrics Summary:');
  console.log(`  Request Latency: ${finalMetrics.requestLatency.count} samples, avg ${
    finalMetrics.requestLatency.count > 0 ? 
    Math.round(finalMetrics.requestLatency.sum / finalMetrics.requestLatency.count) : 0
  }ms`);
  console.log(`  Error Rate: ${finalMetrics.errorRate.value} errors`);
  console.log(`  Active Connections: ${finalMetrics.activeConnections.value}`);
  console.log(`  AI Token Usage: ${finalMetrics.aiTokenUsage.value} tokens`);
  console.log(`  Tool Execution Time: ${finalMetrics.toolExecutionTime.count} executions`);
  console.log(`  Memory Usage: ${Math.round(finalMetrics.memoryUsage.value / 1024 / 1024)}MB`);
  console.log(`  Rate Limit Hits: ${finalMetrics.rateLimitHits.value}`);

  await logger.info('Demo completed successfully', {
    totalDuration: Date.now() - parseInt(requestId.split('-')[0], 16),
    metricsRecorded: true,
    alertsEvaluated: true,
    healthChecked: true
  });

  console.log('\n🎉 Monitoring System Demo Complete!');
  console.log('===================================');
  console.log('The comprehensive logging and monitoring system includes:');
  console.log('✅ Structured logging with request IDs and latency tracking');
  console.log('✅ Metrics collection (counters, gauges, histograms)');
  console.log('✅ Performance monitoring and timing');
  console.log('✅ Alert system with configurable rules');
  console.log('✅ Health monitoring for all components');
  console.log('✅ Rate limiting and security monitoring');
  console.log('✅ Memory usage tracking and leak detection');
  console.log('✅ Prometheus-compatible metrics export');
  console.log('✅ Middleware integration for automatic monitoring');
  console.log('✅ Error tracking and failure rate monitoring');
}

// Export for use in other modules
export { createMonitoringSystem, MonitoringMiddleware, RateLimitMonitor, MemoryMonitor };