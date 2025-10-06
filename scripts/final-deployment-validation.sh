#!/bin/bash

# Final Deployment Validation Script for CF AI Support Bot
# Usage: ./scripts/final-deployment-validation.sh [environment]

set -e

ENVIRONMENT="${1:-production}"
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
    
    info "Validating $ENVIRONMENT deployment:"
    info "  Worker: $WORKER_NAME ($WORKER_URL)"
    info "  Pages: $PAGES_PROJECT ($PAGES_URL)"
}

# Test complete user journey
test_user_journey() {
    info "Testing complete user journey..."
    
    local failed_tests=0
    
    # Step 1: Create session
    info "Step 1: Creating session..."
    SESSION_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/session" \
        -H "Content-Type: application/json" \
        -d '{"action": "create"}' \
        --max-time 10 || echo "")
    
    if echo "$SESSION_RESPONSE" | grep -q "sessionId\|id"; then
        SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.sessionId // .id // "test-session"' 2>/dev/null || echo "test-session")
        success "Session created: $SESSION_ID"
    else
        warning "Session creation failed"
        failed_tests=$((failed_tests + 1))
        SESSION_ID="test-session"
    fi
    
    # Step 2: Send initial message
    info "Step 2: Sending initial message..."
    CHAT_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"Hello, I need help with my account login\", \"sessionId\": \"$SESSION_ID\"}" \
        --max-time 30 || echo "")
    
    if echo "$CHAT_RESPONSE" | grep -q "response\|message"; then
        success "Initial chat message processed"
    else
        warning "Initial chat message failed"
        failed_tests=$((failed_tests + 1))
    fi
    
    # Step 3: Follow-up message
    info "Step 3: Sending follow-up message..."
    FOLLOWUP_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"I forgot my password\", \"sessionId\": \"$SESSION_ID\"}" \
        --max-time 30 || echo "")
    
    if echo "$FOLLOWUP_RESPONSE" | grep -q "response\|message"; then
        success "Follow-up message processed"
    else
        warning "Follow-up message failed"
        failed_tests=$((failed_tests + 1))
    fi
    
    # Step 4: Test tool usage (knowledge base search)
    info "Step 4: Testing knowledge base search..."
    KB_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"Search for password reset instructions\", \"sessionId\": \"$SESSION_ID\"}" \
        --max-time 30 || echo "")
    
    if echo "$KB_RESPONSE" | grep -q "response\|message"; then
        success "Knowledge base search processed"
    else
        warning "Knowledge base search failed"
        failed_tests=$((failed_tests + 1))
    fi
    
    return $failed_tests
}

# Test WebSocket functionality
test_websocket_functionality() {
    info "Testing WebSocket functionality..."
    
    if ! command -v node &> /dev/null; then
        warning "Node.js not available, skipping WebSocket test"
        return 0
    fi
    
    # Create temporary WebSocket test script
    WS_TEST_SCRIPT=$(mktemp)
    cat > "$WS_TEST_SCRIPT" << 'EOF'
const WebSocket = require('ws');

const wsUrl = process.argv[2];
const timeout = parseInt(process.argv[3]) || 15000;

console.log(`Testing WebSocket connection to: ${wsUrl}`);

const ws = new WebSocket(wsUrl);

const timer = setTimeout(() => {
    console.error('WebSocket test timeout');
    process.exit(1);
}, timeout);

let messagesSent = 0;
let messagesReceived = 0;

ws.on('open', () => {
    console.log('WebSocket connected successfully');
    
    // Send test message
    const testMessage = {
        type: 'chat',
        message: 'Hello WebSocket',
        sessionId: 'ws-test-session'
    };
    
    ws.send(JSON.stringify(testMessage));
    messagesSent++;
    
    // Send another message after a delay
    setTimeout(() => {
        const followupMessage = {
            type: 'chat',
            message: 'WebSocket follow-up test',
            sessionId: 'ws-test-session'
        };
        ws.send(JSON.stringify(followupMessage));
        messagesSent++;
    }, 2000);
});

ws.on('message', (data) => {
    try {
        const message = JSON.parse(data.toString());
        console.log('Received message:', message.type || 'unknown');
        messagesReceived++;
        
        // Close after receiving responses
        if (messagesReceived >= messagesSent) {
            setTimeout(() => {
                clearTimeout(timer);
                ws.close();
                console.log(`WebSocket test completed: ${messagesSent} sent, ${messagesReceived} received`);
                process.exit(0);
            }, 1000);
        }
    } catch (error) {
        console.error('Failed to parse message:', error.message);
    }
});

ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    clearTimeout(timer);
    process.exit(1);
});

ws.on('close', () => {
    clearTimeout(timer);
    if (messagesReceived >= messagesSent) {
        console.log('WebSocket test completed successfully');
        process.exit(0);
    } else {
        console.error('WebSocket closed unexpectedly');
        process.exit(1);
    }
});
EOF
    
    WS_URL="${WORKER_URL/https/wss}/ws"
    
    if node "$WS_TEST_SCRIPT" "$WS_URL" 15000 2>/dev/null; then
        success "WebSocket functionality test passed"
        rm -f "$WS_TEST_SCRIPT"
        return 0
    else
        warning "WebSocket functionality test failed"
        rm -f "$WS_TEST_SCRIPT"
        return 1
    fi
}

# Test performance under load
test_performance_load() {
    info "Testing performance under simulated load..."
    
    local failed_tests=0
    
    # Test concurrent requests
    info "Testing concurrent request handling..."
    
    # Create multiple background requests
    for i in {1..5}; do
        (
            curl -s -X POST "$WORKER_URL/api/chat" \
                -H "Content-Type: application/json" \
                -d "{\"message\": \"Load test message $i\", \"sessionId\": \"load-test-$i\"}" \
                --max-time 30 > /dev/null 2>&1
        ) &
    done
    
    # Wait for all background jobs to complete
    wait
    
    # Test response time under load
    info "Measuring response time under load..."
    START_TIME=$(date +%s%3N)
    
    LOAD_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d '{"message": "Performance test message", "sessionId": "perf-test"}' \
        --max-time 30 || echo "")
    
    END_TIME=$(date +%s%3N)
    RESPONSE_TIME=$((END_TIME - START_TIME))
    
    info "Response time under load: ${RESPONSE_TIME}ms"
    
    if [ "$RESPONSE_TIME" -lt 5000 ]; then
        success "Performance test passed (${RESPONSE_TIME}ms < 5000ms)"
    else
        warning "Performance test failed (${RESPONSE_TIME}ms >= 5000ms)"
        failed_tests=$((failed_tests + 1))
    fi
    
    return $failed_tests
}

# Test error handling
test_error_handling() {
    info "Testing error handling..."
    
    local failed_tests=0
    
    # Test invalid request
    info "Testing invalid request handling..."
    INVALID_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d '{"invalid": "request"}' \
        --max-time 10 || echo "")
    
    if echo "$INVALID_RESPONSE" | grep -q "error\|Error"; then
        success "Invalid request handled correctly"
    else
        warning "Invalid request not handled properly"
        failed_tests=$((failed_tests + 1))
    fi
    
    # Test rate limiting
    info "Testing rate limiting..."
    
    # Send multiple rapid requests
    for i in {1..15}; do
        curl -s -X POST "$WORKER_URL/api/chat" \
            -H "Content-Type: application/json" \
            -d "{\"message\": \"Rate limit test $i\", \"sessionId\": \"rate-test\"}" \
            --max-time 5 > /dev/null 2>&1 &
    done
    
    wait
    
    # Check if rate limiting is working (should get 429 response)
    RATE_LIMIT_RESPONSE=$(curl -s -w "%{http_code}" -X POST "$WORKER_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d '{"message": "Rate limit check", "sessionId": "rate-test"}' \
        --max-time 5 || echo "000")
    
    if echo "$RATE_LIMIT_RESPONSE" | grep -q "429"; then
        success "Rate limiting is working"
    else
        info "Rate limiting response: $RATE_LIMIT_RESPONSE"
        warning "Rate limiting may not be working as expected"
    fi
    
    return $failed_tests
}

# Generate comprehensive report
generate_comprehensive_report() {
    local total_issues=$1
    
    REPORT_FILE="$PROJECT_ROOT/final-deployment-validation-$(date +%Y%m%d-%H%M%S).json"
    
    cat > "$REPORT_FILE" << EOF
{
  "validation": {
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "environment": "$ENVIRONMENT",
    "worker_name": "$WORKER_NAME",
    "worker_url": "$WORKER_URL",
    "pages_url": "$PAGES_URL",
    "tests": {
      "user_journey": {
        "session_creation": "$([ $USER_JOURNEY_ISSUES -eq 0 ] && echo "passed" || echo "failed")",
        "chat_functionality": "$([ $USER_JOURNEY_ISSUES -eq 0 ] && echo "passed" || echo "failed")",
        "tool_integration": "$([ $USER_JOURNEY_ISSUES -eq 0 ] && echo "passed" || echo "failed")"
      },
      "websocket": {
        "connectivity": "$([ $WS_ISSUES -eq 0 ] && echo "passed" || echo "failed")",
        "message_handling": "$([ $WS_ISSUES -eq 0 ] && echo "passed" || echo "failed")"
      },
      "performance": {
        "concurrent_requests": "$([ $PERF_ISSUES -eq 0 ] && echo "passed" || echo "failed")",
        "response_time": "$([ $PERF_ISSUES -eq 0 ] && echo "passed" || echo "failed")"
      },
      "error_handling": {
        "invalid_requests": "$([ $ERROR_ISSUES -eq 0 ] && echo "passed" || echo "failed")",
        "rate_limiting": "$([ $ERROR_ISSUES -eq 0 ] && echo "passed" || echo "failed")"
      }
    },
    "summary": {
      "total_issues": $total_issues,
      "status": "$([ $total_issues -eq 0 ] && echo "passed" || echo "failed")",
      "deployment_ready": $([ $total_issues -eq 0 ] && echo "true" || echo "false")
    },
    "recommendations": [
      $([ $total_issues -gt 0 ] && echo '"Review failed tests and address issues before production use",' || echo '"Deployment validation successful - ready for production traffic",')
      "Monitor error rates and performance metrics closely",
      "Set up alerting for critical thresholds",
      "Conduct regular health checks"
    ]
  }
}
EOF
    
    info "Comprehensive validation report generated: $REPORT_FILE"
}

# Main validation flow
main() {
    log "🔍 Starting final deployment validation for $ENVIRONMENT environment..." "$BLUE"
    
    get_config
    
    local total_issues=0
    
    # Run comprehensive tests
    test_user_journey
    USER_JOURNEY_ISSUES=$?
    total_issues=$((total_issues + USER_JOURNEY_ISSUES))
    
    test_websocket_functionality
    WS_ISSUES=$?
    total_issues=$((total_issues + WS_ISSUES))
    
    test_performance_load
    PERF_ISSUES=$?
    total_issues=$((total_issues + PERF_ISSUES))
    
    test_error_handling
    ERROR_ISSUES=$?
    total_issues=$((total_issues + ERROR_ISSUES))
    
    # Generate comprehensive report
    generate_comprehensive_report $total_issues
    
    # Final summary
    if [ $total_issues -eq 0 ]; then
        success "🎉 Final deployment validation PASSED!"
        log "The deployment is ready for production use" "$GREEN"
        
        info "Next steps:"
        info "1. Monitor the deployment closely for the first 24 hours"
        info "2. Set up alerting based on production-monitoring-config.json"
        info "3. Review usage patterns and optimize as needed"
        info "4. Update documentation with any deployment-specific notes"
        
    else
        warning "⚠️  Final deployment validation completed with $total_issues issues"
        log "Please review and address the issues before production use" "$YELLOW"
        
        info "Recommended actions:"
        info "1. Review the validation report for specific issues"
        info "2. Address critical failures before proceeding"
        info "3. Consider rolling back if issues are severe"
        info "4. Re-run validation after fixes"
    fi
    
    info "Validation report: $(basename "$REPORT_FILE")"
    
    exit $total_issues
}

# Handle help flag
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $0 [environment]"
    echo ""
    echo "Comprehensive deployment validation including:"
    echo "- Complete user journey testing"
    echo "- WebSocket functionality validation"
    echo "- Performance testing under load"
    echo "- Error handling verification"
    echo ""
    echo "Arguments:"
    echo "  environment    Target environment (development|staging|production)"
    echo ""
    echo "Examples:"
    echo "  $0 production    # Validate production deployment"
    echo "  $0 staging       # Validate staging deployment"
    exit 0
fi

# Run main function
main "$@"