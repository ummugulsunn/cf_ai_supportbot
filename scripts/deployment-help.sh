#!/bin/bash

# Deployment Help and Overview Script
# Usage: ./scripts/deployment-help.sh [command]

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}================================================================================================${NC}"
    echo -e "${CYAN}                    Cloudflare AI Support Bot - Deployment Tools${NC}"
    echo -e "${BLUE}================================================================================================${NC}"
    echo
}

print_section() {
    echo -e "${GREEN}$1${NC}"
    echo -e "${YELLOW}$(printf '%.0s-' $(seq 1 ${#1}))${NC}"
}

show_overview() {
    print_header
    
    echo -e "${CYAN}This project includes comprehensive deployment automation tools for the Cloudflare AI Support Bot.${NC}"
    echo
    
    print_section "Available Commands"
    echo
    echo -e "${GREEN}Main Deployment:${NC}"
    echo -e "  ${YELLOW}./deploy.sh [environment] [options]${NC}          - Main deployment script"
    echo -e "    Environments: development, staging, production"
    echo -e "    Options: --skip-tests, --skip-build, --rollback, --verify-only"
    echo
    
    echo -e "${GREEN}Environment Management:${NC}"
    echo -e "  ${YELLOW}./scripts/setup-environment.sh [env]${NC}         - Set up Cloudflare resources"
    echo -e "  ${YELLOW}./scripts/test-deployment-pipeline.sh [env]${NC}  - Test entire deployment pipeline"
    echo
    
    echo -e "${GREEN}Deployment Operations:${NC}"
    echo -e "  ${YELLOW}./scripts/verify-deployment.sh [env] [--detailed]${NC} - Verify deployment health"
    echo -e "  ${YELLOW}./scripts/monitor-deployment.sh [env] [duration]${NC}  - Monitor deployment stability"
    echo -e "  ${YELLOW}./scripts/rollback.sh [env] [deployment-id]${NC}      - Rollback to previous version"
    echo -e "  ${YELLOW}./scripts/test-deployment.sh [env] [test-type]${NC}    - Run deployment tests"
    echo
    
    echo -e "${GREEN}Help and Information:${NC}"
    echo -e "  ${YELLOW}./scripts/deployment-help.sh [command]${NC}       - Show this help or command details"
    echo
    
    print_section "Quick Start Guide"
    echo
    echo -e "${CYAN}1. First-time setup:${NC}"
    echo -e "   ./scripts/setup-environment.sh development"
    echo -e "   ./scripts/test-deployment-pipeline.sh development"
    echo
    echo -e "${CYAN}2. Deploy to development:${NC}"
    echo -e "   ./deploy.sh development"
    echo
    echo -e "${CYAN}3. Verify deployment:${NC}"
    echo -e "   ./scripts/verify-deployment.sh development --detailed"
    echo
    echo -e "${CYAN}4. Monitor deployment:${NC}"
    echo -e "   ./scripts/monitor-deployment.sh development 10"
    echo
    
    print_section "Environment Information"
    echo
    echo -e "${GREEN}Development:${NC} cf-ai-supportbot-dev"
    echo -e "  - Lower resource limits"
    echo -e "  - Debug logging enabled"
    echo -e "  - 2-hour session TTL"
    echo
    echo -e "${GREEN}Staging:${NC} cf-ai-supportbot-staging"
    echo -e "  - Production-like configuration"
    echo -e "  - Automated CI/CD from 'develop' branch"
    echo -e "  - 12-hour session TTL"
    echo
    echo -e "${GREEN}Production:${NC} cf-ai-supportbot"
    echo -e "  - Optimized performance settings"
    echo -e "  - Automated CI/CD from 'main' branch"
    echo -e "  - 24-hour session TTL"
    echo
    
    print_section "Documentation"
    echo
    echo -e "  ${YELLOW}README.md${NC}        - Project overview and setup"
    echo -e "  ${YELLOW}DEPLOYMENT.md${NC}    - Comprehensive deployment guide"
    echo -e "  ${YELLOW}PROMPTS.md${NC}       - AI prompts and instructions"
    echo
    
    echo -e "${BLUE}For detailed help on any command, run:${NC}"
    echo -e "${YELLOW}./scripts/deployment-help.sh [command-name]${NC}"
    echo
}

show_deploy_help() {
    print_header
    print_section "Main Deployment Script (deploy.sh)"
    echo
    echo -e "${CYAN}Usage:${NC} ./deploy.sh [environment] [options]"
    echo
    echo -e "${GREEN}Environments:${NC}"
    echo -e "  development  - Development environment with debug settings"
    echo -e "  staging      - Staging environment for testing"
    echo -e "  production   - Production environment (default)"
    echo
    echo -e "${GREEN}Options:${NC}"
    echo -e "  --skip-tests    Skip test execution"
    echo -e "  --skip-build    Skip build process"
    echo -e "  --rollback      Rollback to previous deployment"
    echo -e "  --verify-only   Only verify existing deployment"
    echo
    echo -e "${GREEN}Examples:${NC}"
    echo -e "  ./deploy.sh                           # Deploy to production"
    echo -e "  ./deploy.sh staging                   # Deploy to staging"
    echo -e "  ./deploy.sh development --skip-tests  # Deploy to dev without tests"
    echo -e "  ./deploy.sh production --verify-only  # Verify production deployment"
    echo
    echo -e "${GREEN}What it does:${NC}"
    echo -e "  1. Checks prerequisites (Node.js, Wrangler, authentication)"
    echo -e "  2. Installs dependencies (unless --skip-build)"
    echo -e "  3. Runs tests (unless --skip-tests)"
    echo -e "  4. Builds TypeScript and frontend"
    echo -e "  5. Sets up secrets"
    echo -e "  6. Deploys Worker and Pages"
    echo -e "  7. Verifies deployment"
    echo -e "  8. Runs post-deployment monitoring"
    echo
}

show_setup_help() {
    print_header
    print_section "Environment Setup Script (setup-environment.sh)"
    echo
    echo -e "${CYAN}Usage:${NC} ./scripts/setup-environment.sh [environment]"
    echo
    echo -e "${GREEN}What it does:${NC}"
    echo -e "  1. Creates KV namespaces for the environment"
    echo -e "  2. Creates R2 buckets for conversation archiving"
    echo -e "  3. Sets up required secrets (prompts for values)"
    echo -e "  4. Generates environment configuration file"
    echo -e "  5. Validates the setup"
    echo
    echo -e "${GREEN}Required secrets:${NC}"
    echo -e "  OPENAI_API_KEY         - OpenAI API key for fallback model"
    echo -e "  KNOWLEDGE_BASE_API_KEY - API key for knowledge base integration"
    echo -e "  TICKETING_API_KEY      - API key for ticketing system integration"
    echo
    echo -e "${GREEN}Examples:${NC}"
    echo -e "  ./scripts/setup-environment.sh development"
    echo -e "  ./scripts/setup-environment.sh production"
    echo
}

show_verify_help() {
    print_header
    print_section "Deployment Verification Script (verify-deployment.sh)"
    echo
    echo -e "${CYAN}Usage:${NC} ./scripts/verify-deployment.sh [environment] [--detailed]"
    echo
    echo -e "${GREEN}Test Types:${NC}"
    echo -e "  Basic:     Health checks, endpoint availability, WebSocket connectivity"
    echo -e "  Detailed:  API functionality, performance metrics, security headers"
    echo
    echo -e "${GREEN}What it tests:${NC}"
    echo -e "  ✓ Health endpoint (/health)"
    echo -e "  ✓ API status endpoint (/api/status)"
    echo -e "  ✓ Pages frontend"
    echo -e "  ✓ WebSocket connectivity"
    echo -e "  ✓ Session creation (detailed mode)"
    echo -e "  ✓ Chat API functionality (detailed mode)"
    echo -e "  ✓ Response times (detailed mode)"
    echo -e "  ✓ Security headers (detailed mode)"
    echo
    echo -e "${GREEN}Examples:${NC}"
    echo -e "  ./scripts/verify-deployment.sh production"
    echo -e "  ./scripts/verify-deployment.sh staging --detailed"
    echo
}

show_monitor_help() {
    print_header
    print_section "Deployment Monitoring Script (monitor-deployment.sh)"
    echo
    echo -e "${CYAN}Usage:${NC} ./scripts/monitor-deployment.sh [environment] [duration]"
    echo
    echo -e "${GREEN}Parameters:${NC}"
    echo -e "  environment  - Target environment (development|staging|production)"
    echo -e "  duration     - Monitoring duration in minutes (default: 10)"
    echo
    echo -e "${GREEN}What it monitors:${NC}"
    echo -e "  • Response times for health and API endpoints"
    echo -e "  • Error rates and availability"
    echo -e "  • Performance metrics over time"
    echo -e "  • Alerts when thresholds are exceeded"
    echo
    echo -e "${GREEN}Alert Thresholds:${NC}"
    echo -e "  Error Rate:  > 5% (configurable in deployment-config.json)"
    echo -e "  Latency:     > 2000ms P95 (configurable)"
    echo
    echo -e "${GREEN}Examples:${NC}"
    echo -e "  ./scripts/monitor-deployment.sh production 15"
    echo -e "  ./scripts/monitor-deployment.sh staging"
    echo
}

show_rollback_help() {
    print_header
    print_section "Rollback Script (rollback.sh)"
    echo
    echo -e "${CYAN}Usage:${NC} ./scripts/rollback.sh [environment] [deployment-id] [options]"
    echo
    echo -e "${GREEN}Parameters:${NC}"
    echo -e "  environment     - Target environment"
    echo -e "  deployment-id   - Specific deployment ID (optional, defaults to previous)"
    echo
    echo -e "${GREEN}Options:${NC}"
    echo -e "  --list     Show deployment history and exit"
    echo -e "  --help     Show help message"
    echo
    echo -e "${GREEN}What it does:${NC}"
    echo -e "  1. Fetches deployment history"
    echo -e "  2. Confirms rollback target with user"
    echo -e "  3. Performs rollback using Wrangler"
    echo -e "  4. Verifies rollback success"
    echo -e "  5. Generates rollback report"
    echo
    echo -e "${GREEN}Examples:${NC}"
    echo -e "  ./scripts/rollback.sh production"
    echo -e "  ./scripts/rollback.sh staging abc123def456"
    echo -e "  ./scripts/rollback.sh production --list"
    echo
}

show_test_help() {
    print_header
    print_section "Deployment Testing Script (test-deployment.sh)"
    echo
    echo -e "${CYAN}Usage:${NC} ./scripts/test-deployment.sh [environment] [test-type]"
    echo
    echo -e "${GREEN}Test Types:${NC}"
    echo -e "  smoke        - Basic functionality tests"
    echo -e "  integration  - API integration tests"
    echo -e "  load         - Concurrent request testing"
    echo -e "  all          - All test types"
    echo
    echo -e "${GREEN}Examples:${NC}"
    echo -e "  ./scripts/test-deployment.sh production smoke"
    echo -e "  ./scripts/test-deployment.sh staging all"
    echo
}

show_pipeline_help() {
    print_header
    print_section "Pipeline Testing Script (test-deployment-pipeline.sh)"
    echo
    echo -e "${CYAN}Usage:${NC} ./scripts/test-deployment-pipeline.sh [environment]"
    echo
    echo -e "${GREEN}What it tests:${NC}"
    echo -e "  1. Prerequisites (Node.js, Wrangler, authentication)"
    echo -e "  2. Project structure validation"
    echo -e "  3. Dependency installation"
    echo -e "  4. TypeScript build"
    echo -e "  5. Test execution"
    echo -e "  6. Frontend build"
    echo -e "  7. Environment setup validation"
    echo -e "  8. Deployment script validation"
    echo -e "  9. Configuration validation"
    echo -e "  10. Dry run deployment (development only)"
    echo -e "  11. Script integration tests"
    echo -e "  12. Documentation validation"
    echo
    echo -e "${GREEN}Use this before first deployment to ensure everything is set up correctly.${NC}"
    echo
}

# Main command handling
case "${1:-}" in
    "deploy"|"deploy.sh")
        show_deploy_help
        ;;
    "setup"|"setup-environment"|"setup-environment.sh")
        show_setup_help
        ;;
    "verify"|"verify-deployment"|"verify-deployment.sh")
        show_verify_help
        ;;
    "monitor"|"monitor-deployment"|"monitor-deployment.sh")
        show_monitor_help
        ;;
    "rollback"|"rollback.sh")
        show_rollback_help
        ;;
    "test"|"test-deployment"|"test-deployment.sh")
        show_test_help
        ;;
    "pipeline"|"test-pipeline"|"test-deployment-pipeline.sh")
        show_pipeline_help
        ;;
    "help"|"--help"|"-h"|"")
        show_overview
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo -e "${YELLOW}Run './scripts/deployment-help.sh' for available commands${NC}"
        exit 1
        ;;
esac