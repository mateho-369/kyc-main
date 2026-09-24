#!/bin/bash

# ==========================================
# SafeVideo Blue-Green Deployment Script
# ==========================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOYMENT_DIR="$PROJECT_ROOT/deploy"
COMPOSE_FILE="$PROJECT_ROOT/docker/production/docker-compose.production.yml"
HAPROXY_CONFIG="$PROJECT_ROOT/docker/production/haproxy/haproxy.cfg"

# Default values
ENVIRONMENT="${1:-}"
VERSION="${2:-latest}"
TIMEOUT="${3:-300}"
DRY_RUN="${DRY_RUN:-false}"

# Notification settings
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
DEPLOYMENT_LOG="$DEPLOYMENT_DIR/deployment_$(date +%Y%m%d_%H%M%S).log"

# Ensure deployment directory exists
mkdir -p "$DEPLOYMENT_DIR"

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}SafeVideo Blue-Green Deployment${NC}"
echo -e "${BLUE}===========================================${NC}"

# Function to log messages
log() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} - ${message}" | tee -a "$DEPLOYMENT_LOG"
}

# Function to send notifications
send_notification() {
    local status="$1"
    local message="$2"
    
    local color=""
    case "$status" in
        "SUCCESS") color="good" ;;
        "ERROR") color="danger" ;;
        "WARNING") color="warning" ;;
        *) color="#439FE0" ;;
    esac
    
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"attachments\":[{\"color\":\"$color\",\"title\":\"SafeVideo Deployment $status\",\"text\":\"$message\",\"ts\":$(date +%s)}]}" \
            "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
    fi
}

# Function to check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker >/dev/null 2>&1; then
        log "${RED}Error: Docker is not installed${NC}"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose >/dev/null 2>&1; then
        log "${RED}Error: Docker Compose is not installed${NC}"
        exit 1
    fi
    
    # Check if running in swarm mode
    if ! docker info | grep -q "Swarm: active"; then
        log "${RED}Error: Docker Swarm is not active${NC}"
        exit 1
    fi
    
    # Check compose file
    if [ ! -f "$COMPOSE_FILE" ]; then
        log "${RED}Error: Compose file not found: $COMPOSE_FILE${NC}"
        exit 1
    fi
    
    # Check HAProxy config
    if [ ! -f "$HAPROXY_CONFIG" ]; then
        log "${RED}Error: HAProxy config not found: $HAPROXY_CONFIG${NC}"
        exit 1
    fi
    
    log "${GREEN}✓ All prerequisites met${NC}"
}

# Function to get current active environment
get_active_environment() {
    # Check which environment is currently receiving traffic
    local blue_replicas=$(docker service ls --filter name=safevideo_server-blue --format "{{.Replicas}}" | cut -d'/' -f1)
    local green_replicas=$(docker service ls --filter name=safevideo_server-green --format "{{.Replicas}}" | cut -d'/' -f1)
    
    if [ "$blue_replicas" -gt 0 ] && [ "$green_replicas" -eq 0 ]; then
        echo "blue"
    elif [ "$green_replicas" -gt 0 ] && [ "$blue_replicas" -eq 0 ]; then
        echo "green"
    elif [ "$blue_replicas" -gt 0 ] && [ "$green_replicas" -gt 0 ]; then
        echo "both"
    else
        echo "none"
    fi
}

# Function to get target environment
get_target_environment() {
    local current_env=$(get_active_environment)
    
    case "$current_env" in
        "blue") echo "green" ;;
        "green") echo "blue" ;;
        "none") echo "blue" ;;
        "both") 
            log "${YELLOW}Warning: Both environments are active${NC}"
            echo "green"
            ;;
    esac
}

# Function to validate image
validate_image() {
    local image="$1"
    
    log "Validating image: $image"
    
    # Pull image
    if ! docker pull "$image" >/dev/null 2>&1; then
        log "${RED}Error: Failed to pull image $image${NC}"
        return 1
    fi
    
    # Basic security scan (if trivy is available)
    if command -v trivy >/dev/null 2>&1; then
        log "Running security scan on image..."
        if ! trivy image --exit-code 1 --severity HIGH,CRITICAL "$image" >/dev/null 2>&1; then
            log "${RED}Error: Image failed security scan${NC}"
            return 1
        fi
    fi
    
    log "${GREEN}✓ Image validation passed${NC}"
    return 0
}

# Function to deploy to target environment
deploy_to_environment() {
    local target_env="$1"
    local version="$2"
    
    log "Deploying version $version to $target_env environment..."
    
    # Set environment variables
    export VERSION="$version"
    export DEPLOYMENT_ENVIRONMENT="$target_env"
    
    # Deploy to target environment
    if [ "$DRY_RUN" = "true" ]; then
        log "${YELLOW}DRY RUN: Would deploy to $target_env environment${NC}"
        return 0
    fi
    
    # Update service
    local service_name="safevideo_server-$target_env"
    
    if [ "$target_env" = "blue" ]; then
        docker service update \
            --image "safevideo/server:$version" \
            --replicas 3 \
            --update-parallelism 1 \
            --update-delay 30s \
            --update-failure-action rollback \
            "$service_name" || {
            log "${RED}Error: Failed to deploy to $target_env environment${NC}"
            return 1
        }
    else
        docker service update \
            --image "safevideo/server:$version" \
            --replicas 3 \
            --update-parallelism 1 \
            --update-delay 30s \
            --update-failure-action rollback \
            "$service_name" || {
            log "${RED}Error: Failed to deploy to $target_env environment${NC}"
            return 1
        }
    fi
    
    log "${GREEN}✓ Deployed to $target_env environment${NC}"
}

# Function to wait for deployment
wait_for_deployment() {
    local target_env="$1"
    local timeout="$2"
    
    log "Waiting for $target_env environment to be ready..."
    
    local service_name="safevideo_server-$target_env"
    local end_time=$(($(date +%s) + timeout))
    
    while [ $(date +%s) -lt $end_time ]; do
        local ready_replicas=$(docker service ls --filter name="$service_name" --format "{{.Replicas}}" | cut -d'/' -f1)
        local total_replicas=$(docker service ls --filter name="$service_name" --format "{{.Replicas}}" | cut -d'/' -f2)
        
        if [ "$ready_replicas" = "$total_replicas" ] && [ "$ready_replicas" -gt 0 ]; then
            log "${GREEN}✓ $target_env environment is ready${NC}"
            return 0
        fi
        
        log "Waiting... ($ready_replicas/$total_replicas replicas ready)"
        sleep 10
    done
    
    log "${RED}Error: Timeout waiting for $target_env environment${NC}"
    return 1
}

# Function to run health checks
run_health_checks() {
    local target_env="$1"
    
    log "Running health checks for $target_env environment..."
    
    # Get service endpoint
    local service_ip=$(docker service inspect safevideo_server-$target_env --format '{{.Endpoint.VirtualIPs}}' | grep -o '[0-9.]*' | head -1)
    
    if [ -z "$service_ip" ]; then
        log "${RED}Error: Could not determine service IP${NC}"
        return 1
    fi
    
    # Health check endpoints
    local health_endpoints=(
        "http://$service_ip:5000/api/health"
        "http://$service_ip:5000/api/health/detailed"
    )
    
    for endpoint in "${health_endpoints[@]}"; do
        log "Checking: $endpoint"
        
        local response=$(curl -s -o /dev/null -w "%{http_code}" "$endpoint" 2>/dev/null || echo "000")
        
        if [ "$response" = "200" ]; then
            log "${GREEN}✓ Health check passed: $endpoint${NC}"
        else
            log "${RED}✗ Health check failed: $endpoint (HTTP $response)${NC}"
            return 1
        fi
    done
    
    log "${GREEN}✓ All health checks passed${NC}"
    return 0
}

# Function to run smoke tests
run_smoke_tests() {
    local target_env="$1"
    
    log "Running smoke tests for $target_env environment..."
    
    # Add smoke test commands here
    local test_commands=(
        "curl -s http://localhost/api/health | grep -q 'ok'"
        "curl -s http://localhost/api/version | grep -q '$VERSION'"
    )
    
    for cmd in "${test_commands[@]}"; do
        if eval "$cmd" >/dev/null 2>&1; then
            log "${GREEN}✓ Smoke test passed: $cmd${NC}"
        else
            log "${RED}✗ Smoke test failed: $cmd${NC}"
            return 1
        fi
    done
    
    log "${GREEN}✓ All smoke tests passed${NC}"
}

# Function to switch traffic
switch_traffic() {
    local target_env="$1"
    local current_env="$2"
    
    log "Switching traffic from $current_env to $target_env..."
    
    if [ "$DRY_RUN" = "true" ]; then
        log "${YELLOW}DRY RUN: Would switch traffic to $target_env${NC}"
        return 0
    fi
    
    # Update HAProxy configuration or use runtime API
    # For simplicity, we'll scale down the old environment
    
    # Scale up target environment first
    docker service scale "safevideo_server-$target_env=3" || {
        log "${RED}Error: Failed to scale up $target_env environment${NC}"
        return 1
    }
    
    # Wait a moment for the new environment to stabilize
    sleep 30
    
    # Scale down current environment
    if [ "$current_env" != "none" ]; then
        docker service scale "safevideo_server-$current_env=0" || {
            log "${RED}Error: Failed to scale down $current_env environment${NC}"
            return 1
        }
    fi
    
    log "${GREEN}✓ Traffic switched to $target_env environment${NC}"
}

# Function to rollback deployment
rollback_deployment() {
    local failed_env="$1"
    local stable_env="$2"
    
    log "${RED}Rolling back deployment...${NC}"
    
    send_notification "ERROR" "Deployment to $failed_env failed. Rolling back to $stable_env."
    
    # Scale down failed environment
    docker service scale "safevideo_server-$failed_env=0"
    
    # Scale up stable environment
    docker service scale "safevideo_server-$stable_env=3"
    
    log "${GREEN}✓ Rollback completed${NC}"
}

# Function to cleanup old resources
cleanup_old_resources() {
    log "Cleaning up old resources..."
    
    # Remove unused images
    docker image prune -f >/dev/null 2>&1 || true
    
    # Remove unused volumes
    docker volume prune -f >/dev/null 2>&1 || true
    
    # Remove old deployment logs (keep last 10)
    find "$DEPLOYMENT_DIR" -name "deployment_*.log" -type f | sort -r | tail -n +11 | xargs rm -f || true
    
    log "${GREEN}✓ Cleanup completed${NC}"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [environment] [version] [timeout]"
    echo ""
    echo "Arguments:"
    echo "  environment  Target environment (blue|green|auto) [default: auto]"
    echo "  version      Image version to deploy [default: latest]"
    echo "  timeout      Deployment timeout in seconds [default: 300]"
    echo ""
    echo "Environment variables:"
    echo "  DRY_RUN              Set to 'true' for dry run [default: false]"
    echo "  SLACK_WEBHOOK_URL    Slack webhook for notifications"
    echo ""
    echo "Examples:"
    echo "  $0                          # Auto-deploy latest version"
    echo "  $0 blue v1.2.3 600         # Deploy v1.2.3 to blue with 10min timeout"
    echo "  DRY_RUN=true $0 green       # Dry run deployment to green"
}

# Main deployment function
main() {
    # Parse arguments
    if [ "$ENVIRONMENT" = "--help" ] || [ "$ENVIRONMENT" = "-h" ]; then
        show_usage
        exit 0
    fi
    
    # Determine target environment
    local current_env=$(get_active_environment)
    local target_env="$ENVIRONMENT"
    
    if [ "$target_env" = "" ] || [ "$target_env" = "auto" ]; then
        target_env=$(get_target_environment)
    fi
    
    log "Current environment: $current_env"
    log "Target environment: $target_env"
    log "Version: $VERSION"
    log "Timeout: ${TIMEOUT}s"
    
    if [ "$DRY_RUN" = "true" ]; then
        log "${YELLOW}DRY RUN MODE - No actual changes will be made${NC}"
    fi
    
    # Check prerequisites
    check_prerequisites
    
    # Send start notification
    send_notification "INFO" "Starting deployment of version $VERSION to $target_env environment"
    
    # Validate image
    if ! validate_image "safevideo/server:$VERSION"; then
        send_notification "ERROR" "Image validation failed for version $VERSION"
        exit 1
    fi
    
    # Deploy to target environment
    if ! deploy_to_environment "$target_env" "$VERSION"; then
        send_notification "ERROR" "Deployment to $target_env environment failed"
        exit 1
    fi
    
    # Wait for deployment to be ready
    if ! wait_for_deployment "$target_env" "$TIMEOUT"; then
        rollback_deployment "$target_env" "$current_env"
        send_notification "ERROR" "Deployment timeout. Rolled back to $current_env environment"
        exit 1
    fi
    
    # Run health checks
    if ! run_health_checks "$target_env"; then
        rollback_deployment "$target_env" "$current_env"
        send_notification "ERROR" "Health checks failed. Rolled back to $current_env environment"
        exit 1
    fi
    
    # Run smoke tests
    if ! run_smoke_tests "$target_env"; then
        rollback_deployment "$target_env" "$current_env"
        send_notification "ERROR" "Smoke tests failed. Rolled back to $current_env environment"
        exit 1
    fi
    
    # Switch traffic
    if ! switch_traffic "$target_env" "$current_env"; then
        rollback_deployment "$target_env" "$current_env"
        send_notification "ERROR" "Traffic switch failed. Rolled back to $current_env environment"
        exit 1
    fi
    
    # Cleanup
    cleanup_old_resources
    
    # Success notification
    send_notification "SUCCESS" "Deployment of version $VERSION to $target_env environment completed successfully"
    
    log "${GREEN}===========================================${NC}"
    log "${GREEN}Deployment completed successfully!${NC}"
    log "${GREEN}Active environment: $target_env${NC}"
    log "${GREEN}Version: $VERSION${NC}"
    log "${GREEN}===========================================${NC}"
}

# Run main function
main "$@"