# Cloudflare AI Support Bot - Production Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the Cloudflare AI Support Bot to production. The system leverages Cloudflare's edge computing platform for optimal performance and scalability.

## Prerequisites

### 1. Cloudflare Account Setup
- Active Cloudflare account with Workers and Pages enabled
- Sufficient plan limits for:
  - Workers (Paid plan recommended for production)
  - Durable Objects
  - KV Storage
  - R2 Storage
  - Workers AI
  - Workflows

### 2. Local Development Environment
- Node.js 18+ installed
- npm or yarn package manager
- Git for version control

### 3. Required API Keys
- OpenAI API key (for fallback model)
- Knowledge Base API key (if using external KB)
- Ticketing System API key (if using external ticketing)

## Pre-Deployment Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Authenticate with Cloudflare
```bash
npx wrangler login
```

### 3. Create Required Resources

#### KV Namespaces
```bash
# Production KV namespace
npx wrangler kv:namespace create "CHAT_KV" --env production

# Preview KV namespace (for testing)
npx wrangler kv:namespace create "CHAT_KV" --preview --env production
```

#### R2 Buckets
```bash
# Production R2 bucket
npx wrangler r2 bucket create cf-ai-supportbot-prod-archives

# Staging R2 bucket (optional)
npx wrangler r2 bucket create cf-ai-supportbot-staging-archives
```

### 4. Update Configuration

Update `wrangler.toml` with the actual namespace IDs and bucket names:

```toml
# Production Environment
[env.production]
name = "cf-ai-supportbot"

[[env.production.kv_namespaces]]
binding = "CHAT_KV"
id = "YOUR_PRODUCTION_KV_NAMESPACE_ID"
preview_id = "YOUR_PRODUCTION_PREVIEW_KV_NAMESPACE_ID"

[[env.production.r2_buckets]]
binding = "ARCHIVE_R2"
bucket_name = "cf-ai-supportbot-prod-archives"
```

### 5. Set Production Secrets
```bash
# OpenAI API Key (fallback model)
npx wrangler secret put OPENAI_API_KEY --env production

# Knowledge Base API Key
npx wrangler secret put KNOWLEDGE_BASE_API_KEY --env production

# Ticketing System API Key
npx wrangler secret put TICKETING_API_KEY --env production
```

## Deployment Process

### Option 1: Automated Deployment (Recommended)

Use the provided deployment script:

```bash
# Deploy to production
./deploy.sh production

# Deploy with specific options
./deploy.sh production --skip-tests  # Skip tests (not recommended)
./deploy.sh production --verify-only # Only verify existing deployment
```

### Option 2: Manual Deployment

#### Step 1: Build the Project
```bash
npm run build
npm run build:frontend
```

#### Step 2: Deploy Worker
```bash
npx wrangler deploy --env production
```

#### Step 3: Deploy Pages
```bash
npx wrangler pages deploy pages/dist --project-name cf-ai-supportbot-frontend
```

## Post-Deployment Verification

### 1. Automated Verification
```bash
# Run comprehensive verification
./scripts/verify-deployment.sh production --detailed

# Monitor deployment for 15 minutes
./scripts/monitor-deployment.sh production 15
```

### 2. Manual Verification

#### Health Check
```bash
curl https://cf-ai-supportbot.your-subdomain.workers.dev/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "environment": "production"
}
```

#### API Status Check
```bash
curl https://cf-ai-supportbot.your-subdomain.workers.dev/api/status
```

#### Frontend Check
Visit: `https://cf-ai-supportbot-frontend.pages.dev`

### 3. Functional Testing

#### Create Session
```bash
curl -X POST https://cf-ai-supportbot.your-subdomain.workers.dev/api/session \
  -H "Content-Type: application/json" \
  -d '{"action": "create"}'
```

#### Send Test Message
```bash
curl -X POST https://cf-ai-supportbot.your-subdomain.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello, I need help with my account",
    "sessionId": "YOUR_SESSION_ID"
  }'
```

## Production Configuration

### Environment Variables
- `ENVIRONMENT`: "production"
- `MAX_TOKENS`: 4096
- `RATE_LIMIT_PER_MINUTE`: 100
- `SESSION_TTL_HOURS`: 24
- `LOG_LEVEL`: "warn"

### Security Settings
- Rate limiting: 100 requests/minute per session
- PII detection and filtering enabled
- Content filtering enabled
- CORS configured for production domains

### Performance Optimization
- Edge caching enabled
- Durable Object hibernation configured
- Memory optimization active
- Response compression enabled

## Monitoring and Alerting

### Built-in Monitoring
The system includes comprehensive monitoring:
- Request/response metrics
- Error rate tracking
- Latency monitoring
- Memory usage tracking
- AI model performance

### Cloudflare Analytics
Monitor through Cloudflare Dashboard:
- Workers Analytics
- Pages Analytics
- R2 Analytics
- KV Analytics

### Custom Alerts
Set up alerts for:
- Error rate > 5%
- P95 latency > 2000ms
- Memory usage > 80%
- AI model failures

## Scaling Considerations

### Traffic Scaling
- Workers automatically scale to handle traffic
- Durable Objects provide consistent state management
- KV and R2 scale automatically

### Cost Optimization
- Monitor usage through Cloudflare Dashboard
- Implement caching strategies
- Optimize Durable Object usage
- Use appropriate storage tiers

## Troubleshooting

### Common Issues

#### 1. Deployment Failures
```bash
# Check wrangler configuration
npx wrangler whoami

# Verify resource limits
npx wrangler deployments list --name cf-ai-supportbot
```

#### 2. Runtime Errors
```bash
# Check logs
npx wrangler tail --env production

# Monitor specific errors
npx wrangler tail --env production --format json | grep ERROR
```

#### 3. Performance Issues
```bash
# Run performance validation
npm run test:performance

# Check monitoring data
./scripts/monitor-deployment.sh production 5
```

### Rollback Procedure
```bash
# Automatic rollback
./deploy.sh production --rollback

# Manual rollback
npx wrangler rollback --env production
```

## Maintenance

### Regular Tasks
- Monitor error rates and performance metrics
- Update dependencies monthly
- Review and rotate API keys quarterly
- Clean up old conversation archives

### Updates
```bash
# Deploy updates
git pull origin main
./deploy.sh production

# Verify update
./scripts/verify-deployment.sh production --detailed
```

## Support and Documentation

### Additional Resources
- [API Documentation](./API_DOCUMENTATION.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
- [Performance Optimization](./PERFORMANCE_OPTIMIZATION_SUMMARY.md)
- [Monitoring Guide](./MONITORING.md)

### Getting Help
1. Check the troubleshooting guide
2. Review Cloudflare Workers documentation
3. Check system logs and monitoring data
4. Contact support with deployment details

## Security Best Practices

### Production Security Checklist
- [ ] All secrets properly configured
- [ ] Rate limiting enabled
- [ ] PII filtering active
- [ ] Content filtering enabled
- [ ] HTTPS enforced
- [ ] CORS properly configured
- [ ] Input validation active
- [ ] Error messages sanitized
- [ ] Logging configured (no sensitive data)
- [ ] Access controls in place

### Regular Security Tasks
- Rotate API keys quarterly
- Review access logs monthly
- Update dependencies for security patches
- Monitor for unusual traffic patterns
- Audit configuration changes

## Performance Benchmarks

### Expected Performance (Production)
- Health endpoint: < 100ms P95
- Chat API: < 2000ms P95
- WebSocket connection: < 500ms
- Memory usage: < 128MB per session
- Error rate: < 1%

### Load Testing
```bash
# Run load tests
npm run test:load

# Custom load test
k6 run tests/load/k6-runner.js --vus 50 --duration 5m
```

This deployment guide ensures a smooth, secure, and scalable production deployment of the Cloudflare AI Support Bot.