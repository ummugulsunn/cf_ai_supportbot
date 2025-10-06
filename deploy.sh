#!/bin/bash

# Cloudflare AI Support Bot Deployment Script
# Usage: ./deploy.sh [environment] [options]
# Environment: production, staging, development (default: production)
# Options: --skip-tests, --skip-build, --rollback, --verify-only

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/deployment.log"
ENVIRONMENT="${1:-production}"
WORKER_NAME="cf-ai-supportbot"
PAGES_PROJECT="cf-ai-supportbot-frontend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${2:-$NC}$(date '+%Y-%m-%d %H:%M:%S') - $1${NC}" | tee -a "$LOG_FILE"
}

# Error handling
error_exit() {
    log "❌ ERROR: $1" "$RED"
    exit 1
}

# Success message
success() {
    log "✅ $1" "$GREEN"
}

# Warning message
warning() {
    log "⚠️  $1" "$YELLOW"
}

# Info message
info() {
    log "ℹ️  $1" "$BLUE"
}

# Parse command line arguments
SKIP_TESTS=false
SKIP_BUILD=false
ROLLBACK=false
VERIFY_ONLY=false

for arg in "$@"; do
    case $arg in
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --rollback)
            ROLLBACK=true
            shift
            ;;
        --verify-only)
            VERIFY_ONLY=true
            shift
            ;;
        production|staging|development)
            ENVIRONMENT="$arg"
            shift
            ;;
    esac
done

# Set environment-specific configuration
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
        error_exit "Invalid environment: $ENVIRONMENT. Use production, staging, or development."
        ;;
esac

log "🚀 Starting deployment of CF AI Support Bot to $ENVIRONMENT environment..." "$BLUE"

# Function to check prerequisites
check_prerequisites() {
    info "Checking prerequisites..."
    
    # Check if wrangler is installed
    if ! command -v wrangler &> /dev/null; then
        error_exit "Wrangler CLI not found. Please install it first: npm install -g wrangler"
    fi
    
    # Check if user is logged in
    if ! wrangler whoami &> /dev/null; then
        error_exit "Not logged in to Cloudflare. Please run: wrangler login"
    fi
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        error_exit "Node.js not found. Please install Node.js first."
    fi
    
    # Check if npm is installed
    if ! command -v npm &> /dev/null; then
        error_exit "npm not found. Please install npm first."
    fi
    
    success "Prerequisites check passed"
}

# Function to install dependencies
install_dependencies() {
    if [ "$SKIP_BUILD" = false ]; then
        info "Installing dependencies..."
        npm ci || error_exit "Failed to install dependencies"
        success "Dependencies installed"
    else
        warning "Skipping dependency installation"
    fi
}

# Function to run tests
run_tests() {
    if [ "$SKIP_TESTS" = false ]; then
        info "Running tests..."
        npm run test:run || error_exit "Tests failed"
        success "All tests passed"
    else
        warning "Skipping tests"
    fi
}

# Function to build project
build_project() {
    if [ "$SKIP_BUILD" = false ]; then
        info "Building TypeScript..."
        npm run build || error_exit "TypeScript build failed"
        
        info "Building frontend..."
        npm run build:frontend || error_exit "Frontend build failed"
        
        success "Build completed"
    else
        warning "Skipping build"
    fi
}

# Function to deploy worker
deploy_worker() {
    info "Deploying Worker to $ENVIRONMENT..."
    
    if [ "$ENVIRONMENT" = "production" ]; then
        wrangler deploy --env production || error_exit "Worker deployment failed"
    else
        wrangler deploy --env "$ENVIRONMENT" || error_exit "Worker deployment failed"
    fi
    
    success "Worker deployed successfully"
}

# Function to deploy pages
deploy_pages() {
    if [ -d "pages/dist" ]; then
        info "Deploying Pages..."
        
        # Deploy to Pages
        wrangler pages deploy pages/dist --project-name "$PAGES_PROJECT" || error_exit "Pages deployment failed"
        
        success "Pages deployed successfully"
    else
        warning "Pages dist directory not found. Skipping Pages deployment."
    fi
}

# Function to verify deployment
verify_deployment() {
    info "Verifying deployment..."
    
    # Get worker URL
    WORKER_URL=$(wrangler deployments list --name "$WORKER_NAME" --format json 2>/dev/null | head -1 | grep -o '"url":"[^"]*"' | cut -d'"' -f4 || echo "")
    
    if [ -n "$WORKER_URL" ]; then
        info "Testing Worker endpoint: $WORKER_URL"
        
        # Test health endpoint
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/health" || echo "000")
        
        if [ "$HTTP_STATUS" = "200" ]; then
            success "Worker health check passed"
        else
            warning "Worker health check failed (HTTP $HTTP_STATUS)"
        fi
    else
        warning "Could not determine Worker URL"
    fi
    
    # Show deployment information
    info "Deployment Information:"
    wrangler deployments list --name "$WORKER_NAME" | head -5 || warning "Could not fetch deployment info"
}

# Function to rollback deployment
rollback_deployment() {
    info "Rolling back deployment..."
    
    # Get previous deployment
    PREVIOUS_DEPLOYMENT=$(wrangler deployments list --name "$WORKER_NAME" --format json 2>/dev/null | sed -n '2p' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    
    if [ -n "$PREVIOUS_DEPLOYMENT" ]; then
        wrangler rollback "$PREVIOUS_DEPLOYMENT" || error_exit "Rollback failed"
        success "Rollback completed"
    else
        error_exit "No previous deployment found for rollback"
    fi
}

# Function to setup secrets (if needed)
setup_secrets() {
    info "Checking secrets configuration..."
    
    # List of required secrets
    REQUIRED_SECRETS=("OPENAI_API_KEY" "KNOWLEDGE_BASE_API_KEY" "TICKETING_API_KEY")
    
    for secret in "${REQUIRED_SECRETS[@]}"; do
        if ! wrangler secret list --name "$WORKER_NAME" 2>/dev/null | grep -q "$secret"; then
            warning "Secret $secret not found. Please set it using: wrangler secret put $secret --name $WORKER_NAME"
        fi
    done
}

# Main deployment flow
main() {
    # Handle rollback
    if [ "$ROLLBACK" = true ]; then
        rollback_deployment
        exit 0
    fi
    
    # Handle verify-only
    if [ "$VERIFY_ONLY" = true ]; then
        verify_deployment
        exit 0
    fi
    
    # Normal deployment flow
    check_prerequisites
    install_dependencies
    run_tests
    build_project
    setup_secrets
    deploy_worker
    deploy_pages
    verify_deployment
    
    success "🌐 CF AI Support Bot deployment to $ENVIRONMENT completed successfully!"
    
    # Run post-deployment monitoring
    info "Starting post-deployment monitoring..."
    if ./scripts/monitor-deployment.sh "$ENVIRONMENT" 5; then
        success "Post-deployment monitoring passed"
    else
        warning "Post-deployment monitoring detected issues"
        warning "Consider running: ./deploy.sh $ENVIRONMENT --rollback"
    fi
    
    # Run final comprehensive validation
    info "Running final deployment validation..."
    if ./scripts/final-deployment-validation.sh "$ENVIRONMENT"; then
        success "Final deployment validation passed"
    else
        warning "Final deployment validation detected issues"
        warning "Review the validation report and consider addressing issues"
    fi
    
    # Show final URLs and next steps
    info "Access your deployment:"
    info "Worker: https://$WORKER_NAME.your-subdomain.workers.dev"
    info "Pages: https://$PAGES_PROJECT.pages.dev"
    
    info "Next steps:"
    info "1. Run comprehensive verification: ./scripts/verify-deployment.sh $ENVIRONMENT --detailed"
    info "2. Monitor deployment: ./scripts/monitor-deployment.sh $ENVIRONMENT [duration]"
    info "3. If issues occur, rollback: ./scripts/rollback.sh $ENVIRONMENT"
}

# Trap errors and cleanup
trap 'error_exit "Deployment failed at line $LINENO"' ERR

# Run main function
main "$@"