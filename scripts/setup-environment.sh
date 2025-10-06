#!/bin/bash

# Environment Setup Script for CF AI Support Bot
# Usage: ./scripts/setup-environment.sh [environment]

set -e

ENVIRONMENT="${1:-development}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/deployment-config.json"

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

info "Setting up $ENVIRONMENT environment..."

# Check if jq is installed for JSON parsing
if ! command -v jq &> /dev/null; then
    error_exit "jq is required for JSON parsing. Please install it first."
fi

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    error_exit "Wrangler CLI not found. Please install it first: npm install -g wrangler"
fi

# Parse configuration
if [ ! -f "$CONFIG_FILE" ]; then
    error_exit "Configuration file not found: $CONFIG_FILE"
fi

WORKER_NAME=$(jq -r ".environments.$ENVIRONMENT.worker.name" "$CONFIG_FILE")
KV_NAMESPACE=$(jq -r ".environments.$ENVIRONMENT.kv.namespace" "$CONFIG_FILE")
R2_BUCKET=$(jq -r ".environments.$ENVIRONMENT.r2.bucket" "$CONFIG_FILE")

info "Configuration for $ENVIRONMENT:"
info "  Worker: $WORKER_NAME"
info "  KV Namespace: $KV_NAMESPACE"
info "  R2 Bucket: $R2_BUCKET"

# Function to create KV namespace
create_kv_namespace() {
    info "Creating KV namespace: $KV_NAMESPACE"
    
    # Check if namespace already exists
    if wrangler kv:namespace list | grep -q "$KV_NAMESPACE"; then
        success "KV namespace $KV_NAMESPACE already exists"
    else
        wrangler kv:namespace create "$KV_NAMESPACE" || error_exit "Failed to create KV namespace"
        success "KV namespace $KV_NAMESPACE created"
    fi
}

# Function to create R2 bucket
create_r2_bucket() {
    info "Creating R2 bucket: $R2_BUCKET"
    
    # Check if bucket already exists
    if wrangler r2 bucket list | grep -q "$R2_BUCKET"; then
        success "R2 bucket $R2_BUCKET already exists"
    else
        wrangler r2 bucket create "$R2_BUCKET" || error_exit "Failed to create R2 bucket"
        success "R2 bucket $R2_BUCKET created"
    fi
}

# Function to setup secrets
setup_secrets() {
    info "Setting up secrets for $ENVIRONMENT..."
    
    SECRETS=$(jq -r '.secrets[]' "$CONFIG_FILE")
    
    for secret in $SECRETS; do
        info "Checking secret: $secret"
        
        # Check if secret exists
        if wrangler secret list --name "$WORKER_NAME" 2>/dev/null | grep -q "$secret"; then
            success "Secret $secret already exists"
        else
            echo "Please enter value for $secret (will be hidden):"
            read -s secret_value
            
            if [ -n "$secret_value" ]; then
                echo "$secret_value" | wrangler secret put "$secret" --name "$WORKER_NAME" || error_exit "Failed to set secret $secret"
                success "Secret $secret set successfully"
            else
                log "⚠️  Skipping empty secret: $secret" "$YELLOW"
            fi
        fi
    done
}

# Function to validate configuration
validate_configuration() {
    info "Validating configuration..."
    
    # Check worker deployment
    if wrangler deployments list --name "$WORKER_NAME" &>/dev/null; then
        success "Worker $WORKER_NAME is accessible"
    else
        log "⚠️  Worker $WORKER_NAME not found or not deployed" "$YELLOW"
    fi
    
    # Validate KV namespace
    if wrangler kv:namespace list | grep -q "$KV_NAMESPACE"; then
        success "KV namespace $KV_NAMESPACE is accessible"
    else
        log "⚠️  KV namespace $KV_NAMESPACE not found" "$YELLOW"
    fi
    
    # Validate R2 bucket
    if wrangler r2 bucket list | grep -q "$R2_BUCKET"; then
        success "R2 bucket $R2_BUCKET is accessible"
    else
        log "⚠️  R2 bucket $R2_BUCKET not found" "$YELLOW"
    fi
}

# Function to generate environment file
generate_env_file() {
    info "Generating environment file..."
    
    ENV_FILE="$PROJECT_ROOT/.env.$ENVIRONMENT"
    
    cat > "$ENV_FILE" << EOF
# Environment configuration for $ENVIRONMENT
ENVIRONMENT=$ENVIRONMENT
WORKER_NAME=$WORKER_NAME
KV_NAMESPACE=$KV_NAMESPACE
R2_BUCKET=$R2_BUCKET

# Generated on $(date)
EOF
    
    success "Environment file created: $ENV_FILE"
}

# Main setup flow
main() {
    create_kv_namespace
    create_r2_bucket
    setup_secrets
    generate_env_file
    validate_configuration
    
    success "Environment setup for $ENVIRONMENT completed!"
    
    info "Next steps:"
    info "1. Update wrangler.toml with the actual KV and R2 IDs"
    info "2. Deploy using: ./deploy.sh $ENVIRONMENT"
    info "3. Test the deployment using: ./scripts/test-deployment.sh $ENVIRONMENT"
}

# Run main function
main