#!/bin/bash

# Deployment Pipeline Integration Test
# Usage: ./scripts/test-deployment-pipeline.sh [environment]
# This script tests the entire deployment pipeline end-to-end

set -e

ENVIRONMENT="${1:-development}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_LOG="$PROJECT_ROOT/pipeline-test-$(date +%Y%m%d-%H%M%S).log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${2:-$NC}$(date '+%Y-%m-%d %H:%M:%S') - $1${NC}" | tee -a "$TEST_LOG"
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

# Test phase tracking
PHASE_COUNT=0
FAILED_PHASES=()

start_phase() {
    PHASE_COUNT=$((PHASE_COUNT + 1))
    info "Phase $PHASE_COUNT: $1"
}

end_phase() {
    if [ $? -eq 0 ]; then
        success "Phase $PHASE_COUNT completed: $1"
    else
        warning "Phase $PHASE_COUNT failed: $1"
        FAILED_PHASES+=("$PHASE_COUNT: $1")
    fi
}

# Validate environment
case $ENVIRONMENT in
    development|staging|production)
        ;;
    *)
        error_exit "Invalid environment: $ENVIRONMENT. Use development, staging, or production."
        ;;
esac

log "🧪 Starting deployment pipeline integration test for $ENVIRONMENT environment..." "$BLUE"

# Phase 1: Prerequisites Check
start_phase "Prerequisites Check"
{
    info "Checking required tools..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        error_exit "Node.js not found"
    fi
    NODE_VERSION=$(node --version)
    info "Node.js version: $NODE_VERSION"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        error_exit "npm not found"
    fi
    NPM_VERSION=$(npm --version)
    info "npm version: $NPM_VERSION"
    
    # Check Wrangler
    if ! command -v wrangler &> /dev/null; then
        error_exit "Wrangler CLI not found"
    fi
    WRANGLER_VERSION=$(wrangler --version)
    info "Wrangler version: $WRANGLER_VERSION"
    
    # Check authentication
    if ! wrangler whoami &> /dev/null; then
        error_exit "Not authenticated with Cloudflare"
    fi
    CLOUDFLARE_USER=$(wrangler whoami 2>/dev/null | head -1 || echo "Unknown")
    info "Cloudflare user: $CLOUDFLARE_USER"
    
    # Check jq
    if ! command -v jq &> /dev/null; then
        error_exit "jq not found"
    fi
    
    success "All prerequisites satisfied"
}
end_phase "Prerequisites Check"

# Phase 2: Project Structure Validation
start_phase "Project Structure Validation"
{
    info "Validating project structure..."
    
    # Check required files
    REQUIRED_FILES=(
        "package.json"
        "wrangler.toml"
        "tsconfig.json"
        "deploy.sh"
        "deployment-config.json"
        "workers/api.ts"
        "workers/types.ts"
    )
    
    for file in "${REQUIRED_FILES[@]}"; do
        if [ ! -f "$PROJECT_ROOT/$file" ]; then
            error_exit "Required file missing: $file"
        fi
    done
    
    # Check required directories
    REQUIRED_DIRS=(
        "workers"
        "pages"
        "tests"
        "scripts"
    )
    
    for dir in "${REQUIRED_DIRS[@]}"; do
        if [ ! -d "$PROJECT_ROOT/$dir" ]; then
            error_exit "Required directory missing: $dir"
        fi
    done
    
    success "Project structure validation passed"
}
end_phase "Project Structure Validation"

# Phase 3: Dependency Installation
start_phase "Dependency Installation"
{
    info "Installing dependencies..."
    cd "$PROJECT_ROOT"
    
    if npm ci; then
        success "Dependencies installed successfully"
    else
        error_exit "Failed to install dependencies"
    fi
}
end_phase "Dependency Installation"

# Phase 4: TypeScript Build
start_phase "TypeScript Build"
{
    info "Building TypeScript..."
    cd "$PROJECT_ROOT"
    
    if npm run build; then
        success "TypeScript build successful"
    else
        error_exit "TypeScript build failed"
    fi
}
end_phase "TypeScript Build"

# Phase 5: Test Execution
start_phase "Test Execution"
{
    info "Running test suite..."
    cd "$PROJECT_ROOT"
    
    if npm run test:run; then
        success "All tests passed"
    else
        error_exit "Tests failed"
    fi
}
end_phase "Test Execution"

# Phase 6: Frontend Build
start_phase "Frontend Build"
{
    info "Building frontend..."
    cd "$PROJECT_ROOT"
    
    if npm run build:frontend; then
        success "Frontend build successful"
    else
        error_exit "Frontend build failed"
    fi
}
end_phase "Frontend Build"

# Phase 7: Environment Setup Validation
start_phase "Environment Setup Validation"
{
    info "Validating environment setup..."
    
    # Check if setup script exists and is executable
    if [ ! -x "$PROJECT_ROOT/scripts/setup-environment.sh" ]; then
        error_exit "Environment setup script not found or not executable"
    fi
    
    # For development environment, we can run the setup
    if [ "$ENVIRONMENT" = "development" ]; then
        info "Running environment setup for development..."
        if "$PROJECT_ROOT/scripts/setup-environment.sh" development; then
            success "Environment setup completed"
        else
            warning "Environment setup had issues (may be expected if already configured)"
        fi
    else
        info "Skipping environment setup for $ENVIRONMENT (manual verification required)"
    fi
}
end_phase "Environment Setup Validation"

# Phase 8: Deployment Script Validation
start_phase "Deployment Script Validation"
{
    info "Validating deployment scripts..."
    
    # Check if deploy script exists and is executable
    if [ ! -x "$PROJECT_ROOT/deploy.sh" ]; then
        error_exit "Deploy script not found or not executable"
    fi
    
    # Test deploy script help
    if "$PROJECT_ROOT/deploy.sh" --help &> /dev/null; then
        success "Deploy script help works"
    else
        warning "Deploy script help may have issues"
    fi
    
    # Check other scripts
    SCRIPTS=(
        "scripts/test-deployment.sh"
        "scripts/verify-deployment.sh"
        "scripts/rollback.sh"
        "scripts/monitor-deployment.sh"
    )
    
    for script in "${SCRIPTS[@]}"; do
        if [ ! -x "$PROJECT_ROOT/$script" ]; then
            error_exit "Script not found or not executable: $script"
        fi
    done
    
    success "All deployment scripts validated"
}
end_phase "Deployment Script Validation"

# Phase 9: Configuration Validation
start_phase "Configuration Validation"
{
    info "Validating configuration files..."
    
    # Validate wrangler.toml
    if wrangler validate; then
        success "wrangler.toml is valid"
    else
        error_exit "wrangler.toml validation failed"
    fi
    
    # Validate deployment-config.json
    if jq empty "$PROJECT_ROOT/deployment-config.json" 2>/dev/null; then
        success "deployment-config.json is valid JSON"
    else
        error_exit "deployment-config.json is invalid JSON"
    fi
    
    # Check environment configuration
    ENV_CONFIG=$(jq -r ".environments.$ENVIRONMENT" "$PROJECT_ROOT/deployment-config.json")
    if [ "$ENV_CONFIG" = "null" ]; then
        error_exit "Environment $ENVIRONMENT not found in deployment-config.json"
    fi
    
    success "Configuration validation passed"
}
end_phase "Configuration Validation"

# Phase 10: Dry Run Deployment (Development Only)
if [ "$ENVIRONMENT" = "development" ]; then
    start_phase "Dry Run Deployment"
    {
        info "Performing dry run deployment..."
        
        # Test deployment with verify-only flag
        if "$PROJECT_ROOT/deploy.sh" development --verify-only; then
            success "Dry run deployment successful"
        else
            warning "Dry run deployment had issues (may be expected if not previously deployed)"
        fi
    }
    end_phase "Dry Run Deployment"
fi

# Phase 11: Script Integration Tests
start_phase "Script Integration Tests"
{
    info "Testing script integrations..."
    
    # Test verification script help
    if "$PROJECT_ROOT/scripts/verify-deployment.sh" --help &> /dev/null; then
        success "Verification script help works"
    else
        warning "Verification script help may have issues"
    fi
    
    # Test rollback script help
    if "$PROJECT_ROOT/scripts/rollback.sh" --help &> /dev/null; then
        success "Rollback script help works"
    else
        warning "Rollback script help may have issues"
    fi
    
    # Test monitoring script help
    if "$PROJECT_ROOT/scripts/monitor-deployment.sh" --help &> /dev/null; then
        success "Monitoring script help works"
    else
        warning "Monitoring script help may have issues"
    fi
    
    success "Script integration tests completed"
}
end_phase "Script Integration Tests"

# Phase 12: Documentation Validation
start_phase "Documentation Validation"
{
    info "Validating documentation..."
    
    # Check required documentation files
    DOC_FILES=(
        "README.md"
        "DEPLOYMENT.md"
        "PROMPTS.md"
    )
    
    for doc in "${DOC_FILES[@]}"; do
        if [ ! -f "$PROJECT_ROOT/$doc" ]; then
            warning "Documentation file missing: $doc"
        else
            success "Documentation file found: $doc"
        fi
    done
}
end_phase "Documentation Validation"

# Generate final report
generate_final_report() {
    local total_phases=$PHASE_COUNT
    local failed_count=${#FAILED_PHASES[@]}
    local success_count=$((total_phases - failed_count))
    
    REPORT_FILE="$PROJECT_ROOT/pipeline-test-report-$(date +%Y%m%d-%H%M%S).json"
    
    cat > "$REPORT_FILE" << EOF
{
  "pipeline_test": {
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "environment": "$ENVIRONMENT",
    "summary": {
      "total_phases": $total_phases,
      "successful_phases": $success_count,
      "failed_phases": $failed_count,
      "success_rate": $(echo "scale=2; $success_count * 100 / $total_phases" | bc -l)
    },
    "failed_phases": [
$(printf '      "%s"' "${FAILED_PHASES[@]}" | sed 's/$/,/' | sed '$s/,$//')
    ],
    "log_file": "$(basename "$TEST_LOG")",
    "status": "$([ $failed_count -eq 0 ] && echo "passed" || echo "failed")"
  }
}
EOF
    
    info "Pipeline test report generated: $(basename "$REPORT_FILE")"
}

# Summary
log "📊 Pipeline Integration Test Summary" "$BLUE"
info "Environment: $ENVIRONMENT"
info "Total phases: $PHASE_COUNT"
info "Failed phases: ${#FAILED_PHASES[@]}"

if [ ${#FAILED_PHASES[@]} -eq 0 ]; then
    success "🎉 All pipeline tests passed! Deployment pipeline is ready."
    log "The deployment pipeline for $ENVIRONMENT environment is fully validated and ready for use." "$GREEN"
else
    warning "⚠️  Pipeline test completed with ${#FAILED_PHASES[@]} failed phases:"
    for phase in "${FAILED_PHASES[@]}"; do
        warning "  - $phase"
    done
    log "Please address the failed phases before proceeding with deployment." "$YELLOW"
fi

generate_final_report

info "Test log: $(basename "$TEST_LOG")"
info "Next steps:"
if [ ${#FAILED_PHASES[@]} -eq 0 ]; then
    info "1. Deploy using: ./deploy.sh $ENVIRONMENT"
    info "2. Verify deployment: ./scripts/verify-deployment.sh $ENVIRONMENT --detailed"
    info "3. Monitor deployment: ./scripts/monitor-deployment.sh $ENVIRONMENT"
else
    info "1. Review failed phases and fix issues"
    info "2. Re-run pipeline test: ./scripts/test-deployment-pipeline.sh $ENVIRONMENT"
    info "3. Once all tests pass, proceed with deployment"
fi

# Exit with appropriate code
exit ${#FAILED_PHASES[@]}