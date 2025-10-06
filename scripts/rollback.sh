#!/bin/bash

# Rollback Script for CF AI Support Bot
# Usage: ./scripts/rollback.sh [environment] [deployment-id]
# If deployment-id is not provided, rolls back to the previous deployment

set -e

ENVIRONMENT="${1:-production}"
DEPLOYMENT_ID="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/deployment-config.json"
LOG_FILE="$PROJECT_ROOT/rollback.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${2:-$NC}$(date '+%Y-%m-%d %H:%M:%S') - $1${NC}" | tee -a "$LOG_FILE"
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

# Validate environment
case $ENVIRONMENT in
    development|staging|production)
        ;;
    *)
        error_exit "Invalid environment: $ENVIRONMENT. Use development, staging, or production."
        ;;
esac

# Check prerequisites
check_prerequisites() {
    info "Checking prerequisites..."
    
    if ! command -v wrangler &> /dev/null; then
        error_exit "Wrangler CLI not found. Please install it first: npm install -g wrangler"
    fi
    
    if ! wrangler whoami &> /dev/null; then
        error_exit "Not logged in to Cloudflare. Please run: wrangler login"
    fi
    
    if ! command -v jq &> /dev/null; then
        error_exit "jq is required for JSON parsing. Please install it first."
    fi
    
    success "Prerequisites check passed"
}

# Get configuration
get_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        error_exit "Configuration file not found: $CONFIG_FILE"
    fi
    
    WORKER_NAME=$(jq -r ".environments.$ENVIRONMENT.worker.name" "$CONFIG_FILE")
    PAGES_PROJECT=$(jq -r ".environments.$ENVIRONMENT.pages.project" "$CONFIG_FILE")
    
    info "Configuration for $ENVIRONMENT:"
    info "  Worker: $WORKER_NAME"
    info "  Pages Project: $PAGES_PROJECT"
}

# Get deployment history
get_deployment_history() {
    info "Fetching deployment history..."
    
    # Get current deployment
    CURRENT_DEPLOYMENT=$(wrangler deployments list --name "$WORKER_NAME" --format json 2>/dev/null | head -1 || echo "")
    
    if [ -z "$CURRENT_DEPLOYMENT" ]; then
        error_exit "Could not fetch current deployment information"
    fi
    
    CURRENT_ID=$(echo "$CURRENT_DEPLOYMENT" | jq -r '.id // empty')
    CURRENT_VERSION=$(echo "$CURRENT_DEPLOYMENT" | jq -r '.version // empty')
    CURRENT_DATE=$(echo "$CURRENT_DEPLOYMENT" | jq -r '.created_on // empty')
    
    info "Current deployment:"
    info "  ID: $CURRENT_ID"
    info "  Version: $CURRENT_VERSION"
    info "  Date: $CURRENT_DATE"
    
    # Get previous deployments
    DEPLOYMENTS=$(wrangler deployments list --name "$WORKER_NAME" --format json 2>/dev/null || echo "[]")
    DEPLOYMENT_COUNT=$(echo "$DEPLOYMENTS" | jq 'length')
    
    if [ "$DEPLOYMENT_COUNT" -lt 2 ]; then
        error_exit "No previous deployment found for rollback"
    fi
    
    # If no specific deployment ID provided, use the previous one
    if [ -z "$DEPLOYMENT_ID" ]; then
        DEPLOYMENT_ID=$(echo "$DEPLOYMENTS" | jq -r '.[1].id // empty')
        TARGET_VERSION=$(echo "$DEPLOYMENTS" | jq -r '.[1].version // empty')
        TARGET_DATE=$(echo "$DEPLOYMENTS" | jq -r '.[1].created_on // empty')
    else
        # Validate provided deployment ID
        TARGET_DEPLOYMENT=$(echo "$DEPLOYMENTS" | jq -r ".[] | select(.id == \"$DEPLOYMENT_ID\")")
        
        if [ -z "$TARGET_DEPLOYMENT" ]; then
            error_exit "Deployment ID $DEPLOYMENT_ID not found in history"
        fi
        
        TARGET_VERSION=$(echo "$TARGET_DEPLOYMENT" | jq -r '.version // empty')
        TARGET_DATE=$(echo "$TARGET_DEPLOYMENT" | jq -r '.created_on // empty')
    fi
    
    info "Target rollback deployment:"
    info "  ID: $DEPLOYMENT_ID"
    info "  Version: $TARGET_VERSION"
    info "  Date: $TARGET_DATE"
}

# Confirm rollback
confirm_rollback() {
    warning "You are about to rollback $WORKER_NAME in $ENVIRONMENT environment"
    warning "From: $CURRENT_VERSION ($CURRENT_DATE)"
    warning "To:   $TARGET_VERSION ($TARGET_DATE)"
    
    echo -n "Are you sure you want to proceed? (yes/no): "
    read -r confirmation
    
    case $confirmation in
        yes|YES|y|Y)
            info "Proceeding with rollback..."
            ;;
        *)
            info "Rollback cancelled by user"
            exit 0
            ;;
    esac
}

# Perform rollback
perform_rollback() {
    info "Performing rollback..."
    
    # Rollback worker
    info "Rolling back worker to deployment $DEPLOYMENT_ID..."
    
    if [ "$ENVIRONMENT" = "production" ]; then
        wrangler rollback "$DEPLOYMENT_ID" --name "$WORKER_NAME" || error_exit "Worker rollback failed"
    else
        wrangler rollback "$DEPLOYMENT_ID" --name "$WORKER_NAME" --env "$ENVIRONMENT" || error_exit "Worker rollback failed"
    fi
    
    success "Worker rollback completed"
}

# Verify rollback
verify_rollback() {
    info "Verifying rollback..."
    
    # Wait for deployment to be active
    sleep 10
    
    # Check current deployment
    NEW_CURRENT=$(wrangler deployments list --name "$WORKER_NAME" --format json 2>/dev/null | head -1 || echo "")
    NEW_CURRENT_ID=$(echo "$NEW_CURRENT" | jq -r '.id // empty')
    
    if [ "$NEW_CURRENT_ID" = "$DEPLOYMENT_ID" ]; then
        success "Rollback verification passed - deployment ID matches"
    else
        warning "Rollback verification failed - deployment ID mismatch"
        info "Expected: $DEPLOYMENT_ID"
        info "Actual: $NEW_CURRENT_ID"
    fi
    
    # Test health endpoint
    case $ENVIRONMENT in
        production)
            WORKER_URL="https://$WORKER_NAME.your-subdomain.workers.dev"
            ;;
        staging)
            WORKER_URL="https://$WORKER_NAME.your-subdomain.workers.dev"
            ;;
        development)
            WORKER_URL="https://$WORKER_NAME.your-subdomain.workers.dev"
            ;;
    esac
    
    info "Testing health endpoint: $WORKER_URL/health"
    
    # Wait a bit more for the rollback to propagate
    sleep 20
    
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/health" || echo "000")
    
    if [ "$HTTP_STATUS" = "200" ]; then
        success "Health check passed after rollback"
    else
        warning "Health check failed after rollback (HTTP $HTTP_STATUS)"
        warning "The rollback may need more time to propagate"
    fi
}

# Create rollback report
create_rollback_report() {
    REPORT_FILE="$PROJECT_ROOT/rollback-report-$(date +%Y%m%d-%H%M%S).json"
    
    cat > "$REPORT_FILE" << EOF
{
  "rollback": {
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "environment": "$ENVIRONMENT",
    "worker_name": "$WORKER_NAME",
    "from_deployment": {
      "id": "$CURRENT_ID",
      "version": "$CURRENT_VERSION",
      "date": "$CURRENT_DATE"
    },
    "to_deployment": {
      "id": "$DEPLOYMENT_ID",
      "version": "$TARGET_VERSION",
      "date": "$TARGET_DATE"
    },
    "status": "completed",
    "verification": {
      "health_check_status": "$HTTP_STATUS",
      "deployment_id_match": $([ "$NEW_CURRENT_ID" = "$DEPLOYMENT_ID" ] && echo "true" || echo "false")
    }
  }
}
EOF
    
    info "Rollback report created: $REPORT_FILE"
}

# Show deployment history
show_deployment_history() {
    info "Recent deployment history for $WORKER_NAME:"
    
    echo "$DEPLOYMENTS" | jq -r '.[] | "\(.created_on) - \(.id) - \(.version // "unknown")"' | head -10
}

# Main rollback flow
main() {
    log "🔄 Starting rollback process for $ENVIRONMENT environment..." "$BLUE"
    
    check_prerequisites
    get_config
    get_deployment_history
    
    # Show deployment history if requested
    if [ "$1" = "--list" ]; then
        show_deployment_history
        exit 0
    fi
    
    confirm_rollback
    perform_rollback
    verify_rollback
    create_rollback_report
    
    success "🔄 Rollback completed successfully!"
    
    info "Summary:"
    info "  Environment: $ENVIRONMENT"
    info "  Worker: $WORKER_NAME"
    info "  Rolled back to: $TARGET_VERSION ($DEPLOYMENT_ID)"
    info "  Health check: HTTP $HTTP_STATUS"
    
    warning "Remember to:"
    warning "1. Update your local code to match the rolled-back version"
    warning "2. Investigate and fix the issues that caused the rollback"
    warning "3. Test thoroughly before the next deployment"
}

# Handle special flags
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [environment] [deployment-id] [options]"
        echo ""
        echo "Arguments:"
        echo "  environment    Target environment (development|staging|production)"
        echo "  deployment-id  Specific deployment ID to rollback to (optional)"
        echo ""
        echo "Options:"
        echo "  --list         Show deployment history and exit"
        echo "  --help, -h     Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0 production                    # Rollback to previous deployment"
        echo "  $0 staging abc123def456          # Rollback to specific deployment"
        echo "  $0 production --list             # Show deployment history"
        exit 0
        ;;
    --list)
        ENVIRONMENT="${2:-production}"
        get_config
        get_deployment_history
        show_deployment_history
        exit 0
        ;;
esac

# Run main function
main "$@"