#!/bin/bash

# Deployment Verification Script for CF AI Support Bot
# Usage: ./scripts/verify-deployment.sh [environment] [--detailed]

set -e

ENVIRONMENT="${1:-production}"
DETAILED="${2:-}"
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

# Get configuration
get_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        error_exit "Configuration file not found: $CONFIG_FILE"
    fi
    
    if ! command -v jq &> /dev/null; then
        error_exit "jq is required for JSON parsing"
    fi
    
    WORKER_NAME=$(jq -r ".environments.$ENVIRONMENT.worker.name" "$CONFIG_FILE")
    PAGES_PROJECT=$(jq -r ".environments.$ENVIRONMENT.pages.project" "$CONFIG_FILE")
    
    # Determine URLs based on environment
    case $ENVIRONMENT in
        production)
            WORKER_URL="https://$WORKER_NAME.your-subdomain.workers.dev"
            PAGES_URL="https://$PAGES_PROJECT.pages.dev"
            ;;
        staging)
            WORKER_URL="https://$WORKER_NAME.your-subdomain.workers.dev"
            PAGES_URL="https://$PAGES_PROJECT.pages.dev"
            ;;
        development)
            WORKER_URL="https://$WORKER_NAME.your-subdomain.workers.dev"
            PAGES_URL="https://$PAGES_PROJECT.pages.dev"
            ;;
    esac
    
    info "Verifying $ENVIRONMENT deployment:"
    info "  Worker: $WORKER_NAME ($WORKER_URL)"
    info "  Pages: $PAGES_PROJECT ($PAGES_URL)"
}

# Check deployment status
check_deployment_status() {
    info "Checking deployment status..."
    
    # Check if wrangler is available
    if ! command -v wrangler &> /dev/null; then
        warning "Wrangler CLI not available, skipping deployment status check"
        return
    fi
    
    # Get current deployment info
    DEPLOYMENT_INFO=$(wrangler deployments list --name "$WORKER_NAME" --format json 2>/dev/null | head -1 || echo "")
    
    if [ -n "$DEPLOYMENT_INFO" ]; then
        DEPLOYMENT_ID=$(echo "$DEPLOYMENT_INFO" | jq -r '.id // "unknown"')
        DEPLOYMENT_VERSION=$(echo "$DEPLOYMENT_INFO" | jq -r '.version // "unknown"')
        DEPLOYMENT_DATE=$(echo "$DEPLOYMENT_INFO" | jq -r '.created_on // "unknown"')
        
        success "Current deployment found:"
        info "  ID: $DEPLOYMENT_ID"
        info "  Version: $DEPLOYMENT_VERSION"
        info "  Date: $DEPLOYMENT_DATE"
    else
        warning "Could not fetch deployment information"
    fi
}

# Test core endpoints
test_core_endpoints() {
    info "Testing core endpoints..."
    
    local failed_tests=0
    
    # Test 1: Health endpoint
    info "Testing health endpoint..."
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$WORKER_URL/health" || echo "000")
    
    if [ "$HTTP_STATUS" = "200" ]; then
        success "Health endpoint: OK (HTTP $HTTP_STATUS)"
    else
        warning "Health endpoint: FAILED (HTTP $HTTP_STATUS)"
        failed_tests=$((failed_tests + 1))
    fi
    
    # Test 2: API status endpoint
    info "Testing API status endpoint..."
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$WORKER_URL/api/status" || echo "000")
    
    if [ "$HTTP_STATUS" = "200" ]; then
        success "API status endpoint: OK (HTTP $HTTP_STATUS)"
    else
        warning "API status endpoint: FAILED (HTTP $HTTP_STATUS)"
        failed_tests=$((failed_tests + 1))
    fi
    
    # Test 3: Pages frontend
    info "Testing Pages frontend..."
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$PAGES_URL" || echo "000")
    
    if [ "$HTTP_STATUS" = "200" ]; then
        success "Pages frontend: OK (HTTP $HTTP_STATUS)"
    else
        warning "Pages frontend: FAILED (HTTP $HTTP_STATUS)"
        failed_tests=$((failed_tests + 1))
    fi
    
    return $failed_tests
}

# Test WebSocket connectivity
test_websocket() {
    info "Testing WebSocket connectivity..."
    
    if ! command -v node &> /dev/null; then
        warning "Node.js not available, skipping WebSocket test"
        return 0
    fi
    
    # Create temporary WebSocket test script
    WS_TEST_SCRIPT=$(mktemp)
    cat > "$WS_TEST_SCRIPT" << 'EOF'
const WebSocket = require('ws');

const wsUrl = process.argv[2];
const timeout = parseInt(process.argv[3]) || 10000;

const ws = new WebSocket(wsUrl);

const timer = setTimeout(() => {
    console.error('WebSocket connection timeout');
    process.exit(1);
}, timeout);

ws.on('open', () => {
    console.log('WebSocket connection successful');
    clearTimeout(timer);
    ws.close();
    process.exit(0);
});

ws.on('error', (err) => {
    console.error('WebSocket connection failed:', err.message);
    clearTimeout(timer);
    process.exit(1);
});

ws.on('close', () => {
    clearTimeout(timer);
});
EOF
    
    WS_URL="${WORKER_URL/https/wss}/ws"
    
    if node "$WS_TEST_SCRIPT" "$WS_URL" 10000 2>/dev/null; then
        success "WebSocket connectivity: OK"
        rm -f "$WS_TEST_SCRIPT"
        return 0
    else
        warning "WebSocket connectivity: FAILED"
        rm -f "$WS_TEST_SCRIPT"
        return 1
    fi
}

# Test API functionality
test_api_functionality() {
    info "Testing API functionality..."
    
    local failed_tests=0
    
    # Test 1: Session creation
    info "Testing session creation..."
    SESSION_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/session" \
        -H "Content-Type: application/json" \
        -d '{"action": "create"}' \
        --max-time 10 || echo "")
    
    if echo "$SESSION_RESPONSE" | grep -q "sessionId\|id"; then
        success "Session creation: OK"
        
        # Extract session ID for further tests
        SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.sessionId // .id // "test-session"' 2>/dev/null || echo "test-session")
    else
        warning "Session creation: FAILED"
        failed_tests=$((failed_tests + 1))
        SESSION_ID="test-session"
    fi
    
    # Test 2: Chat API
    info "Testing chat API..."
    CHAT_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"Hello, this is a verification test\", \"sessionId\": \"$SESSION_ID\"}" \
        --max-time 30 || echo "")
    
    if echo "$CHAT_RESPONSE" | grep -q "response\|message\|error"; then
        success "Chat API: OK"
    else
        warning "Chat API: FAILED"
        failed_tests=$((failed_tests + 1))
    fi
    
    return $failed_tests
}

# Test performance metrics
test_performance() {
    info "Testing performance metrics..."
    
    # Test response times
    info "Measuring response times..."
    
    # Health endpoint response time
    HEALTH_TIME=$(curl -s -o /dev/null -w "%{time_total}" --max-time 10 "$WORKER_URL/health" || echo "0")
    info "Health endpoint response time: ${HEALTH_TIME}s"
    
    # API status response time
    STATUS_TIME=$(curl -s -o /dev/null -w "%{time_total}" --max-time 10 "$WORKER_URL/api/status" || echo "0")
    info "API status response time: ${STATUS_TIME}s"
    
    # Pages response time
    PAGES_TIME=$(curl -s -o /dev/null -w "%{time_total}" --max-time 10 "$PAGES_URL" || echo "0")
    info "Pages response time: ${PAGES_TIME}s"
    
    # Check if response times are acceptable (< 2 seconds)
    local performance_issues=0
    
    if [ "$(echo "$HEALTH_TIME > 2" | bc -l 2>/dev/null || echo "0")" = "1" ]; then
        warning "Health endpoint response time is high: ${HEALTH_TIME}s"
        performance_issues=$((performance_issues + 1))
    fi
    
    if [ "$(echo "$STATUS_TIME > 2" | bc -l 2>/dev/null || echo "0")" = "1" ]; then
        warning "API status response time is high: ${STATUS_TIME}s"
        performance_issues=$((performance_issues + 1))
    fi
    
    if [ "$(echo "$PAGES_TIME > 2" | bc -l 2>/dev/null || echo "0")" = "1" ]; then
        warning "Pages response time is high: ${PAGES_TIME}s"
        performance_issues=$((performance_issues + 1))
    fi
    
    if [ $performance_issues -eq 0 ]; then
        success "Performance metrics: OK"
    else
        warning "Performance metrics: $performance_issues issues detected"
    fi
    
    return $performance_issues
}

# Test security headers
test_security() {
    info "Testing security headers..."
    
    local security_issues=0
    
    # Get headers from main endpoint
    HEADERS=$(curl -s -I "$WORKER_URL/health" --max-time 10 || echo "")
    
    # Check for security headers
    if echo "$HEADERS" | grep -qi "x-frame-options"; then
        success "X-Frame-Options header: Present"
    else
        warning "X-Frame-Options header: Missing"
        security_issues=$((security_issues + 1))
    fi
    
    if echo "$HEADERS" | grep -qi "x-content-type-options"; then
        success "X-Content-Type-Options header: Present"
    else
        warning "X-Content-Type-Options header: Missing"
        security_issues=$((security_issues + 1))
    fi
    
    if echo "$HEADERS" | grep -qi "strict-transport-security"; then
        success "Strict-Transport-Security header: Present"
    else
        info "Strict-Transport-Security header: Not required for .workers.dev"
    fi
    
    return $security_issues
}

# Generate verification report
generate_report() {
    local total_issues=$1
    
    REPORT_FILE="$PROJECT_ROOT/verification-report-$(date +%Y%m%d-%H%M%S).json"
    
    cat > "$REPORT_FILE" << EOF
{
  "verification": {
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "environment": "$ENVIRONMENT",
    "worker_name": "$WORKER_NAME",
    "worker_url": "$WORKER_URL",
    "pages_url": "$PAGES_URL",
    "deployment": {
      "id": "${DEPLOYMENT_ID:-unknown}",
      "version": "${DEPLOYMENT_VERSION:-unknown}",
      "date": "${DEPLOYMENT_DATE:-unknown}"
    },
    "tests": {
      "endpoints": {
        "health": "$HEALTH_STATUS",
        "api_status": "$API_STATUS_STATUS",
        "pages": "$PAGES_STATUS"
      },
      "performance": {
        "health_response_time": "$HEALTH_TIME",
        "api_status_response_time": "$STATUS_TIME",
        "pages_response_time": "$PAGES_TIME"
      },
      "websocket": "$WS_STATUS",
      "api_functionality": "$API_FUNC_STATUS"
    },
    "summary": {
      "total_issues": $total_issues,
      "status": "$([ $total_issues -eq 0 ] && echo "passed" || echo "failed")"
    }
  }
}
EOF
    
    info "Verification report generated: $REPORT_FILE"
}

# Main verification flow
main() {
    log "🔍 Starting deployment verification for $ENVIRONMENT environment..." "$BLUE"
    
    get_config
    check_deployment_status
    
    local total_issues=0
    
    # Run core tests
    test_core_endpoints
    total_issues=$((total_issues + $?))
    
    test_websocket
    total_issues=$((total_issues + $?))
    
    # Run detailed tests if requested
    if [ "$DETAILED" = "--detailed" ]; then
        test_api_functionality
        total_issues=$((total_issues + $?))
        
        test_performance
        total_issues=$((total_issues + $?))
        
        test_security
        total_issues=$((total_issues + $?))
    fi
    
    # Generate report
    generate_report $total_issues
    
    # Summary
    if [ $total_issues -eq 0 ]; then
        success "🔍 All verification tests passed!"
        log "Deployment is healthy and ready for use" "$GREEN"
    else
        warning "🔍 Verification completed with $total_issues issues"
        log "Please review the issues and consider investigating" "$YELLOW"
    fi
    
    info "Summary:"
    info "  Environment: $ENVIRONMENT"
    info "  Worker: $WORKER_NAME"
    info "  Issues found: $total_issues"
    info "  Report: $(basename "$REPORT_FILE")"
    
    exit $total_issues
}

# Handle help flag
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $0 [environment] [--detailed]"
    echo ""
    echo "Arguments:"
    echo "  environment    Target environment (development|staging|production)"
    echo ""
    echo "Options:"
    echo "  --detailed     Run comprehensive tests including API functionality and performance"
    echo "  --help, -h     Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 production              # Basic verification"
    echo "  $0 staging --detailed      # Comprehensive verification"
    exit 0
fi

# Run main function
main "$@"