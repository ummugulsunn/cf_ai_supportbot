#!/bin/bash

# Production Environment Setup Script for CF AI Support Bot
# Usage: ./scripts/setup-production.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${2:-$NC}$(date '+%Y-%m-%d %H:%M:%S') - $1${NC}"
}

error_exit() {
    log "❌ ERROR: $1" "$RED"
    exit 1
}

success() {
    log "✅ $1" "$GREEN"
}

warning() {
    log "⚠️  $1" "$YELLOW"
}

info() {
    log "ℹ️  $1" "$BLUE"
}

# Check prerequisites
check_prerequisites() {
    info "Checking prerequisites..."
    
    # Check if wrangler is installed
    if ! command -v wrangler &> /dev/null && ! npx wrangler --version &> /dev/null; then
        error_exit "Wrangler CLI not found. Please install it first: npm install -g wrangler"
    fi
    
    # Check if user is logged in
    if ! npx wrangler whoami &> /dev/null; then
        error_exit "Not logged in to Cloudflare. Please run: npx wrangler login"
    fi
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        error_exit "Node.js not found. Please install Node.js first."
    fi
    
    success "Prerequisites check passed"
}

# Create KV namespaces
create_kv_namespaces() {
    info "Creating KV namespaces..."
    
    # Production KV namespace
    info "Creating production KV namespace..."
    PROD_KV_OUTPUT=$(npx wrangler kv:namespace create "CHAT_KV" --env production 2>&1 || echo "")
    
    if echo "$PROD_KV_OUTPUT" | grep -q "id"; then
        PROD_KV_ID=$(echo "$PROD_KV_OUTPUT" | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
        success "Production KV namespace created: $PROD_KV_ID"
    else
        warning "Production KV namespace may already exist or creation failed"
        info "Output: $PROD_KV_OUTPUT"
    fi
    
    # Production preview KV namespace
    info "Creating production preview KV namespace..."
    PROD_PREVIEW_KV_OUTPUT=$(npx wrangler kv:namespace create "CHAT_KV" --preview --env production 2>&1 || echo "")
    
    if echo "$PROD_PREVIEW_KV_OUTPUT" | grep -q "preview_id"; then
        PROD_PREVIEW_KV_ID=$(echo "$PROD_PREVIEW_KV_OUTPUT" | grep -o 'preview_id = "[^"]*"' | cut -d'"' -f2)
        success "Production preview KV namespace created: $PROD_PREVIEW_KV_ID"
    else
        warning "Production preview KV namespace may already exist or creation failed"
        info "Output: $PROD_PREVIEW_KV_OUTPUT"
    fi
    
    # Update wrangler.toml if IDs were captured
    if [ -n "$PROD_KV_ID" ] && [ -n "$PROD_PREVIEW_KV_ID" ]; then
        info "Updating wrangler.toml with KV namespace IDs..."
        
        # Create backup
        cp "$PROJECT_ROOT/wrangler.toml" "$PROJECT_ROOT/wrangler.toml.backup"
        
        # Update production KV namespace IDs
        sed -i.tmp "s/id = \"your-prod-kv-namespace-id\"/id = \"$PROD_KV_ID\"/" "$PROJECT_ROOT/wrangler.toml"
        sed -i.tmp "s/preview_id = \"your-prod-preview-kv-namespace-id\"/preview_id = \"$PROD_PREVIEW_KV_ID\"/" "$PROJECT_ROOT/wrangler.toml"
        
        # Clean up temp files
        rm -f "$PROJECT_ROOT/wrangler.toml.tmp"
        
        success "Updated wrangler.toml with KV namespace IDs"
    fi
}

# Create R2 buckets
create_r2_buckets() {
    info "Creating R2 buckets..."
    
    # Production R2 bucket
    info "Creating production R2 bucket..."
    if npx wrangler r2 bucket create cf-ai-supportbot-prod-archives 2>/dev/null; then
        success "Production R2 bucket created: cf-ai-supportbot-prod-archives"
    else
        warning "Production R2 bucket may already exist or creation failed"
    fi
    
    # Staging R2 bucket (optional)
    info "Creating staging R2 bucket..."
    if npx wrangler r2 bucket create cf-ai-supportbot-staging-archives 2>/dev/null; then
        success "Staging R2 bucket created: cf-ai-supportbot-staging-archives"
    else
        warning "Staging R2 bucket may already exist or creation failed"
    fi
}

# Setup secrets
setup_secrets() {
    info "Setting up production secrets..."
    
    # List of required secrets
    SECRETS=("OPENAI_API_KEY" "KNOWLEDGE_BASE_API_KEY" "TICKETING_API_KEY")
    
    for secret in "${SECRETS[@]}"; do
        info "Setting up secret: $secret"
        
        # Check if secret already exists
        if npx wrangler secret list --env production 2>/dev/null | grep -q "$secret"; then
            warning "Secret $secret already exists. Skipping..."
            continue
        fi
        
        # Prompt for secret value
        echo -n "Enter value for $secret (or press Enter to skip): "
        read -s secret_value
        echo
        
        if [ -n "$secret_value" ]; then
            echo "$secret_value" | npx wrangler secret put "$secret" --env production
            success "Secret $secret set successfully"
        else
            warning "Skipped setting $secret. You can set it later with: npx wrangler secret put $secret --env production"
        fi
    done
}

# Create Pages project
create_pages_project() {
    info "Setting up Pages project..."
    
    # Check if pages directory exists
    if [ ! -d "$PROJECT_ROOT/pages" ]; then
        error_exit "Pages directory not found. Please ensure the project structure is correct."
    fi
    
    # Build frontend if not already built
    if [ ! -d "$PROJECT_ROOT/pages/dist" ]; then
        info "Building frontend..."
        cd "$PROJECT_ROOT"
        npm run build:frontend || error_exit "Frontend build failed"
    fi
    
    info "Pages project setup complete. Deploy with: npx wrangler pages deploy pages/dist --project-name cf-ai-supportbot-frontend"
}

# Validate configuration
validate_configuration() {
    info "Validating configuration..."
    
    # Check wrangler.toml syntax
    if npx wrangler validate 2>/dev/null; then
        success "wrangler.toml configuration is valid"
    else
        warning "wrangler.toml configuration may have issues. Please review manually."
    fi
    
    # Check if all required bindings are configured
    REQUIRED_BINDINGS=("AI" "MEMORY_DO" "CHAT_KV" "ARCHIVE_R2" "WORKFLOWS")
    
    for binding in "${REQUIRED_BINDINGS[@]}"; do
        if grep -q "$binding" "$PROJECT_ROOT/wrangler.toml"; then
            success "Binding $binding is configured"
        else
            warning "Binding $binding may not be properly configured"
        fi
    done
}

# Generate deployment summary
generate_summary() {
    info "Generating deployment summary..."
    
    SUMMARY_FILE="$PROJECT_ROOT/production-setup-summary.md"
    
    cat > "$SUMMARY_FILE" << EOF
# Production Setup Summary

Generated on: $(date)

## Resources Created

### KV Namespaces
- Production KV: ${PROD_KV_ID:-"Please check Cloudflare dashboard"}
- Production Preview KV: ${PROD_PREVIEW_KV_ID:-"Please check Cloudflare dashboard"}

### R2 Buckets
- Production Archives: cf-ai-supportbot-prod-archives
- Staging Archives: cf-ai-supportbot-staging-archives

### Secrets Configuration
The following secrets need to be configured:
- OPENAI_API_KEY: $(npx wrangler secret list --env production 2>/dev/null | grep -q "OPENAI_API_KEY" && echo "✅ Configured" || echo "❌ Not configured")
- KNOWLEDGE_BASE_API_KEY: $(npx wrangler secret list --env production 2>/dev/null | grep -q "KNOWLEDGE_BASE_API_KEY" && echo "✅ Configured" || echo "❌ Not configured")
- TICKETING_API_KEY: $(npx wrangler secret list --env production 2>/dev/null | grep -q "TICKETING_API_KEY" && echo "✅ Configured" || echo "❌ Not configured")

## Next Steps

1. **Deploy Worker:**
   \`\`\`bash
   npx wrangler deploy --env production
   \`\`\`

2. **Deploy Pages:**
   \`\`\`bash
   npx wrangler pages deploy pages/dist --project-name cf-ai-supportbot-frontend
   \`\`\`

3. **Verify Deployment:**
   \`\`\`bash
   ./scripts/verify-deployment.sh production --detailed
   \`\`\`

4. **Monitor Deployment:**
   \`\`\`bash
   ./scripts/monitor-deployment.sh production 10
   \`\`\`

## Configuration Files Updated
- wrangler.toml (KV namespace IDs)
- Backup created: wrangler.toml.backup

## Manual Configuration Required
If any secrets were skipped, configure them manually:
\`\`\`bash
npx wrangler secret put OPENAI_API_KEY --env production
npx wrangler secret put KNOWLEDGE_BASE_API_KEY --env production
npx wrangler secret put TICKETING_API_KEY --env production
\`\`\`

## Troubleshooting
If you encounter issues:
1. Check the deployment guide: DEPLOYMENT_GUIDE.md
2. Verify Cloudflare account limits and permissions
3. Review wrangler.toml configuration
4. Check Cloudflare dashboard for resource status

EOF

    success "Setup summary generated: $SUMMARY_FILE"
}

# Main setup flow
main() {
    log "🚀 Starting production environment setup for CF AI Support Bot..." "$BLUE"
    
    check_prerequisites
    create_kv_namespaces
    create_r2_buckets
    setup_secrets
    create_pages_project
    validate_configuration
    generate_summary
    
    success "🌐 Production environment setup completed!"
    
    info "Next steps:"
    info "1. Review the setup summary: production-setup-summary.md"
    info "2. Deploy the worker: npx wrangler deploy --env production"
    info "3. Deploy the frontend: npx wrangler pages deploy pages/dist --project-name cf-ai-supportbot-frontend"
    info "4. Verify deployment: ./scripts/verify-deployment.sh production --detailed"
    
    warning "Important: Review all configuration before deploying to production!"
}

# Handle help flag
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $0"
    echo ""
    echo "This script sets up the production environment for CF AI Support Bot:"
    echo "- Creates KV namespaces"
    echo "- Creates R2 buckets"
    echo "- Configures secrets"
    echo "- Sets up Pages project"
    echo "- Validates configuration"
    echo ""
    echo "Prerequisites:"
    echo "- Cloudflare account with appropriate permissions"
    echo "- Wrangler CLI installed and authenticated"
    echo "- Node.js and npm installed"
    exit 0
fi

# Run main function
main "$@"