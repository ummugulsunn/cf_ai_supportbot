#!/bin/bash

# Comprehensive Test Runner for CF AI Support Bot
# Runs all test suites including unit, integration, performance, load, and chaos tests

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

# Test configuration
RUN_UNIT_TESTS=true
RUN_INTEGRATION_TESTS=true
RUN_PERFORMANCE_TESTS=true
RUN_LOAD_TESTS=true
RUN_CHAOS_TESTS=true
GENERATE_COVERAGE=false
PARALLEL_TESTS=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --unit-only)
            RUN_INTEGRATION_TESTS=false
            RUN_PERFORMANCE_TESTS=false
            RUN_LOAD_TESTS=false
            RUN_CHAOS_TESTS=false
            shift
            ;;
        --integration-only)
            RUN_UNIT_TESTS=false
            RUN_PERFORMANCE_TESTS=false
            RUN_LOAD_TESTS=false
            RUN_CHAOS_TESTS=false
            shift
            ;;
        --performance-only)
            RUN_UNIT_TESTS=false
            RUN_INTEGRATION_TESTS=false
            RUN_LOAD_TESTS=false
            RUN_CHAOS_TESTS=false
            shift
            ;;
        --load-only)
            RUN_UNIT_TESTS=false
            RUN_INTEGRATION_TESTS=false
            RUN_PERFORMANCE_TESTS=false
            RUN_CHAOS_TESTS=false
            shift
            ;;
        --chaos-only)
            RUN_UNIT_TESTS=false
            RUN_INTEGRATION_TESTS=false
            RUN_PERFORMANCE_TESTS=false
            RUN_LOAD_TESTS=false
            shift
            ;;
        --coverage)
            GENERATE_COVERAGE=true
            shift
            ;;
        --parallel)
            PARALLEL_TESTS=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --unit-only         Run only unit tests"
            echo "  --integration-only  Run only integration tests"
            echo "  --performance-only  Run only performance tests"
            echo "  --load-only         Run only load tests"
            echo "  --chaos-only        Run only chaos tests"
            echo "  --coverage          Generate test coverage report"
            echo "  --parallel          Run tests in parallel where possible"
            echo "  --help, -h          Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                  # Run all tests"
            echo "  $0 --unit-only     # Run only unit tests"
            echo "  $0 --coverage      # Run all tests with coverage"
            exit 0
            ;;
        *)
            error_exit "Unknown option: $1"
            ;;
    esac
done

# Initialize test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
TEST_RESULTS=()

# Function to run test suite
run_test_suite() {
    local suite_name="$1"
    local test_command="$2"
    local description="$3"
    
    info "Running $description..."
    
    if eval "$test_command"; then
        success "$suite_name tests passed"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        TEST_RESULTS+=("✅ $suite_name: PASSED")
        return 0
    else
        warning "$suite_name tests failed"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        TEST_RESULTS+=("❌ $suite_name: FAILED")
        return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    info "Checking test prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        error_exit "Node.js is required but not installed"
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        error_exit "npm is required but not installed"
    fi
    
    # Check if dependencies are installed
    if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
        info "Installing dependencies..."
        cd "$PROJECT_ROOT"
        npm install || error_exit "Failed to install dependencies"
    fi
    
    # Check for k6 if load tests are enabled
    if [ "$RUN_LOAD_TESTS" = true ] && ! command -v k6 &> /dev/null; then
        warning "k6 not found. Load tests will be skipped."
        warning "Install k6 from https://k6.io/docs/getting-started/installation/"
        RUN_LOAD_TESTS=false
    fi
    
    success "Prerequisites check completed"
}

# Function to run unit tests
run_unit_tests() {
    if [ "$RUN_UNIT_TESTS" = false ]; then
        return 0
    fi
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    local coverage_flag=""
    if [ "$GENERATE_COVERAGE" = true ]; then
        coverage_flag="--coverage"
    fi
    
    run_test_suite "Unit" \
        "npm run test:run $coverage_flag -- --reporter=verbose" \
        "unit tests for all core components"
}

# Function to run integration tests
run_integration_tests() {
    if [ "$RUN_INTEGRATION_TESTS" = false ]; then
        return 0
    fi
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    run_test_suite "Integration" \
        "npm run test:run -- tests/integration/ --reporter=verbose" \
        "integration tests for end-to-end workflows"
}

# Function to run performance tests
run_performance_tests() {
    if [ "$RUN_PERFORMANCE_TESTS" = false ]; then
        return 0
    fi
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    run_test_suite "Performance" \
        "npm run test:run -- tests/performance/ --reporter=verbose" \
        "performance benchmarks and validation"
}

# Function to run load tests
run_load_tests() {
    if [ "$RUN_LOAD_TESTS" = false ]; then
        return 0
    fi
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    # Check if we can run load tests (need a running server or mock)
    info "Setting up load test environment..."
    
    # For now, run a basic load test simulation
    run_test_suite "Load" \
        "k6 run tests/load/k6-runner.js --vus 10 --duration 30s" \
        "load testing with concurrent users"
}

# Function to run chaos tests
run_chaos_tests() {
    if [ "$RUN_CHAOS_TESTS" = false ]; then
        return 0
    fi
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    run_test_suite "Chaos" \
        "npm run test:run -- tests/chaos/ --reporter=verbose" \
        "chaos engineering and failure simulation"
}

# Function to generate test report
generate_test_report() {
    local report_file="$PROJECT_ROOT/test-report-$(date +%Y%m%d-%H%M%S).md"
    
    cat > "$report_file" << EOF
# Comprehensive Test Report

**Generated:** $(date)
**Total Test Suites:** $TOTAL_TESTS
**Passed:** $PASSED_TESTS
**Failed:** $FAILED_TESTS
**Success Rate:** $(( PASSED_TESTS * 100 / TOTAL_TESTS ))%

## Test Results

EOF

    for result in "${TEST_RESULTS[@]}"; do
        echo "- $result" >> "$report_file"
    done

    cat >> "$report_file" << EOF

## Test Coverage

EOF

    if [ "$GENERATE_COVERAGE" = true ] && [ -f "$PROJECT_ROOT/coverage/coverage-summary.json" ]; then
        echo "Coverage report available in: coverage/" >> "$report_file"
    else
        echo "Coverage report not generated. Use --coverage flag to generate." >> "$report_file"
    fi

    cat >> "$report_file" << EOF

## Recommendations

EOF

    if [ $FAILED_TESTS -gt 0 ]; then
        cat >> "$report_file" << EOF
- ⚠️  Some test suites failed. Review the output above for details.
- 🔧 Fix failing tests before deploying to production.
- 📊 Consider running tests individually to isolate issues.
EOF
    else
        cat >> "$report_file" << EOF
- ✅ All test suites passed successfully.
- 🚀 System is ready for deployment.
- 📈 Consider running load tests with higher concurrency for production readiness.
EOF
    fi

    info "Test report generated: $(basename "$report_file")"
}

# Main execution
main() {
    log "🧪 Starting Comprehensive Test Suite for CF AI Support Bot" "$BLUE"
    echo
    
    check_prerequisites
    
    # Change to project root
    cd "$PROJECT_ROOT"
    
    # Run test suites
    if [ "$PARALLEL_TESTS" = true ]; then
        info "Running tests in parallel mode..."
        
        # Run tests in background and collect results
        run_unit_tests &
        UNIT_PID=$!
        
        run_integration_tests &
        INTEGRATION_PID=$!
        
        run_performance_tests &
        PERFORMANCE_PID=$!
        
        run_chaos_tests &
        CHAOS_PID=$!
        
        # Wait for all background jobs
        wait $UNIT_PID $INTEGRATION_PID $PERFORMANCE_PID $CHAOS_PID
        
        # Load tests run separately as they need special setup
        run_load_tests
    else
        info "Running tests sequentially..."
        
        run_unit_tests
        run_integration_tests
        run_performance_tests
        run_load_tests
        run_chaos_tests
    fi
    
    echo
    log "📊 Test Execution Summary" "$BLUE"
    echo "Total Test Suites: $TOTAL_TESTS"
    echo "Passed: $PASSED_TESTS"
    echo "Failed: $FAILED_TESTS"
    
    if [ $TOTAL_TESTS -gt 0 ]; then
        SUCCESS_RATE=$(( PASSED_TESTS * 100 / TOTAL_TESTS ))
        echo "Success Rate: ${SUCCESS_RATE}%"
    fi
    
    echo
    echo "Test Results:"
    for result in "${TEST_RESULTS[@]}"; do
        echo "  $result"
    done
    
    # Generate detailed report
    generate_test_report
    
    echo
    if [ $FAILED_TESTS -eq 0 ]; then
        success "🎉 All test suites completed successfully!"
        log "The system is ready for deployment" "$GREEN"
    else
        warning "⚠️  Some test suites failed"
        log "Please review and fix failing tests before deployment" "$YELLOW"
    fi
    
    # Exit with appropriate code
    exit $FAILED_TESTS
}

# Run main function
main "$@"