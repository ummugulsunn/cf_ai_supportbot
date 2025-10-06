# API Documentation

## Overview

The Cloudflare AI Support Bot provides both REST API and WebSocket endpoints for real-time chat functionality. The API is built on Cloudflare Workers and provides low-latency responses from the edge.

## Base URLs

- **Production**: `https://cf-ai-supportbot.your-subdomain.workers.dev`
- **Staging**: `https://cf-ai-supportbot-staging.your-subdomain.workers.dev`
- **Development**: `http://localhost:8787`

## Authentication

The API currently uses session-based authentication. Future versions may include API key authentication for programmatic access.

### Session Management

1. Create a session: `POST /api/session`
2. Use the returned `sessionId` in subsequent requests
3. Sessions expire after 24 hours of inactivity

## REST API Endpoints

### Health and Status

#### GET /health

Returns the overall health status of the system.

**Response:**
```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "timestamp": 1640995200000,
  "components": {
    "ai_service": "healthy" | "degraded" | "unhealthy",
    "memory_service": "healthy" | "degraded" | "unhealthy",
    "tool_service": "healthy" | "degraded" | "unhealthy",
    "workflow_service": "healthy" | "degraded" | "unhealthy"
  },
  "uptime": 86400000,
  "version": "1.0.0"
}
```

**Status Codes:**
- `200 OK`: System is operational
- `503 Service Unavailable`: System is experiencing issues

#### GET /api/status

Returns detailed system status and performance metrics.

**Response:**
```json
{
  "status": "operational" | "degraded" | "maintenance",
  "timestamp": 1640995200000,
  "metrics": {
    "active_sessions": 42,
    "requests_per_minute": 150,
    "average_latency_ms": 250,
    "error_rate_percent": 0.5,
    "ai_token_usage": 12500,
    "memory_usage_mb": 128
  },
  "limits": {
    "max_sessions": 1000,
    "rate_limit_per_minute": 30,
    "max_tokens_per_hour": 10000
  }
}
```

### Session Management

#### POST /api/session

Creates a new chat session.

**Request Body:**
```json
{
  "userId": "user_123456789", // optional
  "metadata": {
    "userAgent": "Mozilla/5.0...",
    "language": "en-US",
    "timezone": "America/New_York"
  }
}
```

**Response:**
```json
{
  "sessionId": "sess_123456789abcdef",
  "createdAt": 1640995200000,
  "expiresAt": 1641081600000,
  "status": "active",
  "configuration": {
    "voiceEnabled": true,
    "toolsEnabled": true,
    "maxTokens": 4096
  }
}
```

**Status Codes:**
- `201 Created`: Session created successfully
- `400 Bad Request`: Invalid request data
- `429 Too Many Requests`: Rate limit exceeded

#### GET /api/session/{sessionId}

Retrieves session information and conversation history.

**Query Parameters:**
- `limit`: Number of recent messages to return (default: 20, max: 100)
- `offset`: Offset for pagination (default: 0)
- `include_summary`: Include conversation summary (default: true)

**Response:**
```json
{
  "sessionId": "sess_123456789abcdef",
  "status": "active" | "idle" | "ended",
  "createdAt": 1640995200000,
  "lastActivity": 1640995800000,
  "messageCount": 15,
  "summary": "User asking about billing issues and account access...",
  "recentMessages": [
    {
      "id": "msg_987654321",
      "content": "Hello, I need help with my billing",
      "role": "user",
      "timestamp": 1640995200000,
      "metadata": {
        "voiceInput": false
      }
    },
    {
      "id": "msg_987654322",
      "content": "I'd be happy to help with your billing questions...",
      "role": "assistant",
      "timestamp": 1640995205000,
      "metadata": {
        "toolCalls": [
          {
            "tool": "kb.search",
            "parameters": { "query": "billing help" },
            "result": { "articles": [...] }
          }
        ],
        "processingTime": 1250
      }
    }
  ],
  "activeTopics": ["billing", "account_access"],
  "resolvedIssues": ["password_reset"]
}
```

**Status Codes:**
- `200 OK`: Session found
- `404 Not Found`: Session not found or expired
- `403 Forbidden`: Access denied

#### DELETE /api/session/{sessionId}

Ends a chat session and cleans up resources.

**Response:**
```json
{
  "sessionId": "sess_123456789abcdef",
  "status": "ended",
  "endedAt": 1640995800000,
  "summary": "Session ended by user request",
  "messageCount": 15,
  "duration": 600000
}
```

**Status Codes:**
- `200 OK`: Session ended successfully
- `404 Not Found`: Session not found
- `409 Conflict`: Session already ended

### Chat API

#### POST /api/chat

Sends a chat message and receives an AI response.

**Request Body:**
```json
{
  "message": "Hello, I need help with my billing account",
  "sessionId": "sess_123456789abcdef",
  "metadata": {
    "voiceInput": false,
    "language": "en-US",
    "context": {
      "currentPage": "/billing",
      "userAgent": "Mozilla/5.0..."
    }
  }
}
```

**Response:**
```json
{
  "response": "I'd be happy to help with your billing questions. What specific issue are you experiencing?",
  "messageId": "msg_987654321",
  "sessionId": "sess_123456789abcdef",
  "timestamp": 1640995200000,
  "processingTime": 1250,
  "toolCalls": [
    {
      "id": "tool_call_1",
      "tool": "kb.search",
      "parameters": {
        "query": "billing help",
        "maxResults": 3
      },
      "result": {
        "success": true,
        "articles": [
          {
            "id": "kb_001",
            "title": "Understanding Your Bill",
            "content": "Your monthly bill includes...",
            "url": "https://help.example.com/billing",
            "relevance": 0.95
          }
        ]
      },
      "executionTime": 450
    }
  ],
  "metadata": {
    "aiModel": "llama-3.3-70b",
    "tokensUsed": 156,
    "confidence": 0.92,
    "fallbackUsed": false
  }
}
```

**Status Codes:**
- `200 OK`: Message processed successfully
- `400 Bad Request`: Invalid message format
- `404 Not Found`: Session not found
- `429 Too Many Requests`: Rate limit exceeded
- `503 Service Unavailable`: AI service temporarily unavailable

### Tool Integration

#### POST /api/tools/search

Searches the knowledge base for relevant articles.

**Request Body:**
```json
{
  "query": "how to reset password",
  "maxResults": 5,
  "filters": {
    "category": "account",
    "language": "en",
    "tags": ["password", "security"]
  },
  "sessionId": "sess_123456789abcdef"
}
```

**Response:**
```json
{
  "results": [
    {
      "id": "kb_001",
      "title": "How to Reset Your Password",
      "content": "To reset your password, follow these steps...",
      "url": "https://help.example.com/reset-password",
      "category": "account",
      "tags": ["password", "security", "reset"],
      "relevance": 0.95,
      "lastUpdated": 1640995200000
    }
  ],
  "totalResults": 12,
  "searchTime": 150,
  "query": "how to reset password",
  "sessionId": "sess_123456789abcdef"
}
```

#### POST /api/tools/ticket

Creates or manages support tickets.

**Create Ticket:**
```json
{
  "action": "create",
  "ticketData": {
    "title": "Cannot access my account",
    "description": "I'm unable to log in after password reset. Error message: 'Invalid credentials'",
    "priority": "medium",
    "category": "account",
    "userEmail": "user@example.com",
    "metadata": {
      "browser": "Chrome 96.0",
      "lastLogin": 1640995200000,
      "errorCode": "AUTH_001"
    }
  },
  "sessionId": "sess_123456789abcdef"
}
```

**Response:**
```json
{
  "ticketId": "TKT-123456",
  "status": {
    "id": "TKT-123456",
    "title": "Cannot access my account",
    "status": "open",
    "priority": "medium",
    "category": "account",
    "assignee": "support_agent_1",
    "createdAt": 1640995200000,
    "updatedAt": 1640995200000,
    "estimatedResolution": 1641081600000
  },
  "message": "Ticket created successfully. You should receive an email confirmation shortly.",
  "sessionId": "sess_123456789abcdef"
}
```

**Check Ticket Status:**
```json
{
  "action": "status",
  "ticketId": "TKT-123456",
  "sessionId": "sess_123456789abcdef"
}
```

**Response:**
```json
{
  "ticketId": "TKT-123456",
  "status": {
    "id": "TKT-123456",
    "title": "Cannot access my account",
    "status": "in_progress",
    "priority": "medium",
    "category": "account",
    "assignee": "support_agent_1",
    "createdAt": 1640995200000,
    "updatedAt": 1640998800000,
    "estimatedResolution": 1641081600000,
    "updates": [
      {
        "timestamp": 1640998800000,
        "author": "support_agent_1",
        "message": "Investigating the authentication issue. Please check your email for a temporary access link.",
        "type": "agent_update"
      }
    ]
  },
  "sessionId": "sess_123456789abcdef"
}
```

### Workflow Management

#### POST /api/workflow/execute

Executes a complex workflow operation.

**Request Body:**
```json
{
  "workflowType": "complex_query" | "escalation" | "tool_chain",
  "parameters": {
    "query": "I need help with billing and also want to update my account information",
    "context": {
      "sessionId": "sess_123456789abcdef",
      "userPreferences": {
        "language": "en-US",
        "communicationMethod": "email"
      }
    }
  }
}
```

**Response:**
```json
{
  "executionId": "wf_exec_123456789",
  "workflowType": "complex_query",
  "status": "running" | "completed" | "failed",
  "steps": [
    {
      "id": "step_1",
      "name": "analyze_query",
      "status": "completed",
      "result": {
        "intents": ["billing_inquiry", "account_update"],
        "entities": ["billing", "account_information"]
      },
      "executionTime": 150
    },
    {
      "id": "step_2",
      "name": "execute_tools",
      "status": "running",
      "progress": 0.6
    }
  ],
  "result": {
    "response": "I can help you with both billing questions and account updates...",
    "toolResults": [...],
    "nextSteps": ["schedule_callback", "send_email_summary"]
  },
  "metadata": {
    "startTime": 1640995200000,
    "estimatedCompletion": 1640995230000,
    "retryCount": 0
  }
}
```

#### GET /api/workflow/{executionId}

Gets the status of a workflow execution.

**Response:**
```json
{
  "executionId": "wf_exec_123456789",
  "workflowType": "complex_query",
  "status": "completed",
  "progress": 1.0,
  "steps": [...],
  "result": {
    "success": true,
    "response": "Complete response from workflow execution",
    "data": {...}
  },
  "metadata": {
    "startTime": 1640995200000,
    "endTime": 1640995225000,
    "duration": 25000,
    "retryCount": 0,
    "stepsCompleted": 5,
    "stepsTotal": 5
  }
}
```

## WebSocket API

### Connection

**Endpoint:** `/ws`
**Protocol:** WebSocket over HTTP/HTTPS
**URL Format:** `wss://your-worker.your-subdomain.workers.dev/ws?sessionId=sess_123456789`

### Connection Flow

1. **Establish Connection:**
   ```javascript
   const ws = new WebSocket('wss://your-worker.your-subdomain.workers.dev/ws?sessionId=sess_123456789');
   ```

2. **Connection Confirmation:**
   ```json
   {
     "type": "connection_established",
     "data": {
       "sessionId": "sess_123456789",
       "serverTime": 1640995200000,
       "capabilities": ["chat", "voice", "tools", "workflows"]
     },
     "timestamp": 1640995200000
   }
   ```

### Message Types

#### Client to Server

**Chat Message:**
```json
{
  "type": "chat_message",
  "data": {
    "content": "Hello, I need help with my account",
    "sessionId": "sess_123456789",
    "metadata": {
      "voiceInput": false,
      "language": "en-US"
    }
  },
  "requestId": "req_123456789",
  "timestamp": 1640995200000
}
```

**Voice Input:**
```json
{
  "type": "voice_input",
  "data": {
    "audioData": "base64_encoded_audio_data",
    "format": "webm",
    "duration": 3500,
    "sessionId": "sess_123456789"
  },
  "requestId": "req_123456790",
  "timestamp": 1640995200000
}
```

**Typing Indicator:**
```json
{
  "type": "typing",
  "data": {
    "isTyping": true,
    "sessionId": "sess_123456789"
  },
  "timestamp": 1640995200000
}
```

**Heartbeat:**
```json
{
  "type": "ping",
  "timestamp": 1640995200000
}
```

#### Server to Client

**AI Response:**
```json
{
  "type": "ai_response",
  "data": {
    "content": "I can help you with your account. What specific issue are you experiencing?",
    "messageId": "msg_987654321",
    "sessionId": "sess_123456789",
    "toolCalls": [
      {
        "tool": "kb.search",
        "parameters": { "query": "account help" },
        "result": { "articles": [...] }
      }
    ],
    "metadata": {
      "processingTime": 1250,
      "aiModel": "llama-3.3-70b",
      "confidence": 0.92
    }
  },
  "requestId": "req_123456789",
  "timestamp": 1640995205000
}
```

**Typing Indicator:**
```json
{
  "type": "ai_typing",
  "data": {
    "isTyping": true,
    "sessionId": "sess_123456789",
    "estimatedDuration": 2000
  },
  "timestamp": 1640995200000
}
```

**Voice Output:**
```json
{
  "type": "voice_output",
  "data": {
    "audioData": "base64_encoded_audio_data",
    "format": "mp3",
    "duration": 4500,
    "text": "I can help you with your account...",
    "sessionId": "sess_123456789"
  },
  "timestamp": 1640995205000
}
```

**Error Message:**
```json
{
  "type": "error",
  "data": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please wait before sending another message.",
    "details": {
      "retryAfter": 60,
      "currentLimit": 30,
      "resetTime": 1640995260000
    }
  },
  "requestId": "req_123456789",
  "timestamp": 1640995200000
}
```

**System Notification:**
```json
{
  "type": "system_notification",
  "data": {
    "level": "info" | "warning" | "error",
    "message": "Your session will expire in 5 minutes due to inactivity",
    "actionRequired": false,
    "expiresAt": 1640995500000
  },
  "timestamp": 1640995200000
}
```

**Heartbeat Response:**
```json
{
  "type": "pong",
  "timestamp": 1640995200000
}
```

## Error Handling

### HTTP Status Codes

- **200 OK**: Request successful
- **201 Created**: Resource created
- **204 No Content**: Request successful, no content to return
- **400 Bad Request**: Invalid request format or parameters
- **401 Unauthorized**: Authentication required
- **403 Forbidden**: Access denied
- **404 Not Found**: Resource not found
- **409 Conflict**: Resource conflict (e.g., session already exists)
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Unexpected server error
- **502 Bad Gateway**: Upstream service error
- **503 Service Unavailable**: Service temporarily unavailable
- **504 Gateway Timeout**: Upstream service timeout

### Error Response Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional error context",
      "suggestion": "Recommended action"
    },
    "retryable": true,
    "retryAfter": 60,
    "documentation": "https://docs.example.com/errors/ERROR_CODE"
  },
  "requestId": "req_123456789",
  "timestamp": 1640995200000,
  "path": "/api/chat",
  "method": "POST"
}
```

### Common Error Codes

#### Authentication and Authorization
- `INVALID_SESSION`: Session ID is invalid or expired
- `SESSION_NOT_FOUND`: Session does not exist
- `ACCESS_DENIED`: Insufficient permissions
- `TOKEN_EXPIRED`: Authentication token has expired

#### Rate Limiting
- `RATE_LIMIT_EXCEEDED`: Too many requests from client
- `TOKEN_LIMIT_EXCEEDED`: AI token usage limit reached
- `CONCURRENT_LIMIT_EXCEEDED`: Too many concurrent sessions

#### Validation Errors
- `INVALID_REQUEST_FORMAT`: Request body format is invalid
- `MISSING_REQUIRED_FIELD`: Required field is missing
- `INVALID_FIELD_VALUE`: Field value is invalid or out of range
- `MESSAGE_TOO_LONG`: Message exceeds maximum length

#### Service Errors
- `AI_SERVICE_UNAVAILABLE`: AI model temporarily unavailable
- `TOOL_EXECUTION_FAILED`: Tool call failed to execute
- `WORKFLOW_EXECUTION_FAILED`: Workflow execution failed
- `STORAGE_ERROR`: Data storage operation failed

#### System Errors
- `INTERNAL_ERROR`: Unexpected server error
- `SERVICE_DEGRADED`: Service is experiencing issues
- `MAINTENANCE_MODE`: System is under maintenance
- `RESOURCE_EXHAUSTED`: System resources are exhausted

## Rate Limiting

### Limits

The API implements multiple rate limiting strategies:

#### Per Session Limits
- **Requests**: 30 per minute
- **Tokens**: 10,000 per hour
- **WebSocket Messages**: 60 per minute
- **Voice Input**: 20 per minute (max 30 seconds each)

#### Per IP Limits
- **Concurrent Sessions**: 5 active sessions
- **Session Creation**: 10 per hour
- **API Requests**: 100 per minute

#### Global Limits
- **Total Active Sessions**: 1,000 (configurable)
- **AI Model Calls**: 10,000 per minute (shared)
- **Tool Executions**: 1,000 per minute (shared)

### Rate Limit Headers

All API responses include rate limiting information:

```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 25
X-RateLimit-Reset: 1640995260
X-RateLimit-Type: session
X-RateLimit-Scope: requests_per_minute
```

### Rate Limit Exceeded Response

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded for session requests",
    "details": {
      "limit": 30,
      "remaining": 0,
      "resetTime": 1640995260,
      "retryAfter": 45
    },
    "retryable": true,
    "retryAfter": 45
  },
  "requestId": "req_123456789",
  "timestamp": 1640995200000
}
```

## SDK and Client Libraries

### JavaScript/TypeScript SDK

```typescript
import { AISupport BotClient } from '@cloudflare/ai-supportbot-sdk';

const client = new AISupportBotClient({
  baseUrl: 'https://cf-ai-supportbot.your-subdomain.workers.dev',
  apiKey: 'your-api-key', // Optional for session-based auth
});

// Create a session
const session = await client.createSession({
  userId: 'user_123',
  metadata: { language: 'en-US' }
});

// Send a message
const response = await client.sendMessage({
  sessionId: session.sessionId,
  message: 'Hello, I need help'
});

// Use WebSocket for real-time chat
const ws = client.createWebSocketConnection(session.sessionId);
ws.on('ai_response', (response) => {
  console.log('AI Response:', response.data.content);
});
```

### Python SDK

```python
from cloudflare_ai_supportbot import AISupportBotClient

client = AISupportBotClient(
    base_url='https://cf-ai-supportbot.your-subdomain.workers.dev',
    api_key='your-api-key'  # Optional
)

# Create session
session = client.create_session(
    user_id='user_123',
    metadata={'language': 'en-US'}
)

# Send message
response = client.send_message(
    session_id=session['sessionId'],
    message='Hello, I need help'
)

print(f"AI Response: {response['response']}")
```

## Webhooks

### Webhook Events

The system can send webhooks for various events:

#### Session Events
- `session.created`: New session created
- `session.ended`: Session ended
- `session.expired`: Session expired due to inactivity

#### Message Events
- `message.received`: New user message received
- `message.processed`: AI response generated
- `message.failed`: Message processing failed

#### Tool Events
- `tool.executed`: Tool successfully executed
- `tool.failed`: Tool execution failed

#### System Events
- `system.error`: System error occurred
- `system.maintenance`: Maintenance mode activated

### Webhook Configuration

Configure webhooks via the API:

```json
{
  "url": "https://your-app.com/webhooks/ai-supportbot",
  "events": ["message.processed", "tool.executed"],
  "secret": "your-webhook-secret",
  "headers": {
    "Authorization": "Bearer your-token"
  }
}
```

### Webhook Payload

```json
{
  "event": "message.processed",
  "timestamp": 1640995200000,
  "data": {
    "sessionId": "sess_123456789",
    "messageId": "msg_987654321",
    "userMessage": "Hello, I need help",
    "aiResponse": "I can help you with that...",
    "processingTime": 1250,
    "toolCalls": [...]
  },
  "signature": "sha256=...",
  "deliveryId": "delivery_123456789"
}
```

## Testing

### API Testing

Use the provided test endpoints for development:

#### Test Authentication
```bash
curl -X GET https://your-worker.your-subdomain.workers.dev/api/test/auth \
  -H "Authorization: Bearer test-token"
```

#### Test AI Integration
```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/api/test/ai \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, this is a test"}'
```

#### Test Tools
```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/api/test/tools \
  -H "Content-Type: application/json" \
  -d '{"tool": "kb.search", "parameters": {"query": "test"}}'
```

### Load Testing

Example k6 script for load testing:

```javascript
import ws from 'k6/ws';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 0 },
  ],
};

export default function () {
  const url = 'wss://your-worker.your-subdomain.workers.dev/ws?sessionId=test_session';
  
  const response = ws.connect(url, function (socket) {
    socket.on('open', function () {
      socket.send(JSON.stringify({
        type: 'chat_message',
        data: {
          content: 'Hello, this is a load test message',
          sessionId: 'test_session'
        }
      }));
    });
    
    socket.on('message', function (message) {
      const data = JSON.parse(message);
      check(data, {
        'received ai_response': (data) => data.type === 'ai_response',
      });
    });
  });
}
```

## Changelog

### Version 1.0.0 (Current)
- Initial release with full AI chat functionality
- WebSocket real-time communication
- Voice input/output support
- Tool integration (knowledge base, ticketing)
- Workflow orchestration
- Comprehensive monitoring and logging
- Security features (rate limiting, PII filtering)

### Planned Features
- API key authentication
- Advanced analytics and reporting
- Multi-language support
- Custom tool development framework
- Advanced workflow templates
- Integration with external CRM systems

## Support

For API support and questions:
- **Documentation**: This document and README.md
- **Issues**: GitHub Issues for bug reports and feature requests
- **Examples**: See the `/examples` directory for implementation examples
- **Testing**: Use the test endpoints for development and debugging

---

*This API documentation is automatically generated and updated with each release.*