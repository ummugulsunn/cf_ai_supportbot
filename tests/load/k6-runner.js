// K6 Load Testing Script for CF AI Support Bot
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');
const wsConnectionTime = new Trend('ws_connection_time');
const messageProcessingTime = new Trend('message_processing_time');
const aiResponseTime = new Trend('ai_response_time');
const concurrentConnections = new Counter('concurrent_connections');

// Test configuration
export const options = {
  scenarios: {
    // Ramp-up test: Gradually increase load
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '2m', target: 10 },   // Ramp up to 10 users over 2 minutes
        { duration: '5m', target: 10 },   // Stay at 10 users for 5 minutes
        { duration: '2m', target: 20 },   // Ramp up to 20 users
        { duration: '5m', target: 20 },   // Stay at 20 users for 5 minutes
        { duration: '2m', target: 0 },    // Ramp down to 0 users
      ],
    },
    
    // Spike test: Sudden load increase
    spike_test: {
      executor: 'ramping-vus',
      startTime: '16m',
      startVUs: 5,
      stages: [
        { duration: '30s', target: 5 },   // Normal load
        { duration: '1m', target: 50 },   // Spike to 50 users
        { duration: '30s', target: 5 },   // Back to normal
      ],
    },
    
    // Stress test: High sustained load
    stress_test: {
      executor: 'constant-vus',
      startTime: '20m',
      vus: 30,
      duration: '10m',
    },
  },
  
  thresholds: {
    // Performance thresholds
    'http_req_duration': ['p(95)<2000'], // 95% of requests should be below 2s
    'ws_connection_time': ['p(95)<1000'], // WebSocket connections should be fast
    'message_processing_time': ['p(95)<3000'], // Message processing under 3s
    'ai_response_time': ['p(95)<5000'], // AI responses under 5s
    'errors': ['rate<0.05'], // Error rate should be below 5%
  },
};

// Test data
const testMessages = [
  "Hello, I need help with my account",
  "I'm having trouble logging in",
  "Can you help me reset my password?",
  "I have a billing question",
  "My service is not working properly",
  "How do I update my profile information?",
  "I need to cancel my subscription",
  "Can you explain the pricing plans?",
  "I'm experiencing technical difficulties",
  "How do I contact human support?"
];

const testScenarios = [
  {
    name: 'quick_question',
    messages: ['Hello, what are your business hours?'],
    expectedResponseTime: 2000
  },
  {
    name: 'complex_issue',
    messages: [
      'I am having trouble with my account',
      'I cannot access my dashboard',
      'The error message says "Authentication failed"',
      'I have tried resetting my password but it did not work'
    ],
    expectedResponseTime: 5000
  },
  {
    name: 'knowledge_base_search',
    messages: [
      'How do I configure SSL certificates?',
      'Can you search your knowledge base for SSL setup instructions?'
    ],
    expectedResponseTime: 3000
  }
];

// Base URL - should be set via environment variable
const BASE_URL = __ENV.BASE_URL || 'https://your-worker.your-subdomain.workers.dev';
const WS_URL = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws';

export default function() {
  const scenario = testScenarios[Math.floor(Math.random() * testScenarios.length)];
  
  // Choose test type based on probability
  const testType = Math.random();
  
  if (testType < 0.6) {
    // 60% HTTP API tests
    runHTTPTest(scenario);
  } else if (testType < 0.9) {
    // 30% WebSocket tests
    runWebSocketTest(scenario);
  } else {
    // 10% Mixed tests (HTTP + WebSocket)
    runMixedTest(scenario);
  }
  
  // Random sleep between 1-5 seconds to simulate user behavior
  sleep(Math.random() * 4 + 1);
}

function runHTTPTest(scenario) {
  const sessionId = generateSessionId();
  
  // Test session creation
  const sessionStart = Date.now();
  const sessionResponse = http.get(`${BASE_URL}/api/session/${sessionId}`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  check(sessionResponse, {
    'session creation status is 200 or 404': (r) => r.status === 200 || r.status === 404,
  }) || errorRate.add(1);
  
  // Test chat messages
  for (const message of scenario.messages) {
    const messageStart = Date.now();
    
    const chatResponse = http.post(`${BASE_URL}/api/chat`, JSON.stringify({
      message: message,
      sessionId: sessionId,
    }), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const messageTime = Date.now() - messageStart;
    messageProcessingTime.add(messageTime);
    
    const success = check(chatResponse, {
      'chat response status is 200': (r) => r.status === 200,
      'response has message': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.message && body.message.content;
        } catch {
          return false;
        }
      },
      'response time acceptable': () => messageTime < scenario.expectedResponseTime,
    });
    
    if (!success) {
      errorRate.add(1);
    }
    
    // Track AI response time if available
    try {
      const responseBody = JSON.parse(chatResponse.body);
      if (responseBody.usage && responseBody.usage.total_tokens) {
        aiResponseTime.add(messageTime);
      }
    } catch (e) {
      // Ignore parsing errors
    }
    
    // Small delay between messages
    sleep(0.5);
  }
  
  responseTime.add(Date.now() - sessionStart);
}

function runWebSocketTest(scenario) {
  const sessionId = generateSessionId();
  const wsUrl = `${WS_URL}?sessionId=${sessionId}`;
  
  const connectionStart = Date.now();
  
  const response = ws.connect(wsUrl, {}, function(socket) {
    concurrentConnections.add(1);
    
    const connectionTime = Date.now() - connectionStart;
    wsConnectionTime.add(connectionTime);
    
    socket.on('open', function() {
      console.log(`WebSocket connected for session ${sessionId}`);
      
      // Send initialization message
      socket.send(JSON.stringify({
        type: 'init',
        sessionId: sessionId,
        timestamp: Date.now()
      }));
    });
    
    socket.on('message', function(message) {
      try {
        const data = JSON.parse(message);
        console.log(`Received message type: ${data.type}`);
        
        if (data.type === 'message') {
          const processingTime = Date.now() - data.timestamp;
          messageProcessingTime.add(processingTime);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
        errorRate.add(1);
      }
    });
    
    socket.on('error', function(error) {
      console.error('WebSocket error:', error);
      errorRate.add(1);
    });
    
    // Send test messages
    let messageIndex = 0;
    const sendNextMessage = () => {
      if (messageIndex < scenario.messages.length) {
        const message = {
          type: 'message',
          sessionId: sessionId,
          content: scenario.messages[messageIndex],
          timestamp: Date.now()
        };
        
        socket.send(JSON.stringify(message));
        messageIndex++;
        
        // Schedule next message
        setTimeout(sendNextMessage, 2000);
      } else {
        // Close connection after all messages sent
        setTimeout(() => socket.close(), 1000);
      }
    };
    
    // Start sending messages after connection is established
    setTimeout(sendNextMessage, 500);
  });
  
  check(response, {
    'WebSocket connection successful': (r) => r && r.status === 101,
  }) || errorRate.add(1);
}

function runMixedTest(scenario) {
  // Start with HTTP session creation
  const sessionId = generateSessionId();
  
  const sessionResponse = http.get(`${BASE_URL}/api/session/${sessionId}`);
  check(sessionResponse, {
    'mixed test session creation': (r) => r.status === 200 || r.status === 404,
  }) || errorRate.add(1);
  
  // Send first message via HTTP
  if (scenario.messages.length > 0) {
    const httpMessage = http.post(`${BASE_URL}/api/chat`, JSON.stringify({
      message: scenario.messages[0],
      sessionId: sessionId,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
    
    check(httpMessage, {
      'mixed test HTTP message': (r) => r.status === 200,
    }) || errorRate.add(1);
  }
  
  // Continue with WebSocket for remaining messages
  if (scenario.messages.length > 1) {
    const wsUrl = `${WS_URL}?sessionId=${sessionId}`;
    
    ws.connect(wsUrl, {}, function(socket) {
      socket.on('open', function() {
        // Send remaining messages via WebSocket
        scenario.messages.slice(1).forEach((message, index) => {
          setTimeout(() => {
            socket.send(JSON.stringify({
              type: 'message',
              sessionId: sessionId,
              content: message,
              timestamp: Date.now()
            }));
          }, (index + 1) * 1000);
        });
        
        // Close after sending all messages
        setTimeout(() => socket.close(), scenario.messages.length * 1000 + 2000);
      });
    });
  }
}

// Performance monitoring test
export function performanceMonitoring() {
  const metricsResponse = http.get(`${BASE_URL}/api/metrics`);
  
  check(metricsResponse, {
    'metrics endpoint accessible': (r) => r.status === 200,
    'metrics data present': (r) => r.body && r.body.length > 0,
  });
  
  const healthResponse = http.get(`${BASE_URL}/api/health`);
  
  check(healthResponse, {
    'health check passes': (r) => r.status === 200,
    'health data valid': (r) => {
      try {
        const health = JSON.parse(r.body);
        return health.status === 'healthy' || health.status === 'degraded';
      } catch {
        return false;
      }
    },
  });
}

// Stress test specific scenarios
export function stressTest() {
  // High-frequency message sending
  const sessionId = generateSessionId();
  const messages = Array.from({ length: 10 }, (_, i) => `Stress test message ${i + 1}`);
  
  const promises = messages.map((message, index) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const response = http.post(`${BASE_URL}/api/chat`, JSON.stringify({
          message: message,
          sessionId: sessionId,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
        
        resolve(response);
      }, index * 100); // Send messages every 100ms
    });
  });
  
  // Wait for all messages to complete
  Promise.all(promises).then(responses => {
    const successCount = responses.filter(r => r.status === 200).length;
    console.log(`Stress test completed: ${successCount}/${messages.length} successful`);
  });
}

// Utility functions
function generateSessionId() {
  return `load-test-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// Setup and teardown
export function setup() {
  console.log('Starting load test...');
  
  // Verify the service is accessible
  const healthCheck = http.get(`${BASE_URL}/api/health`);
  if (healthCheck.status !== 200) {
    throw new Error(`Service not accessible: ${healthCheck.status}`);
  }
  
  console.log('Service health check passed');
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = Date.now() - data.startTime;
  console.log(`Load test completed in ${duration}ms`);
  
  // Final health check
  const finalHealth = http.get(`${BASE_URL}/api/health`);
  console.log(`Final health status: ${finalHealth.status}`);
}

// Export additional test functions
export { performanceMonitoring, stressTest };