# CF AI Support Bot

An AI-powered support bot built on Cloudflare's edge computing platform, featuring real-time chat, voice interaction, and intelligent tool integration.

## 🏗️ Architecture

This project leverages Cloudflare's full-stack platform:

- **Workers AI**: Llama 3.3 70B model for intelligent responses
- **Durable Objects**: Session-scoped memory and state management
- **Workflows**: Reliable orchestration for complex operations
- **Pages + Realtime**: Real-time chat interface with WebSocket connectivity
- **KV + R2**: Caching and conversation archival

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account

### Local Development

1. **Clone and install dependencies:**
   ```bash
   git clone <your-repo-url>
   cd cf_ai_supportbot
   npm install
   ```

2. **Configure Wrangler:**
   ```bash
   wrangler login
   ```

3. **Set up resources:**
   ```bash
   # Create KV namespace
   wrangler kv:namespace create "CHAT_KV"
   
   # Create R2 bucket
   wrangler r2 bucket create cf-ai-supportbot-archives
   ```

4. **Update wrangler.toml** with your KV namespace ID and R2 bucket name

5. **Start development server:**
   ```bash
   npm run dev
   ```

### Deployment

Deploy to Cloudflare with a single command:

```bash
./deploy.sh
```

Or manually:

```bash
npm run deploy
wrangler pages deploy pages/dist
```

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
├── workers/           # Backend Workers
│   ├── api.ts        # Main API handler
│   ├── do_memory.ts  # Durable Object for memory
│   └── workflow.ts   # Workflow definitions
├── pages/            # Frontend Pages
│   ├── index.html    # Chat interface
│   ├── app.tsx       # React components
│   └── voice.ts      # Voice handling
├── tests/            # Test suites
├── wrangler.toml     # Cloudflare configuration
└── deploy.sh         # Deployment script
```

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

## 🤝 Contributing

This project was built for the Cloudflare AI assignment. See `PROMPTS.md` for AI assistance details.

## 📄 License

MIT License - see LICENSE file for details.

---

**Live Demo**: [Coming Soon - Will be updated after deployment]

**Assignment Requirements**: ✅ Repository prefixed with `cf_ai_`, includes README.md and PROMPTS.md