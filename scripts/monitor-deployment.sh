#!/bin/bash

# Deployment Monitoring Script for CF AI Support Bot
# Usage: ./scripts/monitor-deployment.sh [environment] [duration]
# Duration in minutes (default: 10)

set -e

ENVIRONMENT="${1:-production}"
DURATION="${2:-10}"
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

if ! [[ "$DURATION" =~ ^[0-9]+$ ]] || [ "$DURATION" -lt 1 ]; then
    error_exit "Invalid duration: $DURATION. Must be a positive integer (minutes)"
fi

# Get configuration
get_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        error_exit "Configuration file not found: $CONFIG_FILE"
    fi
    
    if ! command -v jq &> /dev/null; then
        error_exit "jq is required for JSON parsing"
    fi
    
    WORKER_NAME=$(jq -r ".environments.$ENVIRONMENT.worker.name" "$CONFIG_FILE")
    ERROR_THRESHOLD=$(jq -r ".monitoring.alerts.errorRate.threshold // 5" "$CONFIG_FILE")
    LATENCY_THRESHOLD=$(jq -r ".monitoring.alerts.latency.p95Threshold // 2000" "$CONFIG_FILE")
    
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
    
    info "Monitoring $ENVIRONMENT deployment for $DURATION minutes:"
    info "  Worker: $WORKER_NAME"
    info "  URL: $WORKER_URL"
    info "  Error threshold: $ERROR_THRESHOLD%"
    info "  Latency threshold: ${LATENCY_THRESHOLD}ms"
}

# Initialize monitoring
initialize_monitoring() {
    MONITOR_LOG="$PROJECT_ROOT/monitoring-$(date +%Y%m%d-%H%M%S).log"
    METRICS_FILE="$PROJECT_ROOT/metrics-$(date +%Y%m%d-%H%M%S).json"
    
    # Initialize metrics
    cat > "$METRICS_FILE" << EOF
{
  "monitoring": {
    "start_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "environment": "$ENVIRONMENT",
    "worker_name": "$WORKER_NAME",
    "duration_minutes": $DURATION,
    "metrics": []
  }
}
EOF
    
    info "Monitoring initialized:"
    info "  Log file: $(basename "$MONITOR_LOG")"
    info "  Metrics file: $(basename "$METRICS_FILE")"
}

# Collect metrics
collect_metrics() {
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    local epoch=$(date +%s)
    
    # Test health endpoint
    local start_time=$(date +%s%3N)
    local http_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$WORKER_URL/health" || echo "000")
    local end_time=$(date +%s%3N)
    local response_time=$((end_time - start_time))
    
    # Test API endpoint
    local api_start_time=$(date +%s%3N)
    local api_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$WORKER_URL/api/status" || echo "000")
    local api_end_time=$(date +%s%3N)
    local api_response_time=$((api_end_time - api_start_time))
    
    # Determine if requests were successful
    local health_success=$([ "$http_status" = "200" ] && echo "true" || echo "false")
    local api_success=$([ "$api_status" = "200" ] && echo "true" || echo "false")
    
    # Log metrics
    echo "$timestamp - Health: $http_status (${response_time}ms), API: $api_status (${api_response_time}ms)" >> "$MONITOR_LOG"
    
    # Add to metrics file
    local temp_file=$(mktemp)
    jq --arg timestamp "$timestamp" \
       --arg epoch "$epoch" \
       --arg health_status "$http_status" \
       --arg health_success "$health_success" \
       --arg health_response_time "$response_time" \
       --arg api_status "$api_status" \
       --arg api_success "$api_success" \
       --arg api_response_time "$api_response_time" \
       '.monitoring.metrics += [{
         "timestamp": $timestamp,
         "epoch": ($epoch | tonumber),
         "health": {
           "status": $health_status,
           "success": ($health_success | test("true")),
           "response_time_ms": ($health_response_time | tonumber)
         },
         "api": {
           "status": $api_status,
           "success": ($api_success | test("true")),
           "response_time_ms": ($api_response_time | tonumber)
         }
       }]' "$METRICS_FILE" > "$temp_file" && mv "$temp_file" "$METRICS_FILE"
    
    # Return response times for analysis
    echo "$response_time,$api_response_time,$health_success,$api_success"
}

# Analyze metrics
analyze_metrics() {
    local total_requests=$1
    local failed_requests=$2
    local response_times=("${@:3}")
    
    # Calculate error rate
    local error_rate=0
    if [ "$total_requests" -gt 0 ]; then
        error_rate=$(echo "scale=2; $failed_requests * 100 / $total_requests" | bc -l)
    fi
    
    # Calculate average response time
    local total_time=0
    local count=0
    for time in "${response_times[@]}"; do
        if [[ "$time" =~ ^[0-9]+$ ]]; then
            total_time=$((total_time + time))
            count=$((count + 1))
        fi
    done
    
    local avg_response_time=0
    if [ "$count" -gt 0 ]; then
        avg_response_time=$((total_time / count))
    fi
    
    # Check thresholds
    local alerts=()
    
    if [ "$(echo "$error_rate > $ERROR_THRESHOLD" | bc -l)" = "1" ]; then
        alerts+=("High error rate: ${error_rate}% (threshold: ${ERROR_THRESHOLD}%)")
    fi
    
    if [ "$avg_response_time" -gt "$LATENCY_THRESHOLD" ]; then
        alerts+=("High latency: ${avg_response_time}ms (threshold: ${LATENCY_THRESHOLD}ms)")
    fi
    
    # Report results
    info "Metrics summary:"
    info "  Total requests: $total_requests"
    info "  Failed requests: $failed_requests"
    info "  Error rate: ${error_rate}%"
    info "  Average response time: ${avg_response_time}ms"
    
    if [ ${#alerts[@]} -gt 0 ]; then
        warning "Alerts triggered:"
        for alert in "${alerts[@]}"; do
            warning "  - $alert"
        done
        return 1
    else
        success "All metrics within acceptable thresholds"
        return 0
    fi
}

# Generate final report
generate_final_report() {
    local status=$1
    
    # Update metrics file with summary
    local temp_file=$(mktemp)
    jq --arg end_time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
       --arg status "$status" \
       '.monitoring.end_time = $end_time |
        .monitoring.status = $status |
        .monitoring.summary = {
          "total_requests": (.monitoring.metrics | length),
          "failed_requests": [.monitoring.metrics[] | select(.health.success == false or .api.success == false)] | length,
          "error_rate": (([.monitoring.metrics[] | select(.health.success == false or .api.success == false)] | length) * 100 / (.monitoring.metrics | length)),
          "avg_response_time": ([.monitoring.metrics[].health.response_time_ms] | add / length),
          "max_response_time": ([.monitoring.metrics[].health.response_time_ms] | max),
          "min_response_time": ([.monitoring.metrics[].health.response_time_ms] | min)
        }' "$METRICS_FILE" > "$temp_file" && mv "$temp_file" "$METRICS_FILE"
    
    info "Final monitoring report generated: $(basename "$METRICS_FILE")"
}

# Main monitoring loop
main() {
    log "📊 Starting deployment monitoring for $ENVIRONMENT environment..." "$BLUE"
    
    get_config
    initialize_monitoring
    
    local end_time=$(($(date +%s) + DURATION * 60))
    local total_requests=0
    local failed_requests=0
    local response_times=()
    
    info "Monitoring will run until $(date -d "@$end_time" '+%Y-%m-%d %H:%M:%S')"
    
    while [ $(date +%s) -lt $end_time ]; do
        # Collect metrics
        local metrics_result=$(collect_metrics)
        IFS=',' read -r health_time api_time health_success api_success <<< "$metrics_result"
        
        total_requests=$((total_requests + 2))  # Health + API
        
        if [ "$health_success" != "true" ]; then
            failed_requests=$((failed_requests + 1))
        fi
        
        if [ "$api_success" != "true" ]; then
            failed_requests=$((failed_requests + 1))
        fi
        
        response_times+=("$health_time" "$api_time")
        
        # Show progress
        local remaining=$((end_time - $(date +%s)))
        local minutes=$((remaining / 60))
        local seconds=$((remaining % 60))
        
        printf "\r⏱️  Monitoring... %02d:%02d remaining (Requests: %d, Failures: %d)" \
               "$minutes" "$seconds" "$total_requests" "$failed_requests"
        
        # Wait before next check (30 seconds)
        sleep 30
    done
    
    echo  # New line after progress indicator
    
    # Analyze results
    if analyze_metrics "$total_requests" "$failed_requests" "${response_times[@]}"; then
        success "📊 Monitoring completed successfully - deployment is stable"
        generate_final_report "stable"
        exit 0
    else
        warning "📊 Monitoring completed with issues - deployment may be unstable"
        generate_final_report "unstable"
        exit 1
    fi
}

# Handle help flag
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $0 [environment] [duration]"
    echo ""
    echo "Arguments:"
    echo "  environment    Target environment (development|staging|production)"
    echo "  duration       Monitoring duration in minutes (default: 10)"
    echo ""
    echo "Examples:"
    echo "  $0 production 15       # Monitor production for 15 minutes"
    echo "  $0 staging             # Monitor staging for 10 minutes (default)"
    exit 0
fi

# Run main function
main "$@"