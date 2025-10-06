# Troubleshooting Guide and FAQ

## Table of Contents

- [Common Issues](#common-issues)
- [Deployment Problems](#deployment-problems)
- [Runtime Issues](#runtime-issues)
- [Performance Problems](#performance-problems)
- [Security Issues](#security-issues)
- [Frequently Asked Questions](#frequently-asked-questions)
- [Debugging Tools](#debugging-tools)
- [Getting Help](#getting-help)

## Common Issues

### 1. Authentication and Authorization

#### Problem: "Unauthorized" error during deployment
```bash
Error: Authentication error - Unauthorized
```

**Causes:**
- Wrangler not authenticated
- Invalid API token
- Insufficient permissions

**Solutions:**
```bash
# Re-authenticate with Wrangler
wrangler logout
wrangler login

# Verify authentication
wrangler whoami

# Check API token permissions (if using CI/CD)
# Ensure token has Workers:Edit, Pages:Edit, and Account:Read permissions
```

#### Problem: Session authentication failures
```json
{
  "error": {
    "code": "INVALID_SESSION",
    "message": "Session ID is invalid or expired"
  }
}
```

**Solutions:**
- Create a new session via `POST /api/session`
- Check session expiration (24 hours default)
- Verify session ID format and encoding
- Clear browser cache and cookies

### 2. Resource Configuration

#### Problem: KV namespace or R2 bucket not found
```bash
Error: KV namespace with id "xxx" not found
Error: R2 bucket "xxx" not found
```

**Solutions:**
```bash
# Run automated setup
./scripts/setup-environment.sh development

# Or create resources manually
wrangler kv:namespace create "CHAT_KV"
wrangler kv:namespace create "CHAT_KV" --preview
wrangler r2 bucket create cf-ai-supportbot-archives

# Update wrangler.toml with the returned IDs
```

#### Problem: Durable Object binding errors
```bash
Error: Durable Object binding "MEMORY_DO" not found
```

**Solutions:**
- Ensure Durable Objects are enabled in your Cloudflare account
- Check `wrangler.toml` configuration:
```toml
[[durable_objects.bindings]]
name = "MEMORY_DO"
class_name = "SessionMemoryDO"
script_name = "cf-ai-supportbot"
```
- Verify the DO class is properly exported in your Worker

### 3. AI Model Integration

#### Problem: AI model inference failures
```json
{
  "error": {
    "code": "AI_SERVICE_UNAVAILABLE",
    "message": "AI model temporarily unavailable"
  }
}
```

**Causes:**
- Workers AI service outage
- Model not available in your region
- Rate limits exceeded
- Invalid model parameters

**Solutions:**
```typescript
// Check model availability
const models = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8', {
  messages: [{ role: 'user', content: 'test' }]
});

// Implement fallback to OpenAI
if (!response.success && env.OPENAI_API_KEY) {
  // Use OpenAI fallback
}

// Check rate limits in Cloudflare dashboard
// Verify model name and parameters
```

#### Problem: High AI response latency
**Symptoms:**
- Responses taking >5 seconds
- Timeout errors
- Poor user experience

**Solutions:**
- Optimize prompt length and complexity
- Use streaming responses for long outputs
- Implement response caching for common queries
- Check AI service status in Cloudflare dashboard
- Consider using a faster model variant

### 4. WebSocket Connection Issues

#### Problem: WebSocket connection failures
```javascript
WebSocket connection to 'wss://...' failed: Error during WebSocket handshake
```

**Causes:**
- CORS configuration issues
- Invalid WebSocket URL
- Network connectivity problems
- Server not supporting WebSocket upgrade

**Solutions:**
```javascript
// Check WebSocket URL format
const wsUrl = `wss://${workerDomain}/ws?sessionId=${sessionId}`;

// Verify CORS headers in Worker
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Test with simple WebSocket client
const ws = new WebSocket(wsUrl);
ws.onopen = () => console.log('Connected');
ws.onerror = (error) => console.error('WebSocket error:', error);
```

#### Problem: WebSocket disconnections
**Symptoms:**
- Frequent disconnections
- Messages not being delivered
- Connection timeouts

**Solutions:**
- Implement heartbeat/ping-pong mechanism
- Add exponential backoff for reconnection
- Check network stability
- Monitor Durable Object hibernation patterns
- Implement message queuing during disconnections

## Deployment Problems

### 1. Build and Compilation Issues

#### Problem: TypeScript compilation errors
```bash
Error: Type 'X' is not assignable to type 'Y'
```

**Solutions:**
```bash
# Check TypeScript configuration
npx tsc --noEmit

# Update type definitions
npm update @cloudflare/workers-types

# Check for missing type imports
import { WorkerBindings } from './types';

# Verify interface compatibility
```

#### Problem: Frontend build failures
```bash
Error: Module not found: Can't resolve 'react'
```

**Solutions:**
```bash
# Clean and rebuild
rm -rf pages/dist node_modules package-lock.json
npm install
npm run build:frontend

# Check React dependencies
npm list react react-dom

# Verify build script configuration
```

### 2. Wrangler Configuration

#### Problem: Invalid wrangler.toml configuration
```bash
Error: Configuration file has errors
```

**Common Issues:**
```toml
# Incorrect binding syntax
[[kv_namespaces]]
binding = "CHAT_KV"
id = "your-actual-kv-namespace-id"  # Must be real ID
preview_id = "your-preview-id"      # Must be real preview ID

# Missing required fields
name = "cf-ai-supportbot"           # Required
main = "workers/api.ts"             # Required
compatibility_date = "2024-01-01"   # Required

# Incorrect environment configuration
[env.production]
name = "cf-ai-supportbot"           # Don't duplicate name
```

#### Problem: Deployment size limits
```bash
Error: Script too large (exceeds 1MB limit)
```

**Solutions:**
- Remove unused dependencies
- Optimize bundle size with tree shaking
- Split large files into smaller modules
- Use dynamic imports for optional features
- Check for accidentally included large files

### 3. Environment Setup

#### Problem: Missing environment variables
```bash
Error: Required environment variable not found
```

**Solutions:**
```bash
# Set required secrets
wrangler secret put OPENAI_API_KEY
wrangler secret put KNOWLEDGE_BASE_API_KEY
wrangler secret put TICKETING_API_KEY

# Verify secrets are set
wrangler secret list

# Check environment-specific configuration
```

## Runtime Issues

### 1. Memory and Performance

#### Problem: Durable Object memory warnings
```bash
Warning: Durable Object approaching memory limit
```

**Causes:**
- Large conversation histories
- Memory leaks in session data
- Inefficient data structures

**Solutions:**
```typescript
// Implement conversation summarization
async generateSummary() {
  if (this.messages.length > 50) {
    const oldMessages = this.messages.slice(0, -20);
    const summary = await this.summarizeMessages(oldMessages);
    this.messages = this.messages.slice(-20);
    this.summary = summary;
  }
}

// Clean up expired sessions
async cleanup() {
  const now = Date.now();
  if (now - this.lastActivity > this.ttl) {
    await this.archiveToR2();
    this.state.deleteAll();
  }
}
```

#### Problem: High CPU usage
**Symptoms:**
- Slow response times
- CPU limit exceeded errors
- Request timeouts

**Solutions:**
- Optimize AI prompt processing
- Implement caching for expensive operations
- Use async/await properly to avoid blocking
- Profile code for performance bottlenecks
- Consider breaking large operations into smaller chunks

### 2. Tool Integration Issues

#### Problem: Tool execution failures
```json
{
  "error": {
    "code": "TOOL_EXECUTION_FAILED",
    "message": "Knowledge base search failed"
  }
}
```

**Debugging Steps:**
```typescript
// Add detailed logging
console.log('Executing tool:', toolName, parameters);
try {
  const result = await tool.execute(parameters, context);
  console.log('Tool result:', result);
  return result;
} catch (error) {
  console.error('Tool execution error:', error);
  // Implement fallback behavior
}

// Test tools individually
const testResult = await toolRegistry.executeTool('kb.search', {
  query: 'test query'
}, testContext);
```

#### Problem: External API timeouts
**Solutions:**
- Implement proper timeout handling
- Add retry logic with exponential backoff
- Use circuit breaker pattern for failing services
- Implement fallback responses
- Monitor external service status

### 3. Data Persistence Issues

#### Problem: KV storage errors
```bash
Error: KV operation failed
```

**Solutions:**
```typescript
// Implement retry logic for KV operations
async function kvPutWithRetry(key: string, value: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await env.CHAT_KV.put(key, value);
      return;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}

// Check KV namespace limits and usage
// Implement proper error handling
```

#### Problem: R2 storage issues
**Solutions:**
- Verify R2 bucket permissions
- Check file size limits
- Implement proper error handling for R2 operations
- Monitor R2 usage and costs
- Use appropriate content types and metadata

## Performance Problems

### 1. Latency Issues

#### Problem: High response latency
**Symptoms:**
- P95 latency >2 seconds
- User complaints about slow responses
- Timeout errors

**Diagnostic Steps:**
```bash
# Monitor performance
./scripts/monitor-deployment.sh production 30

# Check specific endpoints
curl -w "@curl-format.txt" -o /dev/null -s "https://your-worker.your-subdomain.workers.dev/api/chat"

# Analyze logs for bottlenecks
wrangler tail cf-ai-supportbot --format=pretty
```

**Solutions:**
- Optimize AI model calls
- Implement response caching
- Reduce Durable Object cold starts
- Optimize database queries
- Use CDN for static assets

### 2. Throughput Issues

#### Problem: Low request throughput
**Solutions:**
- Scale Durable Object instances
- Optimize request processing pipeline
- Implement request batching where appropriate
- Use KV storage for caching
- Monitor and adjust rate limits

### 3. Memory Usage

#### Problem: High memory consumption
**Monitoring:**
```typescript
// Monitor memory usage
const memoryUsage = process.memoryUsage();
console.log('Memory usage:', {
  rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
  heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
  heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
});
```

**Solutions:**
- Implement proper cleanup in Durable Objects
- Avoid memory leaks in event listeners
- Use streaming for large responses
- Implement garbage collection triggers

## Security Issues

### 1. Rate Limiting Problems

#### Problem: Rate limit false positives
**Symptoms:**
- Legitimate users being blocked
- Inconsistent rate limiting behavior

**Solutions:**
```typescript
// Implement more sophisticated rate limiting
class AdaptiveRateLimit {
  async checkLimit(sessionId: string, requestType: string) {
    const key = `rate_limit:${sessionId}:${requestType}`;
    const current = await env.CHAT_KV.get(key);
    
    // Implement sliding window or token bucket algorithm
    // Consider user behavior patterns
    // Allow burst capacity for legitimate users
  }
}
```

### 2. PII Detection Issues

#### Problem: PII false positives/negatives
**Solutions:**
- Improve PII detection patterns
- Implement context-aware filtering
- Add user feedback mechanism for false positives
- Regular pattern updates and testing
- Implement allowlist for known safe patterns

### 3. Content Filtering

#### Problem: Inappropriate content not filtered
**Solutions:**
- Update content filtering rules
- Implement multiple filtering layers
- Add human review for edge cases
- Monitor and analyze filtered content
- Implement user reporting mechanism

## Frequently Asked Questions

### General Questions

**Q: Why is my deployment failing?**
A: Common causes include authentication issues, resource configuration problems, or build errors. Check the specific error message and follow the troubleshooting steps above.

**Q: How do I monitor the system in production?**
A: Use the built-in monitoring system with structured logging, metrics collection, and alerting. See `MONITORING.md` for detailed setup instructions.

**Q: Can I customize the AI model responses?**
A: Yes, you can modify the system prompts in the code and adjust model parameters. See `PROMPTS.md` for all AI instructions used in the system.

### Technical Questions

**Q: How do I add custom tools?**
A: Implement the `Tool` interface and register your tool in the `ToolRegistry`. See `workers/tools.ts` for examples and patterns.

**Q: Why are WebSocket connections dropping?**
A: This can be due to network issues, Durable Object hibernation, or client-side problems. Implement proper reconnection logic and heartbeat mechanisms.

**Q: How do I optimize performance?**
A: Focus on AI model optimization, caching strategies, Durable Object efficiency, and proper resource management. Monitor key metrics and optimize bottlenecks.

### Deployment Questions

**Q: How do I deploy to multiple environments?**
A: Use the environment-specific deployment scripts and configurations. Each environment should have separate resources and configurations.

**Q: Can I rollback a deployment?**
A: Yes, use the rollback script: `./scripts/rollback.sh production`. This will revert to the previous deployment.

**Q: How do I set up CI/CD?**
A: Configure the GitHub Actions workflow with the required secrets. The workflow will automatically test and deploy on code changes.

### Troubleshooting Questions

**Q: How do I debug WebSocket issues?**
A: Use browser developer tools, check server logs with `wrangler tail`, and test with simple WebSocket clients to isolate the problem.

**Q: What should I do if AI responses are slow?**
A: Check AI service status, optimize prompts, implement caching, and consider using streaming responses for better user experience.

**Q: How do I handle high error rates?**
A: Monitor error patterns, implement proper retry logic, check external service status, and consider enabling fallback mechanisms.

## Debugging Tools

### 1. Wrangler Commands

```bash
# View real-time logs
wrangler tail cf-ai-supportbot --format=pretty

# Check deployment status
wrangler deployments list --name cf-ai-supportbot

# Test locally
wrangler dev --local

# Check KV data
wrangler kv:key list --binding=CHAT_KV

# Check R2 objects
wrangler r2 object list cf-ai-supportbot-archives
```

### 2. API Testing

```bash
# Health check
curl https://your-worker.your-subdomain.workers.dev/health

# Test chat endpoint
curl -X POST https://your-worker.your-subdomain.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "test", "sessionId": "test-session"}'

# Check metrics
curl https://your-worker.your-subdomain.workers.dev/api/metrics
```

### 3. Monitoring Scripts

```bash
# Run deployment verification
./scripts/verify-deployment.sh production --detailed

# Monitor system health
./scripts/monitor-deployment.sh production 15

# Check system status
./scripts/test-deployment.sh production
```

### 4. Browser Developer Tools

For frontend debugging:
- **Console**: Check for JavaScript errors and WebSocket messages
- **Network**: Monitor API calls and WebSocket connections
- **Application**: Check localStorage and session data
- **Performance**: Profile JavaScript execution and memory usage

### 5. Log Analysis

```bash
# Filter logs by error level
wrangler tail cf-ai-supportbot | grep "ERROR"

# Search for specific patterns
wrangler tail cf-ai-supportbot | grep "session_id"

# Monitor specific endpoints
wrangler tail cf-ai-supportbot | grep "/api/chat"
```

## Getting Help

### 1. Self-Service Resources

- **Documentation**: README.md, API_DOCUMENTATION.md, MONITORING.md
- **Code Examples**: Check the `/workers` directory for implementation examples
- **Test Cases**: Review test files for usage patterns and expected behavior

### 2. Diagnostic Information

When seeking help, provide:
- Error messages and stack traces
- Relevant log entries
- Steps to reproduce the issue
- Environment information (development/staging/production)
- Recent changes or deployments

### 3. Escalation Path

1. **Check Documentation**: Review this troubleshooting guide and other docs
2. **Search Issues**: Look for similar problems in GitHub issues
3. **Create Issue**: Open a new GitHub issue with detailed information
4. **Community Support**: Ask in relevant developer communities
5. **Professional Support**: Consider Cloudflare support for infrastructure issues

### 4. Emergency Procedures

For critical production issues:

1. **Immediate Response**:
   ```bash
   # Check system health
   ./scripts/verify-deployment.sh production
   
   # Monitor error rates
   ./scripts/monitor-deployment.sh production 5
   ```

2. **Rollback if Necessary**:
   ```bash
   ./scripts/rollback.sh production
   ```

3. **Investigate and Fix**:
   - Analyze logs and metrics
   - Identify root cause
   - Implement fix
   - Test thoroughly
   - Deploy fix

4. **Post-Incident**:
   - Document the incident
   - Update monitoring and alerting
   - Implement preventive measures
   - Update runbooks and procedures

---

*This troubleshooting guide is regularly updated based on common issues and user feedback. Please contribute improvements and additional solutions.*