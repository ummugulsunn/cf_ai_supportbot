#!/bin/bash

# Quick Deployment Status Check for CF AI Support Bot
# Usage: ./scripts/deployment-status.sh [environment]

set -e

ENVIRONMENT="${1:-production}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${2:-$NC}$1${NC}"
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

error() {
    log "❌ $1" "$RED"
}

# Check deployment status
check_deployment_status() {
    info "Checking deployment status for $ENVIRONMENT environment..."
    echo
    
    # Check if wrangler is available
    if ! command -v wrangler &> /dev/null && ! npx wrangler --version &> /dev/null; then
        error "Wrangler CLI not available"
        return 1
    fi
    
    # Check authentication
    if ! npx wrangler whoami &> /dev/null; then
        error "Not authenticated with Cloudflare"
        return 1
    fi
    
    # Get worker name based on environment
    case $ENVIRONMENT in
        production)
            WORKER_NAME="cf-ai-supportbot"
            PAGES_PROJECT="cf-ai-supportbot-frontend"
            ;;
        staging)
            WORKER_NAME="cf-ai-supportbot-staging"
            PAGES_PROJECT="cf-ai-supportbot-frontend-staging"
            ;;
        development)
            WORKER_NAME="cf-ai-supportbot-dev"
            PAGES_PROJECT="cf-ai-supportbot-frontend-dev"
            ;;
        *)
            error "Invalid environment: $ENVIRONMENT"
            return 1
            ;;
    esac
    
    # Check worker deployment
    info "Worker Status ($WORKER_NAME):"
    if WORKER_INFO=$(npx wrangler deployments list --name "$WORKER_NAME" 2>/dev/null | head -2); then
        if echo "$WORKER_INFO" | grep -q "Deployment ID"; then
            success "Worker is deployed"
            echo "$WORKER_INFO" | tail -1 | awk '{print "  Latest deployment: " $1 " (" $3 " " $4 ")"}'
        else
            warning "Worker deployment not found"
        fi
    else
        error "Failed to check worker deployment"
    fi
    
    echo
    
    # Check Pages deployment
    info "Pages Status ($PAGES_PROJECT):"
    if PAGES_INFO=$(npx wrangler pages deployment list --project-name "$PAGES_PROJECT" 2>/dev/null | head -2); then
        if echo "$PAGES_INFO" | grep -q "ID"; then
            success "Pages is deployed"
            echo "$PAGES_INFO" | tail -1 | awk '{print "  Latest deployment: " $1 " (" $4 " " $5 ")"}'
        else
            warning "Pages deployment not found"
        fi
    else
        warning "Failed to check Pages deployment (may not exist yet)"
    fi
    
    echo
    
    # Check secrets
    info "Secrets Configuration:"
    REQUIRED_SECRETS=("OPENAI_API_KEY" "KNOWLEDGE_BASE_API_KEY" "TICKETING_API_KEY")
    
    for secret in "${REQUIRED_SECRETS[@]}"; do
        if npx wrangler secret list --name "$WORKER_NAME" 2>/dev/null | grep -q "$secret"; then
            success "$secret is configured"
        else
            warning "$secret is not configured"
        fi
    done
    
    echo
    
    # Quick health check
    info "Quick Health Check:"
    
    # Determine worker URL
    case $ENVIRONMENT in
        production)
            WORKER_URL="https://$WORKER_NAME.your-subdomain.workers.dev"
            ;;
        *)
            WORKER_URL="https://$WORKER_NAME.your-subdomain.workers.dev"
            ;;
    esac
    
    # Test health endpoint
    if HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$WORKER_URL/health" 2>/dev/null); then
        if [ "$HTTP_STATUS" = "200" ]; then
            success "Health endpoint responding (HTTP $HTTP_STATUS)"
        else
            warning "Health endpoint returned HTTP $HTTP_STATUS"
        fi
    else
        error "Health endpoint not accessible"
    fi
    
    # Test API status
    if HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$WORKER_URL/api/status" 2>/dev/null); then
        if [ "$HTTP_STATUS" = "200" ]; then
            success "API status endpoint responding (HTTP $HTTP_STATUS)"
        else
            warning "API status endpoint returned HTTP $HTTP_STATUS"
        fi
    else
        error "API status endpoint not accessible"
    fi
    
    echo
    
    # Show URLs
    info "Deployment URLs:"
    echo "  Worker: $WORKER_URL"
    echo "  Pages: https://$PAGES_PROJECT.pages.dev"
    echo "  WebSocket: ${WORKER_URL/https/wss}/ws"
    
    echo
    
    # Show available commands
    info "Available Commands:"
    echo "  Deploy: ./deploy.sh $ENVIRONMENT"
    echo "  Verify: ./scripts/verify-deployment.sh $ENVIRONMENT --detailed"
    echo "  Monitor: ./scripts/monitor-deployment.sh $ENVIRONMENT 10"
    echo "  Validate: ./scripts/final-deployment-validation.sh $ENVIRONMENT"
    echo "  Rollback: ./deploy.sh $ENVIRONMENT --rollback"
}

# Main function
main() {
    log "🔍 CF AI Support Bot - Deployment Status Check" "$BLUE"
    echo
    
    check_deployment_status
}

# Handle help flag
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $0 [environment]"
    echo ""
    echo "Quick deployment status check for CF AI Support Bot"
    echo ""
    echo "Arguments:"
    echo "  environment    Target environment (development|staging|production)"
    echo ""
    echo "Examples:"
    echo "  $0 production    # Check production deployment status"
    echo "  $0 staging       # Check staging deployment status"
    exit 0
fi

# Run main function
main "$@"