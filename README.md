# CF AI Support Bot

An AI-powered support bot built on Cloudflare's edge computing platform, featuring real-time chat, voice interaction, and intelligent tool integration. This project demonstrates the full capabilities of Cloudflare's edge computing stack with low-latency AI responses, persistent session memory, and reliable workflow orchestration.

## 🏗️ Architecture

This project leverages Cloudflare's full-stack platform to deliver a comprehensive AI support solution:

### Core Components

- **Workers AI**: Llama 3.3 70B model for intelligent responses with OpenAI fallback
- **Durable Objects**: Session-scoped memory and state management with automatic summarization
- **Workflows**: Reliable orchestration for complex operations with retry logic and compensation
- **Pages + Realtime**: Real-time chat interface with WebSocket connectivity and voice support
- **KV Storage**: Caching for embeddings, rate limiting, and session metadata
- **R2 Storage**: Long-term conversation archival and data persistence

### Architecture Diagram

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Worker    │    │  Durable Object │
│   (Pages)       │◄──►│   (Workers)     │◄──►│   (Memory)      │
│                 │    │                 │    │                 │
│ • React UI      │    │ • Request       │    │ • Session State │
│ • WebSocket     │    │   Routing       │    │ • Conversation  │
│ • Voice I/O     │    │ • AI Integration│    │   History       │
│ • Real-time     │    │ • Tool Calling  │    │ • Summarization │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       ▼                       │
         │              ┌─────────────────┐              │
         │              │   Workflows     │              │
         │              │   (Orchestration)│              │
         │              │                 │              │
         │              │ • Multi-step    │              │
         │              │   Operations    │              │
         │              │ • Retry Logic   │              │
         │              │ • Compensation  │              │
         │              └─────────────────┘              │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   External      │    │   Tool System   │    │   Storage       │
│   Services      │    │                 │    │                 │
│                 │    │ • Knowledge     │    │ • KV Cache      │
│ • OpenAI API    │    │   Base Search   │    │ • R2 Archives   │
│ • Speech APIs   │    │ • Ticketing     │    │ • Metrics       │
│ • Knowledge DB  │    │ • Status Check  │    │ • Logs          │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Data Flow

1. **User Interaction**: User sends message via WebSocket or voice input
2. **Session Management**: Durable Object maintains conversation context and history
3. **AI Processing**: Workers AI processes message with conversation context
4. **Tool Integration**: AI can call tools for knowledge search or ticket creation
5. **Workflow Orchestration**: Complex operations use Workflows for reliability
6. **Response Delivery**: Real-time response via WebSocket with optional TTS
7. **Persistence**: Conversation archived to R2, metrics stored in KV

## 🔒 Security Features

The AI Support Bot includes comprehensive security measures:

### Rate Limiting
- **Per-minute limits**: 30 requests per minute per session
- **Token limits**: 10,000 tokens per hour per session
- **Concurrent sessions**: Maximum 5 active sessions per IP
- **Burst allowance**: 10 additional requests for traffic spikes

### PII Detection & Filtering
Automatically detects and redacts sensitive information:
- Email addresses → `[EMAIL_REDACTED]`
- Phone numbers → `[PHONE_REDACTED]`
- Social Security Numbers → `[SSN_REDACTED]`
- Credit card numbers → `[CARD_REDACTED]`
- IP addresses → `[IP_REDACTED]`

### Content Filtering
Blocks malicious content and prompt injection attempts:
- Prompt injection patterns ("ignore previous instructions")
- Jailbreak attempts ("roleplay as")
- System prompt extraction attempts
- Messages exceeding length limits (4000 characters)

### Input Sanitization
- HTML entity encoding to prevent XSS attacks
- Special character escaping
- Whitespace normalization

### Security Logging
- Request ID tracking for all operations
- Security event logging (PII detection, blocked requests)
- IP address and User-Agent tracking
- Structured logging with timestamps and context

### Error Handling
- Graceful degradation when security services fail
- "Fail open" approach for rate limiting to maintain availability
- Circuit breaker patterns for external service failures

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+**: Required for development and build tools
- **Wrangler CLI**: Cloudflare's command-line tool for Workers
  ```bash
  npm install -g wrangler@latest
  ```
- **Cloudflare Account**: With access to Workers, Durable Objects, AI, KV, R2, and Workflows
- **API Keys**: OpenAI API key for fallback model (optional but recommended)

### Environment Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <your-repo-url>
   cd cf_ai_supportbot
   npm install
   ```

2. **Authenticate with Cloudflare:**
   ```bash
   wrangler login
   wrangler whoami  # Verify authentication
   ```

3. **Automated setup (recommended):**
   ```bash
   # Run the setup script for your environment
   ./scripts/setup-environment.sh development
   ```
   
   Or manual setup:

4. **Create Cloudflare resources:**
   ```bash
   # Create KV namespace for caching
   wrangler kv:namespace create "CHAT_KV"
   wrangler kv:namespace create "CHAT_KV" --preview
   
   # Create R2 bucket for conversation archives
   wrangler r2 bucket create cf-ai-supportbot-archives
   
   # Note the IDs returned and update wrangler.toml
   ```

5. **Configure secrets:**
   ```bash
   # Set OpenAI API key (optional fallback)
   wrangler secret put OPENAI_API_KEY
   
   # Set knowledge base API key (if using external KB)
   wrangler secret put KNOWLEDGE_BASE_API_KEY
   
   # Set ticketing system API key (if using external ticketing)
   wrangler secret put TICKETING_API_KEY
   ```

6. **Update configuration:**
   Edit `wrangler.toml` with your actual resource IDs:
   ```toml
   [[kv_namespaces]]
   binding = "CHAT_KV"
   id = "your-kv-namespace-id"
   preview_id = "your-preview-kv-namespace-id"
   
   [[r2_buckets]]
   binding = "ARCHIVE_R2"
   bucket_name = "cf-ai-supportbot-archives"
   ```

### Local Development

1. **Start the development server:**
   ```bash
   npm run dev
   ```
   This starts the Workers development server with hot reloading.

2. **Build and serve the frontend:**
   ```bash
   # In a separate terminal
   npm run build:frontend
   npm run pages:dev
   ```

3. **Access the application:**
   - **API**: http://localhost:8787
   - **Frontend**: http://localhost:8788
   - **Demo**: http://localhost:8788/demo.html

### Testing

Run the comprehensive test suite:

```bash
# Run all tests
npm run test:run

# Run specific test types
npm run test:unit          # Unit tests
npm run test:integration   # Integration tests
npm run test:coverage      # Coverage report

# Load testing (requires k6)
npm run test:load
```

## 💻 Frontend Interface

The chat interface is built with React and provides a modern, responsive user experience with real-time capabilities.

### Features

- **Real-time Chat**: WebSocket-powered messaging with automatic reconnection
- **Voice Input**: Speech-to-text using Web Speech API with graceful fallbacks
- **Voice Output**: Text-to-speech for AI responses (optional)
- **Session Management**: Persistent conversation context across page reloads
- **Tool Integration**: Visual indicators for AI tool usage (knowledge base, ticketing)
- **Responsive Design**: Mobile-first design with accessibility features
- **Error Handling**: Graceful degradation and user-friendly error messages

### Frontend Architecture

```
pages/
├── index.html          # Main chat interface
├── demo.html           # Feature demonstration page
├── styles.css          # Responsive CSS with accessibility
├── app.jsx             # Main React chat component
├── websocket-manager.js # WebSocket connection management
├── voice-manager.js    # Speech recognition and synthesis
└── dist/               # Built files for deployment
```

### Key Components

#### Chat Interface (`app.jsx`)
- React-based chat UI with hooks for state management
- Real-time message display with typing indicators
- Voice input/output integration
- Session initialization and reconnection handling

#### WebSocket Manager (`websocket-manager.js`)
- Automatic connection management with exponential backoff
- Message parsing and routing
- Session-scoped communication
- Reconnection logic for network interruptions

#### Voice Manager (`voice-manager.js`)
- Browser speech recognition integration
- Text-to-speech for AI responses
- Graceful fallback to text-only mode
- Voice state management and error handling

### Usage

1. **Access the chat interface:**
   ```
   http://localhost:8788/  # Main chat interface
   http://localhost:8788/demo.html  # Feature demo
   ```

2. **Voice Features:**
   - Click the microphone button to start voice input
   - Speak your message and it will be automatically transcribed
   - AI responses can be read aloud (browser dependent)

3. **Real-time Features:**
   - Messages appear instantly via WebSocket
   - Typing indicators show when AI is processing
   - Automatic reconnection if connection is lost

### Browser Compatibility

- **WebSocket**: All modern browsers
- **Speech Recognition**: Chrome, Edge, Safari (with webkit prefix)
- **Speech Synthesis**: All modern browsers
- **Responsive Design**: All modern browsers with CSS Grid support

### Testing

Frontend tests cover WebSocket management, voice functionality, and React components:

```bash
npm run test:run tests/frontend.test.ts
```

### Deployment

The frontend is deployed as a Cloudflare Pages application:

```bash
npm run pages:deploy
   ```

### Deployment

#### Automated Deployment (Recommended)

Deploy to production with a single command:

```bash
./deploy.sh
```

Deploy to specific environments:

```bash
./deploy.sh staging    # Deploy to staging
./deploy.sh production # Deploy to production (default)
```

#### Manual Deployment

1. **Build the project:**
   ```bash
   npm run build
   npm run build:frontend
   ```

2. **Deploy the Worker:**
   ```bash
   wrangler deploy --env production
   ```

3. **Deploy the frontend:**
   ```bash
   wrangler pages deploy pages/dist --project-name cf-ai-supportbot-frontend
   ```

#### CI/CD Deployment

The project includes GitHub Actions for automated deployment:

- **Staging**: Auto-deploys on push to `develop` branch
- **Production**: Auto-deploys on push to `main` branch

Required GitHub Secrets:
- `CLOUDFLARE_API_TOKEN`
- `OPENAI_API_KEY`
- `KNOWLEDGE_BASE_API_KEY`
- `TICKETING_API_KEY`

#### Deployment Verification

After deployment, verify the system is working:

```bash
./scripts/verify-deployment.sh production
```

This checks:
- API health endpoints
- WebSocket connectivity
- AI model integration
- Tool functionality
- Performance metrics

## 🎯 Features

- **Real-time Chat**: WebSocket-based chat interface
- **AI Intelligence**: Powered by Llama 3.3 with OpenAI fallback
- **Voice Support**: Speech-to-text and text-to-speech capabilities
- **Tool Integration**: Knowledge base search, ticket creation, status checking
- **Session Memory**: Conversation context and summarization
- **Reliable Processing**: Workflow orchestration with retry logic
- **Security**: Rate limiting, PII filtering, content moderation

## 📁 Project Structure

```
cf_ai_supportbot/
├── workers/                    # Backend Workers and Services
│   ├── api.ts                 # Main API handler with WebSocket support
│   ├── do_memory.ts           # Durable Object for session memory
│   ├── workflow.ts            # Workflow definitions and orchestration
│   ├── workflow_service.ts    # Workflow execution service
│   ├── tools.ts               # Base tool interfaces and registry
│   ├── knowledge_base_tool.ts # Knowledge base search tool
│   ├── ticketing_tool.ts      # Support ticket management tool
│   ├── security.ts            # Security middleware and PII filtering
│   ├── logging.ts             # Structured logging system
│   ├── monitoring_middleware.ts # Request monitoring and metrics
│   ├── data_persistence.ts    # Data archival and persistence
│   └── types.ts               # TypeScript type definitions
├── pages/                     # Frontend Application
│   ├── index.html             # Main chat interface
│   ├── demo.html              # Feature demonstration page
│   ├── app.jsx                # React chat component
│   ├── websocket-manager.js   # WebSocket connection management
│   ├── voice-manager.js       # Speech recognition and synthesis
│   ├── styles.css             # Responsive CSS with accessibility
│   └── dist/                  # Built frontend files
├── tests/                     # Comprehensive Test Suite
│   ├── integration/           # End-to-end integration tests
│   ├── load/                  # Load testing with k6
│   ├── *.test.ts             # Unit tests for all components
│   └── setup.ts              # Test configuration and utilities
├── scripts/                   # Deployment and Operations Scripts
│   ├── setup-environment.sh   # Environment initialization
│   ├── verify-deployment.sh   # Deployment verification
│   ├── monitor-deployment.sh  # Post-deployment monitoring
│   └── rollback.sh            # Rollback procedures
├── .github/workflows/         # CI/CD Pipeline
│   └── ci-cd.yml             # GitHub Actions workflow
├── wrangler.toml             # Cloudflare Workers configuration
├── deploy.sh                 # Main deployment script
├── package.json              # Node.js dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── vitest.config.ts          # Test configuration
├── README.md                 # This documentation
├── PROMPTS.md                # AI assistance documentation
├── DEPLOYMENT.md             # Detailed deployment guide
└── MONITORING.md             # Monitoring and observability guide
```

## 📚 API Documentation

### REST API Endpoints

#### Health and Status

**GET /health**
- **Description**: System health check
- **Response**: 200 OK with health status
- **Example**:
  ```json
  {
    "status": "healthy",
    "timestamp": 1640995200000,
    "components": {
      "ai_service": "healthy",
      "memory_service": "healthy",
      "tool_service": "healthy"
    }
  }
  ```

**GET /api/status**
- **Description**: Detailed system status and metrics
- **Response**: System performance metrics
- **Example**:
  ```json
  {
    "status": "operational",
    "metrics": {
      "active_sessions": 42,
      "requests_per_minute": 150,
      "average_latency_ms": 250
    }
  }
  ```

#### Chat API

**POST /api/chat**
- **Description**: Send a chat message and receive AI response
- **Content-Type**: application/json
- **Body**:
  ```json
  {
    "message": "Hello, I need help with billing",
    "sessionId": "sess_123456789",
    "userId": "user_abc123" // optional
  }
  ```
- **Response**: 200 OK with AI response
  ```json
  {
    "response": "I'd be happy to help with your billing questions...",
    "sessionId": "sess_123456789",
    "messageId": "msg_987654321",
    "timestamp": 1640995200000,
    "toolCalls": [
      {
        "tool": "kb.search",
        "parameters": { "query": "billing help" },
        "result": { "articles": [...] }
      }
    ]
  }
  ```

#### Session Management

**POST /api/session**
- **Description**: Create a new chat session
- **Response**: 201 Created with session details
  ```json
  {
    "sessionId": "sess_123456789",
    "createdAt": 1640995200000,
    "expiresAt": 1641081600000
  }
  ```

**GET /api/session/{sessionId}**
- **Description**: Get session information and conversation history
- **Response**: Session data with recent messages
  ```json
  {
    "sessionId": "sess_123456789",
    "status": "active",
    "messageCount": 15,
    "recentMessages": [...],
    "summary": "User asking about billing issues..."
  }
  ```

**DELETE /api/session/{sessionId}**
- **Description**: End a chat session
- **Response**: 204 No Content

#### Tool Integration

**POST /api/tools/search**
- **Description**: Search the knowledge base
- **Body**:
  ```json
  {
    "query": "how to reset password",
    "maxResults": 5,
    "filters": {
      "category": "account"
    }
  }
  ```
- **Response**: Search results
  ```json
  {
    "results": [
      {
        "id": "kb_001",
        "title": "How to Reset Your Password",
        "content": "To reset your password...",
        "url": "https://help.example.com/reset-password",
        "relevance": 0.95
      }
    ]
  }
  ```

**POST /api/tools/ticket**
- **Description**: Create a support ticket
- **Body**:
  ```json
  {
    "title": "Cannot access my account",
    "description": "I'm unable to log in after password reset",
    "priority": "medium",
    "category": "account"
  }
  ```
- **Response**: Ticket information
  ```json
  {
    "ticketId": "TKT-123456",
    "status": "open",
    "priority": "medium",
    "estimatedResolution": 1641081600000
  }
  ```

### WebSocket API

#### Connection

**WebSocket Endpoint**: `/ws`
- **Protocol**: WebSocket over HTTP/HTTPS
- **Authentication**: Session-based (sessionId in query params)
- **URL**: `wss://your-worker.your-subdomain.workers.dev/ws?sessionId=sess_123`

#### Message Format

All WebSocket messages use JSON format:

```json
{
  "type": "message_type",
  "data": { ... },
  "timestamp": 1640995200000,
  "requestId": "req_123456789"
}
```

#### Client to Server Messages

**Send Chat Message**:
```json
{
  "type": "chat_message",
  "data": {
    "content": "Hello, I need help",
    "sessionId": "sess_123456789"
  }
}
```

**Voice Input**:
```json
{
  "type": "voice_input",
  "data": {
    "audioData": "base64_encoded_audio",
    "format": "webm",
    "sessionId": "sess_123456789"
  }
}
```

**Typing Indicator**:
```json
{
  "type": "typing",
  "data": {
    "isTyping": true,
    "sessionId": "sess_123456789"
  }
}
```

#### Server to Client Messages

**AI Response**:
```json
{
  "type": "ai_response",
  "data": {
    "content": "I can help you with that...",
    "messageId": "msg_987654321",
    "sessionId": "sess_123456789",
    "toolCalls": [...]
  }
}
```

**Typing Indicator**:
```json
{
  "type": "ai_typing",
  "data": {
    "isTyping": true,
    "sessionId": "sess_123456789"
  }
}
```

**Error Message**:
```json
{
  "type": "error",
  "data": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please wait.",
    "retryAfter": 60
  }
}
```

**Connection Status**:
```json
{
  "type": "connection_status",
  "data": {
    "status": "connected",
    "sessionId": "sess_123456789",
    "serverTime": 1640995200000
  }
}
```

### Error Handling

#### HTTP Status Codes

- **200 OK**: Successful request
- **201 Created**: Resource created successfully
- **400 Bad Request**: Invalid request format or parameters
- **401 Unauthorized**: Authentication required
- **403 Forbidden**: Access denied
- **404 Not Found**: Resource not found
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server error
- **503 Service Unavailable**: Service temporarily unavailable

#### Error Response Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional error details"
    },
    "retryable": true,
    "retryAfter": 60
  },
  "requestId": "req_123456789",
  "timestamp": 1640995200000
}
```

#### Common Error Codes

- `INVALID_SESSION`: Session ID is invalid or expired
- `RATE_LIMIT_EXCEEDED`: Too many requests from client
- `AI_SERVICE_UNAVAILABLE`: AI model temporarily unavailable
- `TOOL_EXECUTION_FAILED`: Tool call failed to execute
- `VALIDATION_ERROR`: Request validation failed
- `INTERNAL_ERROR`: Unexpected server error

### Rate Limiting

The API implements rate limiting per session:

- **Requests**: 30 per minute per session
- **Tokens**: 10,000 per hour per session
- **Concurrent Sessions**: 5 per IP address
- **WebSocket Messages**: 60 per minute per session

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 25
X-RateLimit-Reset: 1640995260
```

### Authentication

Currently, the API uses session-based authentication:

1. Create a session via `POST /api/session`
2. Use the returned `sessionId` in subsequent requests
3. Sessions expire after 24 hours of inactivity

For production deployments, consider implementing:
- API key authentication for programmatic access
- OAuth 2.0 for user authentication
- JWT tokens for stateless authentication

## 🧪 Testing

Run the test suite:

```bash
npm test
npm run test:coverage
```

## 📊 Monitoring

The application includes comprehensive observability:

- Request tracing with unique IDs
- Performance metrics and latency tracking
- Error monitoring and alerting
- Resource usage monitoring

## 🔧 Configuration

Key environment variables in `wrangler.toml`:

- `MAX_TOKENS`: Maximum tokens per AI request (default: 4096)
- `RATE_LIMIT_PER_MINUTE`: Rate limit per session (default: 60)
- `SESSION_TTL_HOURS`: Session timeout (default: 24)

## 🔧 Troubleshooting Guide

### Common Issues and Solutions

#### 1. Deployment Issues

**Problem**: `wrangler deploy` fails with "Unauthorized"
```bash
Error: Authentication error
```
**Solution**:
```bash
wrangler logout
wrangler login
wrangler whoami  # Verify authentication
```

**Problem**: KV namespace or R2 bucket not found
```bash
Error: KV namespace with id "xxx" not found
```
**Solution**:
```bash
# Run the setup script to create resources
./scripts/setup-environment.sh development

# Or create manually and update wrangler.toml
wrangler kv:namespace create "CHAT_KV"
```

#### 2. Development Issues

**Problem**: TypeScript compilation errors
```bash
Error: Type 'X' is not assignable to type 'Y'
```
**Solution**:
```bash
# Check TypeScript configuration
npx tsc --noEmit

# Update dependencies
npm update @cloudflare/workers-types
```

**Problem**: Frontend build fails
```bash
Error: Module not found
```
**Solution**:
```bash
# Clean and rebuild
rm -rf pages/dist node_modules
npm install
npm run build:frontend
```

#### 3. Runtime Issues

**Problem**: AI model returns errors
```bash
Error: Model inference failed
```
**Solution**:
- Check if Workers AI is enabled in your Cloudflare account
- Verify the model name in `workers/api.ts`
- Check rate limits and quotas
- Ensure OpenAI fallback is configured if needed

**Problem**: WebSocket connections fail
```bash
WebSocket connection failed
```
**Solution**:
- Verify the WebSocket endpoint URL
- Check CORS configuration
- Ensure the Worker is deployed and accessible
- Test with a simple WebSocket client

#### 4. Performance Issues

**Problem**: High latency responses
**Solution**:
- Check AI model performance in Cloudflare dashboard
- Review Durable Object memory usage
- Optimize tool execution times
- Consider caching frequently accessed data

**Problem**: Memory usage warnings
**Solution**:
- Implement conversation summarization
- Clean up old session data
- Optimize data structures
- Monitor DO memory consumption

### Debugging Commands

```bash
# View real-time logs
wrangler tail cf-ai-supportbot

# Check deployment status
wrangler deployments list --name cf-ai-supportbot

# Test API endpoints
curl -X GET https://your-worker.your-subdomain.workers.dev/health

# Run diagnostics
./scripts/verify-deployment.sh development --detailed

# Monitor performance
./scripts/monitor-deployment.sh development 10
```

### Performance Optimization

#### Frontend Optimization
- Enable browser caching for static assets
- Minimize JavaScript bundle size
- Use WebSocket connection pooling
- Implement message batching for high-frequency updates

#### Backend Optimization
- Cache AI model responses for similar queries
- Optimize Durable Object state management
- Use KV storage for frequently accessed data
- Implement request deduplication

#### AI Model Optimization
- Fine-tune prompt engineering for better responses
- Implement response caching for common queries
- Use streaming responses for long outputs
- Optimize token usage to reduce costs

## ❓ Frequently Asked Questions

### General Questions

**Q: What makes this different from other chatbots?**
A: This bot leverages Cloudflare's edge computing platform for ultra-low latency, uses Durable Objects for consistent session management, and includes Workflows for reliable complex operations. It's built specifically to showcase Cloudflare's unique advantages.

**Q: Can I use this in production?**
A: Yes, but consider implementing additional security measures like API authentication, enhanced rate limiting, and comprehensive monitoring. Review the security section in this README.

**Q: How much does it cost to run?**
A: Costs depend on usage. Cloudflare's pricing is very competitive for edge computing. Main costs are Workers requests, AI model inference, Durable Object operations, and storage. See Cloudflare's pricing page for details.

### Technical Questions

**Q: Why use Durable Objects instead of a traditional database?**
A: Durable Objects provide strong consistency, low latency, and automatic scaling at the edge. They're perfect for session state that needs to be immediately consistent and globally accessible.

**Q: How does the AI fallback work?**
A: If Cloudflare's Workers AI is unavailable, the system automatically falls back to OpenAI's API. This ensures high availability even during service disruptions.

**Q: Can I add custom tools?**
A: Yes! The tool system is extensible. Create a new tool class implementing the `Tool` interface and register it in the `ToolRegistry`. See `workers/tools.ts` for examples.

**Q: How does conversation memory work?**
A: Each session gets a Durable Object that stores conversation history. When memory limits are reached, older messages are summarized to preserve context while reducing storage.

### Deployment Questions

**Q: Can I deploy to multiple environments?**
A: Yes, the project supports multiple environments (development, staging, production) with separate configurations and resources.

**Q: How do I set up CI/CD?**
A: The project includes GitHub Actions workflows. Set up the required secrets in your GitHub repository and the workflows will handle automated testing and deployment.

**Q: Can I use a custom domain?**
A: Yes, configure a custom domain in Cloudflare Pages for the frontend and Workers for the API. Update the WebSocket URLs accordingly.

### Customization Questions

**Q: How do I change the AI model?**
A: Update the model name in `workers/api.ts`. Ensure the model is available in Workers AI and adjust parameters as needed.

**Q: Can I customize the UI?**
A: Absolutely! The frontend is built with React and standard CSS. Modify `pages/app.jsx` and `pages/styles.css` to customize the interface.

**Q: How do I add new languages?**
A: The system supports multiple languages through the AI model. Add language detection and update prompts in `PROMPTS.md` for better multilingual support.

### Monitoring Questions

**Q: How do I monitor the system in production?**
A: The project includes comprehensive monitoring with structured logging, metrics collection, and health checks. See `MONITORING.md` for detailed setup instructions.

**Q: What metrics should I track?**
A: Key metrics include response latency, error rates, AI token usage, active sessions, and tool execution times. The monitoring system tracks these automatically.

**Q: How do I set up alerts?**
A: Configure alert rules in the monitoring system or integrate with external services like PagerDuty or Slack. See the monitoring documentation for examples.

## 🤝 Contributing

This project was built for the Cloudflare AI assignment to demonstrate the full capabilities of Cloudflare's edge computing platform. 

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test:run`
5. Submit a pull request

### Code Style

- Use TypeScript for all new code
- Follow the existing code structure
- Add tests for new functionality
- Update documentation as needed

See `PROMPTS.md` for details on AI assistance used in development.

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Links and Resources

- **Live Demo**: [Coming Soon - Will be updated after deployment]
- **Cloudflare Workers**: https://workers.cloudflare.com/
- **Workers AI**: https://developers.cloudflare.com/workers-ai/
- **Durable Objects**: https://developers.cloudflare.com/durable-objects/
- **Cloudflare Pages**: https://pages.cloudflare.com/
- **Wrangler CLI**: https://developers.cloudflare.com/workers/wrangler/

---

**Assignment Requirements**: ✅ Repository prefixed with `cf_ai_`, includes comprehensive README.md and PROMPTS.md

**Built with ❤️ on Cloudflare's Edge Computing Platform**