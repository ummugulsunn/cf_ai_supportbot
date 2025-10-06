#!/bin/bash

# Test Suite Validation Script
# Validates that all required test components are in place

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

# Validation results
VALIDATION_PASSED=0
VALIDATION_FAILED=0
VALIDATION_WARNINGS=0

# Function to check file exists
check_file() {
    local file="$1"
    local description="$2"
    
    if [ -f "$PROJECT_ROOT/$file" ]; then
        success "$description exists: $file"
        VALIDATION_PASSED=$((VALIDATION_PASSED + 1))
        return 0
    else
        error "$description missing: $file"
        VALIDATION_FAILED=$((VALIDATION_FAILED + 1))
        return 1
    fi
}

# Function to check directory exists
check_directory() {
    local dir="$1"
    local description="$2"
    
    if [ -d "$PROJECT_ROOT/$dir" ]; then
        success "$description exists: $dir"
        VALIDATION_PASSED=$((VALIDATION_PASSED + 1))
        return 0
    else
        error "$description missing: $dir"
        VALIDATION_FAILED=$((VALIDATION_FAILED + 1))
        return 1
    fi
}

# Function to check test file has minimum test count
check_test_count() {
    local file="$1"
    local min_tests="$2"
    local description="$3"
    
    if [ -f "$PROJECT_ROOT/$file" ]; then
        local test_count=$(grep -c "it\|test" "$PROJECT_ROOT/$file" || echo "0")
        if [ "$test_count" -ge "$min_tests" ]; then
            success "$description has $test_count tests (minimum: $min_tests)"
            VALIDATION_PASSED=$((VALIDATION_PASSED + 1))
            return 0
        else
            warning "$description has only $test_count tests (minimum: $min_tests)"
            VALIDATION_WARNINGS=$((VALIDATION_WARNINGS + 1))
            return 1
        fi
    else
        error "$description file missing: $file"
        VALIDATION_FAILED=$((VALIDATION_FAILED + 1))
        return 1
    fi
}

# Main validation function
main() {
    log "🔍 Validating Comprehensive Test Suite" "$BLUE"
    echo
    
    info "Checking test directory structure..."
    check_directory "tests" "Tests directory"
    check_directory "tests/integration" "Integration tests directory"
    check_directory "tests/performance" "Performance tests directory"
    check_directory "tests/load" "Load tests directory"
    check_directory "tests/chaos" "Chaos tests directory"
    
    echo
    info "Checking unit test files..."
    check_test_count "tests/api_ai_integration.test.ts" 15 "API AI integration tests"
    check_test_count "tests/do_memory.test.ts" 15 "Durable Object memory tests"
    check_test_count "tests/security.test.ts" 20 "Security tests"
    check_test_count "tests/tools.test.ts" 10 "Tool tests"
    check_test_count "tests/workflow.test.ts" 15 "Workflow tests"
    check_test_count "tests/data_persistence.test.ts" 15 "Data persistence tests"
    check_test_count "tests/logging.test.ts" 30 "Logging and monitoring tests"
    
    echo
    info "Checking integration test files..."
    check_test_count "tests/integration/conversation_flow.test.ts" 8 "End-to-end conversation flow tests"
    check_test_count "tests/message_processing_pipeline.test.ts" 4 "Message processing pipeline tests"
    check_test_count "tests/workflow_integration.test.ts" 10 "Workflow integration tests"
    
    echo
    info "Checking performance test files..."
    check_test_count "tests/performance/performance_validation.test.ts" 10 "Performance validation tests"
    
    echo
    info "Checking load test files..."
    check_file "tests/load/k6-runner.js" "K6 load test runner"
    
    echo
    info "Checking chaos test files..."
    check_test_count "tests/chaos/chaos_testing.test.ts" 15 "Chaos engineering tests"
    
    echo
    info "Checking test configuration files..."
    check_file "vitest.config.ts" "Vitest configuration"
    check_file "tests/setup.ts" "Test setup file"
    
    echo
    info "Checking test runner scripts..."
    check_file "scripts/run-comprehensive-tests.sh" "Comprehensive test runner"
    check_file "scripts/validate-test-suite.sh" "Test suite validator"
    
    echo
    info "Checking package.json test scripts..."
    if grep -q "test:comprehensive" "$PROJECT_ROOT/package.json"; then
        success "Comprehensive test script configured in package.json"
        VALIDATION_PASSED=$((VALIDATION_PASSED + 1))
    else
        error "Comprehensive test script missing in package.json"
        VALIDATION_FAILED=$((VALIDATION_FAILED + 1))
    fi
    
    if grep -q "test:chaos" "$PROJECT_ROOT/package.json"; then
        success "Chaos test script configured in package.json"
        VALIDATION_PASSED=$((VALIDATION_PASSED + 1))
    else
        error "Chaos test script missing in package.json"
        VALIDATION_FAILED=$((VALIDATION_FAILED + 1))
    fi
    
    echo
    log "📊 Validation Summary" "$BLUE"
    echo "Passed: $VALIDATION_PASSED"
    echo "Failed: $VALIDATION_FAILED"
    echo "Warnings: $VALIDATION_WARNINGS"
    
    if [ $VALIDATION_FAILED -eq 0 ]; then
        success "🎉 Test suite validation completed successfully!"
        
        if [ $VALIDATION_WARNINGS -gt 0 ]; then
            warning "Note: $VALIDATION_WARNINGS warnings found. Consider addressing them for optimal test coverage."
        fi
        
        echo
        info "Test Suite Components Summary:"
        info "✅ Unit Tests: Core component testing"
        info "✅ Integration Tests: End-to-end workflow testing"
        info "✅ Performance Tests: Latency and throughput benchmarks"
        info "✅ Load Tests: Concurrent user simulation"
        info "✅ Chaos Tests: Failure scenario simulation"
        info "✅ Test Configuration: Proper setup and configuration"
        info "✅ Test Runners: Automated execution scripts"
        
        echo
        info "Ready to run comprehensive tests with:"
        info "  npm run test:comprehensive"
        info "  ./scripts/run-comprehensive-tests.sh"
        
        exit 0
    else
        error "❌ Test suite validation failed!"
        error "Please address the missing components before proceeding."
        exit 1
    fi
}

# Handle help flag
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $0"
    echo ""
    echo "Validates that all required test suite components are in place:"
    echo "- Unit tests for all core components"
    echo "- Integration tests for end-to-end workflows"
    echo "- Performance tests and benchmarks"
    echo "- Load tests for concurrent scenarios"
    echo "- Chaos tests for failure simulation"
    echo "- Test configuration and runner scripts"
    echo ""
    echo "Exit codes:"
    echo "  0 - All validations passed"
    echo "  1 - One or more validations failed"
    exit 0
fi

# Run main function
main "$@"