# Deployment Guide

This document provides comprehensive instructions for deploying the Cloudflare AI Support Bot across different environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Deployment Process](#deployment-process)
- [Verification](#verification)
- [Monitoring](#monitoring)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Tools

1. **Node.js** (v18 or later)
   ```bash
   node --version
   ```

2. **Wrangler CLI** (latest version)
   ```bash
   npm install -g wrangler
   wrangler --version
   ```

3. **jq** (for JSON parsing)
   ```bash
   # macOS
   brew install jq
   
   # Ubuntu/Debian
   sudo apt-get install jq
   ```

4. **bc** (for calculations in scripts)
   ```bash
   # Usually pre-installed on most systems
   bc --version
   ```

### Cloudflare Account Setup

1. **Login to Cloudflare**
   ```bash
   wrangler login
   ```

2. **Verify Account Access**
   ```bash
   wrangler whoami
   ```

3. **Required Cloudflare Services**
   - Workers (with AI binding)
   - Durable Objects
   - KV Storage
   - R2 Storage
   - Workflows
   - Pages

## Environment Setup

### 1. Initialize Environment

Run the environment setup script for your target environment:

```bash
# Development environment
./scripts/setup-environment.sh development

# Staging environment
./scripts/setup-environment.sh staging

# Production environment
./scripts/setup-environment.sh production
```

This script will:
- Create KV namespaces
- Create R2 buckets
- Set up required secrets
- Generate environment configuration files

### 2. Configure Secrets

The following secrets need to be configured for each environment:

```bash
# Set secrets for production
wrangler secret put OPENAI_API_KEY --name cf-ai-supportbot
wrangler secret put KNOWLEDGE_BASE_API_KEY --name cf-ai-supportbot
wrangler secret put TICKETING_API_KEY --name cf-ai-supportbot

# Set secrets for staging
wrangler secret put OPENAI_API_KEY --name cf-ai-supportbot-staging
wrangler secret put KNOWLEDGE_BASE_API_KEY --name cf-ai-supportbot-staging
wrangler secret put TICKETING_API_KEY --name cf-ai-supportbot-staging
```

### 3. Update Configuration

Update `wrangler.toml` with the actual KV and R2 IDs generated during setup:

```toml
[[kv_namespaces]]
binding = "CHAT_KV"
id = "your-actual-kv-namespace-id"
preview_id = "your-actual-preview-kv-namespace-id"
```

## Deployment Process

### Automated Deployment

Use the main deployment script for automated deployment:

```bash
# Deploy to production (default)
./deploy.sh

# Deploy to specific environment
./deploy.sh staging
./deploy.sh development

# Deploy with options
./deploy.sh production --skip-tests    # Skip test execution
./deploy.sh staging --skip-build       # Skip build process
./deploy.sh production --verify-only   # Only verify existing deployment
```

### Manual Deployment Steps

If you prefer manual deployment:

1. **Install Dependencies**
   ```bash
   npm ci
   ```

2. **Run Tests**
   ```bash
   npm run test:run
   ```

3. **Build Project**
   ```bash
   npm run build
   npm run build:frontend
   ```

4. **Deploy Worker**
   ```bash
   # Production
   wrangler deploy --env production
   
   # Staging
   wrangler deploy --env staging
   ```

5. **Deploy Pages**
   ```bash
   wrangler pages deploy pages/dist --project-name cf-ai-supportbot-frontend
   ```

### CI/CD Deployment

The project includes GitHub Actions workflows for automated deployment:

- **Staging**: Automatically deploys when code is pushed to `develop` branch
- **Production**: Automatically deploys when code is pushed to `main` branch

Required GitHub Secrets:
- `CLOUDFLARE_API_TOKEN`
- `OPENAI_API_KEY`
- `KNOWLEDGE_BASE_API_KEY`
- `TICKETING_API_KEY`
- `SLACK_WEBHOOK` (optional, for notifications)

## Verification

### Basic Verification

Run basic deployment verification:

```bash
./scripts/verify-deployment.sh production
```

### Comprehensive Verification

Run detailed verification including performance and security tests:

```bash
./scripts/verify-deployment.sh production --detailed
```

### Manual Verification

Test key endpoints manually:

```bash
# Health check
curl https://cf-ai-supportbot.your-subdomain.workers.dev/health

# API status
curl https://cf-ai-supportbot.your-subdomain.workers.dev/api/status

# Chat API test
curl -X POST https://cf-ai-supportbot.your-subdomain.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "sessionId": "test-123"}'
```

## Monitoring

### Post-Deployment Monitoring

Monitor deployment stability after deployment:

```bash
# Monitor for 10 minutes (default)
./scripts/monitor-deployment.sh production

# Monitor for custom duration
./scripts/monitor-deployment.sh production 30  # 30 minutes
```

### Continuous Monitoring

Set up continuous monitoring using the monitoring script in a cron job:

```bash
# Add to crontab for hourly monitoring
0 * * * * /path/to/project/scripts/monitor-deployment.sh production 5
```

### Metrics and Alerts

The monitoring system tracks:
- Response times
- Error rates
- Availability
- Performance metrics

Alerts are triggered when:
- Error rate exceeds 5% (configurable)
- P95 latency exceeds 2000ms (configurable)
- Health checks fail

## Rollback Procedures

### Automatic Rollback

Rollback to the previous deployment:

```bash
./scripts/rollback.sh production
```

### Rollback to Specific Version

Rollback to a specific deployment ID:

```bash
# List deployment history
./scripts/rollback.sh production --list

# Rollback to specific deployment
./scripts/rollback.sh production abc123def456
```

### Emergency Rollback

In case of critical issues:

1. **Immediate Rollback**
   ```bash
   ./scripts/rollback.sh production
   ```

2. **Verify Rollback**
   ```bash
   ./scripts/verify-deployment.sh production
   ```

3. **Monitor Stability**
   ```bash
   ./scripts/monitor-deployment.sh production 15
   ```

## Troubleshooting

### Common Issues

#### 1. Deployment Fails with "Unauthorized"

**Solution**: Check Wrangler authentication
```bash
wrangler whoami
wrangler login  # If not logged in
```

#### 2. KV/R2 Resources Not Found

**Solution**: Run environment setup
```bash
./scripts/setup-environment.sh [environment]
```

#### 3. Secrets Not Set

**Solution**: Configure required secrets
```bash
wrangler secret put OPENAI_API_KEY --name [worker-name]
```

#### 4. Build Failures

**Solution**: Check dependencies and TypeScript
```bash
npm ci
npm run build
npx tsc --noEmit  # Check TypeScript errors
```

#### 5. High Error Rates After Deployment

**Solution**: Check logs and consider rollback
```bash
wrangler tail cf-ai-supportbot  # View real-time logs
./scripts/rollback.sh production  # If issues persist
```

### Debugging Commands

```bash
# View deployment logs
wrangler tail [worker-name]

# List deployments
wrangler deployments list --name [worker-name]

# Check KV namespaces
wrangler kv:namespace list

# Check R2 buckets
wrangler r2 bucket list

# Test local development
wrangler dev
```

### Performance Issues

If experiencing performance issues:

1. **Check Response Times**
   ```bash
   ./scripts/verify-deployment.sh production --detailed
   ```

2. **Monitor Resource Usage**
   ```bash
   ./scripts/monitor-deployment.sh production 30
   ```

3. **Review Configuration**
   - Check `MAX_TOKENS` settings
   - Verify `RATE_LIMIT_PER_MINUTE` configuration
   - Review `SESSION_TTL_HOURS` settings

### Getting Help

1. **Check Logs**: Use `wrangler tail` for real-time logs
2. **Review Metrics**: Check monitoring reports in project directory
3. **Verify Configuration**: Ensure all environment variables are set correctly
4. **Test Locally**: Use `wrangler dev` for local testing

## Environment-Specific Notes

### Development
- Lower resource limits
- Debug logging enabled
- Shorter session TTL
- Preview KV/R2 resources

### Staging
- Production-like configuration
- Automated testing on deployment
- Integration with external services
- Performance monitoring

### Production
- Optimized performance settings
- Comprehensive monitoring
- Automated alerting
- Backup and recovery procedures

## Security Considerations

1. **Secrets Management**: Never commit secrets to version control
2. **Access Control**: Use appropriate Cloudflare API tokens with minimal permissions
3. **Environment Isolation**: Keep development, staging, and production environments separate
4. **Regular Updates**: Keep dependencies and Wrangler CLI updated
5. **Monitoring**: Monitor for security incidents and unusual patterns

## Maintenance

### Regular Tasks

1. **Weekly**: Review monitoring reports and performance metrics
2. **Monthly**: Update dependencies and security patches
3. **Quarterly**: Review and update deployment procedures
4. **As Needed**: Scale resources based on usage patterns

### Backup Procedures

1. **Configuration Backup**: Keep `wrangler.toml` and deployment configs in version control
2. **Data Backup**: R2 storage provides automatic durability
3. **Deployment History**: Wrangler maintains deployment history for rollbacks

This deployment guide should be updated as the system evolves and new requirements emerge.