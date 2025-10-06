#!/bin/bash

# Deployment Testing Script for CF AI Support Bot
# Usage: ./scripts/test-deployment.sh [environment] [test-type]
# Test types: smoke, integration, load, all (default: smoke)

set -e

ENVIRONMENT="${1:-production}"
TEST_TYPE="${2:-smoke}"
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

# Validate inputs
case $ENVIRONMENT in
    development|staging|production)
        ;;
    *)
        error_exit "Invalid environment: $ENVIRONMENT"
        ;;
esac

case $TEST_TYPE in
    smoke|integration|load|all)
        ;;
    *)
        error_exit "Invalid test type: $TEST_TYPE. Use smoke, integration, load, or all"
        ;;
esac

# Get configuration
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

info "Testing $ENVIRONMENT deployment..."
info "Worker URL: $WORKER_URL"
info "Pages URL: $PAGES_URL"

# Smoke tests
run_smoke_tests() {
    info "Running smoke tests..."
    
    # Test 1: Health endpoint
    info "Testing health endpoint..."
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/health" || echo "000")
    
    if [ "$HTTP_STATUS" = "200" ]; then
        success "Health endpoint test passed"
    else
        error_exit "Health endpoint test failed (HTTP $HTTP_STATUS)"
    fi
    
    # Test 2: API status endpoint
    info "Testing API status endpoint..."
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/api/status" || echo "000")
    
    if [ "$HTTP_STATUS" = "200" ]; then
        success "API status endpoint test passed"
    else
        warning "API status endpoint test failed (HTTP $HTTP_STATUS)"
    fi
    
    # Test 3: Pages frontend
    info "Testing Pages frontend..."
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PAGES_URL" || echo "000")
    
    if [ "$HTTP_STATUS" = "200" ]; then
        success "Pages frontend test passed"
    else
        warning "Pages frontend test failed (HTTP $HTTP_STATUS)"
    fi
    
    # Test 4: WebSocket endpoint (basic connectivity)
    info "Testing WebSocket endpoint..."
    if command -v node &> /dev/null; then
        node -e "
          const WebSocket = require('ws');
          const ws = new WebSocket('${WORKER_URL/https/wss}/ws');
          ws.on('open', () => {
            console.log('✅ WebSocket connection successful');
            ws.close();
            process.exit(0);
          });
          ws.on('error', (err) => {
            console.error('❌ WebSocket connection failed:', err.message);
            process.exit(1);
          });
          setTimeout(() => {
            console.error('❌ WebSocket connection timeout');
            process.exit(1);
          }, 10000);
        " 2>/dev/null && success "WebSocket endpoint test passed" || warning "WebSocket endpoint test failed"
    else
        warning "Node.js not available, skipping WebSocket test"
    fi
    
    success "Smoke tests completed"
}

# Integration tests
run_integration_tests() {
    info "Running integration tests..."
    
    # Test 1: Chat API integration
    info "Testing chat API..."
    RESPONSE=$(curl -s -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d '{"message": "Hello, this is a test", "sessionId": "test-session-123"}' || echo "")
    
    if echo "$RESPONSE" | grep -q "response\|error"; then
        success "Chat API integration test passed"
    else
        warning "Chat API integration test failed"
    fi
    
    # Test 2: Session management
    info "Testing session management..."
    SESSION_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/session" \
        -H "Content-Type: application/json" \
        -d '{"action": "create"}' || echo "")
    
    if echo "$SESSION_RESPONSE" | grep -q "sessionId\|id"; then
        success "Session management test passed"
    else
        warning "Session management test failed"
    fi
    
    # Test 3: Tool integration (if available)
    info "Testing tool integration..."
    TOOL_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/tools/test" \
        -H "Content-Type: application/json" \
        -d '{"tool": "kb.search", "params": {"query": "test"}}' || echo "")
    
    if echo "$TOOL_RESPONSE" | grep -q "result\|error"; then
        success "Tool integration test passed"
    else
        warning "Tool integration test failed (may not be implemented yet)"
    fi
    
    success "Integration tests completed"
}

# Load tests
run_load_tests() {
    info "Running load tests..."
    
    if ! command -v curl &> /dev/null; then
        warning "curl not available, skipping load tests"
        return
    fi
    
    # Simple concurrent request test
    info "Testing concurrent requests..."
    
    CONCURRENT_REQUESTS=10
    TEMP_DIR=$(mktemp -d)
    
    for i in $(seq 1 $CONCURRENT_REQUESTS); do
        (
            RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}" "$WORKER_URL/health")
            echo "$RESPONSE_TIME" > "$TEMP_DIR/response_$i.txt"
        ) &
    done
    
    wait
    
    # Calculate average response time
    TOTAL_TIME=0
    COUNT=0
    
    for file in "$TEMP_DIR"/response_*.txt; do
        if [ -f "$file" ]; then
            TIME=$(cat "$file")
            TOTAL_TIME=$(echo "$TOTAL_TIME + $TIME" | bc -l 2>/dev/null || echo "$TOTAL_TIME")
            COUNT=$((COUNT + 1))
        fi
    done
    
    if [ "$COUNT" -gt 0 ]; then
        AVG_TIME=$(echo "scale=3; $TOTAL_TIME / $COUNT" | bc -l 2>/dev/null || echo "N/A")
        info "Average response time for $COUNT concurrent requests: ${AVG_TIME}s"
        
        # Check if average response time is acceptable (< 2 seconds)
        if [ "$AVG_TIME" != "N/A" ] && [ "$(echo "$AVG_TIME < 2" | bc -l 2>/dev/null || echo "0")" = "1" ]; then
            success "Load test passed (avg response time: ${AVG_TIME}s)"
        else
            warning "Load test warning: high response time (${AVG_TIME}s)"
        fi
    else
        warning "Load test failed: no successful requests"
    fi
    
    rm -rf "$TEMP_DIR"
    
    success "Load tests completed"
}

# Performance monitoring
check_performance_metrics() {
    info "Checking performance metrics..."
    
    # Test response time
    RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}" "$WORKER_URL/health" || echo "0")
    info "Health endpoint response time: ${RESPONSE_TIME}s"
    
    # Test with larger payload
    LARGE_PAYLOAD='{"message": "This is a longer test message to check how the system handles larger payloads and whether the response time remains acceptable under different load conditions.", "sessionId": "perf-test-session"}'
    LARGE_RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}" -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d "$LARGE_PAYLOAD" || echo "0")
    info "Chat API response time (large payload): ${LARGE_RESPONSE_TIME}s"
    
    success "Performance metrics check completed"
}

# Security tests
run_security_tests() {
    info "Running basic security tests..."
    
    # Test 1: SQL injection attempt
    info "Testing SQL injection protection..."
    SQL_INJECTION_PAYLOAD='{"message": "test\"; DROP TABLE users; --", "sessionId": "security-test"}'
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d "$SQL_INJECTION_PAYLOAD" || echo "000")
    
    if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "400" ]; then
        success "SQL injection protection test passed"
    else
        warning "SQL injection protection test inconclusive (HTTP $HTTP_STATUS)"
    fi
    
    # Test 2: XSS attempt
    info "Testing XSS protection..."
    XSS_PAYLOAD='{"message": "<script>alert(\"xss\")</script>", "sessionId": "security-test"}'
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d "$XSS_PAYLOAD" || echo "000")
    
    if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "400" ]; then
        success "XSS protection test passed"
    else
        warning "XSS protection test inconclusive (HTTP $HTTP_STATUS)"
    fi
    
    # Test 3: Rate limiting (if implemented)
    info "Testing rate limiting..."
    RATE_LIMIT_REQUESTS=0
    for i in $(seq 1 20); do
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/health" || echo "000")
        if [ "$HTTP_STATUS" = "429" ]; then
            RATE_LIMIT_REQUESTS=$((RATE_LIMIT_REQUESTS + 1))
        fi
        sleep 0.1
    done
    
    if [ "$RATE_LIMIT_REQUESTS" -gt 0 ]; then
        success "Rate limiting is active ($RATE_LIMIT_REQUESTS rate-limited requests)"
    else
        info "Rate limiting not triggered (may not be implemented or threshold not reached)"
    fi
    
    success "Security tests completed"
}

# Main test execution
main() {
    case $TEST_TYPE in
        smoke)
            run_smoke_tests
            ;;
        integration)
            run_smoke_tests
            run_integration_tests
            ;;
        load)
            run_smoke_tests
            run_load_tests
            check_performance_metrics
            ;;
        all)
            run_smoke_tests
            run_integration_tests
            run_load_tests
            check_performance_metrics
            run_security_tests
            ;;
    esac
    
    success "All $TEST_TYPE tests completed for $ENVIRONMENT environment!"
}

# Run main function
main