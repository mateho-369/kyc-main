#!/bin/bash

# ==========================================
# SafeVideo Integration Test Suite
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
TEST_RESULTS_DIR="$PROJECT_ROOT/test-results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TEST_LOG="$TEST_RESULTS_DIR/integration_test_$TIMESTAMP.log"

# Test environment configuration
TEST_BASE_URL="${TEST_BASE_URL:-http://localhost}"
TEST_TIMEOUT="${TEST_TIMEOUT:-30}"
DOCKER_COMPOSE_FILE="${DOCKER_COMPOSE_FILE:-docker/production/docker-compose.production.yml}"

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Ensure test results directory exists
mkdir -p "$TEST_RESULTS_DIR"

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}SafeVideo Integration Test Suite${NC}"
echo -e "${BLUE}===========================================${NC}"

# Function to log messages
log() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} - ${message}" | tee -a "$TEST_LOG"
}

# Function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_result="${3:-0}"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    log "${YELLOW}Running test: $test_name${NC}"
    
    if eval "$test_command" >/dev/null 2>&1; then
        local result=0
    else
        local result=1
    fi
    
    if [ "$result" -eq "$expected_result" ]; then
        log "${GREEN}✓ PASS: $test_name${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        log "${RED}✗ FAIL: $test_name${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# Function to wait for service
wait_for_service() {
    local service_url="$1"
    local timeout="$2"
    local service_name="${3:-service}"
    
    log "Waiting for $service_name to be ready..."
    
    local end_time=$(($(date +%s) + timeout))
    
    while [ $(date +%s) -lt $end_time ]; do
        if curl -s -f "$service_url" >/dev/null 2>&1; then
            log "${GREEN}✓ $service_name is ready${NC}"
            return 0
        fi
        sleep 2
    done
    
    log "${RED}✗ Timeout waiting for $service_name${NC}"
    return 1
}

# Function to check Docker services
check_docker_services() {
    log "${BLUE}Checking Docker services...${NC}"
    
    # Check if services are running
    run_test "Docker Swarm Active" "docker info | grep -q 'Swarm: active'"
    run_test "SafeVideo Stack Deployed" "docker stack ls | grep -q safevideo"
    
    # Check individual services
    local services=(
        "safevideo_load-balancer"
        "safevideo_server-blue"
        "safevideo_client"
        "safevideo_mysql-master"
        "safevideo_redis-cluster"
        "safevideo_prometheus"
        "safevideo_grafana"
    )
    
    for service in "${services[@]}"; do
        run_test "Service $service running" "docker service ls | grep $service | grep -q '1/1\\|2/2\\|3/3'"
    done
}

# Function to test application endpoints
test_application_endpoints() {
    log "${BLUE}Testing application endpoints...${NC}"
    
    # Wait for application to be ready
    wait_for_service "$TEST_BASE_URL/api/health" $TEST_TIMEOUT "Application"
    
    # Health check endpoints
    run_test "API Health Check" "curl -s $TEST_BASE_URL/api/health | grep -q 'ok'"
    run_test "API Detailed Health" "curl -s $TEST_BASE_URL/api/health/detailed | grep -q 'status'"
    run_test "API Version Info" "curl -s $TEST_BASE_URL/api/version | grep -q 'version'"
    
    # Authentication endpoints
    run_test "Login Endpoint Available" "curl -s -o /dev/null -w '%{http_code}' $TEST_BASE_URL/api/auth/login | grep -q '400\\|401'"
    run_test "Register Endpoint Available" "curl -s -o /dev/null -w '%{http_code}' $TEST_BASE_URL/api/auth/register | grep -q '400\\|422'"
    
    # Protected endpoints (should require auth)
    run_test "Protected Endpoint Auth Required" "curl -s -o /dev/null -w '%{http_code}' $TEST_BASE_URL/api/user/profile | grep -q '401'"
    run_test "Document Upload Auth Required" "curl -s -o /dev/null -w '%{http_code}' $TEST_BASE_URL/api/documents/upload | grep -q '401'"
    
    # Static file serving
    run_test "Client App Served" "curl -s -o /dev/null -w '%{http_code}' $TEST_BASE_URL/ | grep -q '200'"
    run_test "Static Assets Available" "curl -s -o /dev/null -w '%{http_code}' $TEST_BASE_URL/static/ | grep -q '200\\|403'"
}

# Function to test database connectivity
test_database_connectivity() {
    log "${BLUE}Testing database connectivity...${NC}"
    
    # MySQL master connectivity
    run_test "MySQL Master Connection" "docker exec \$(docker ps -q -f name=mysql-master) mysql -u root -e 'SELECT 1' 2>/dev/null"
    
    # MySQL replica connectivity
    run_test "MySQL Replica Connection" "docker exec \$(docker ps -q -f name=mysql-replica) mysql -u root -e 'SELECT 1' 2>/dev/null"
    
    # Database schema validation
    run_test "Database Schema Exists" "docker exec \$(docker ps -q -f name=mysql-master) mysql -u root -e 'USE safevideo; SHOW TABLES;' 2>/dev/null | grep -q users"
    
    # Redis connectivity
    run_test "Redis Connection" "docker exec \$(docker ps -q -f name=redis) redis-cli ping | grep -q PONG"
    
    # Redis cluster status
    run_test "Redis Cluster Info" "docker exec \$(docker ps -q -f name=redis) redis-cli cluster info | grep -q cluster_state:ok"
}

# Function to test security features
test_security_features() {
    log "${BLUE}Testing security features...${NC}"
    
    # HTTPS redirection
    run_test "HTTP to HTTPS Redirect" "curl -s -o /dev/null -w '%{http_code}' http://localhost | grep -q '301\\|302'"
    
    # Security headers
    run_test "Security Headers Present" "curl -s -I $TEST_BASE_URL/ | grep -q 'X-Frame-Options\\|X-XSS-Protection\\|X-Content-Type-Options'"
    
    # CSRF protection
    run_test "CSRF Token Endpoint" "curl -s $TEST_BASE_URL/api/csrf-token | grep -q 'csrfToken'"
    
    # Rate limiting
    run_test "Rate Limiting Active" "for i in {1..25}; do curl -s -o /dev/null $TEST_BASE_URL/api/health; done; curl -s -o /dev/null -w '%{http_code}' $TEST_BASE_URL/api/health | grep -q '429'"
    
    # WAF protection (if ModSecurity is enabled)
    run_test "WAF SQL Injection Block" "curl -s -o /dev/null -w '%{http_code}' '$TEST_BASE_URL/api/test?id=1%27%20OR%201=1' | grep -q '403'"
    
    # XSS protection
    run_test "WAF XSS Block" "curl -s -o /dev/null -w '%{http_code}' '$TEST_BASE_URL/api/test?input=<script>alert(1)</script>' | grep -q '403'"
}

# Function to test monitoring and metrics
test_monitoring_metrics() {
    log "${BLUE}Testing monitoring and metrics...${NC}"
    
    # Prometheus metrics
    wait_for_service "$TEST_BASE_URL:9090/-/healthy" $TEST_TIMEOUT "Prometheus"
    run_test "Prometheus Health" "curl -s $TEST_BASE_URL:9090/-/healthy | grep -q 'Prometheus is Healthy'"
    
    # Grafana
    wait_for_service "$TEST_BASE_URL:3000/api/health" $TEST_TIMEOUT "Grafana"
    run_test "Grafana Health" "curl -s $TEST_BASE_URL:3000/api/health | grep -q 'ok'"
    
    # Application metrics
    run_test "Application Metrics Endpoint" "curl -s $TEST_BASE_URL/metrics | grep -q 'http_requests_total'"
    
    # HAProxy stats
    run_test "HAProxy Stats Available" "curl -s $TEST_BASE_URL:8404/ | grep -q 'HAProxy'"
    
    # Alertmanager
    run_test "Alertmanager Health" "curl -s $TEST_BASE_URL:9093/-/healthy | grep -q 'OK'"
}

# Function to test performance
test_performance() {
    log "${BLUE}Testing performance...${NC}"
    
    # Response time test
    local response_time=$(curl -s -o /dev/null -w '%{time_total}' $TEST_BASE_URL/api/health)
    run_test "API Response Time < 1s" "echo '$response_time < 1.0' | bc -l | grep -q 1"
    
    # Concurrent requests test
    log "Running concurrent requests test..."
    for i in {1..10}; do
        curl -s -o /dev/null $TEST_BASE_URL/api/health &
    done
    wait
    run_test "Concurrent Requests Handled" "curl -s $TEST_BASE_URL/api/health | grep -q 'ok'"
    
    # Load balancer health
    run_test "Load Balancer Health" "curl -s $TEST_BASE_URL:8405/blue/health | grep -q 'ok'"
}

# Function to test blue-green deployment capability
test_blue_green_deployment() {
    log "${BLUE}Testing Blue-Green deployment capability...${NC}"
    
    # Check current environment
    local current_env=$(docker service ls --filter name=safevideo_server-blue --format "{{.Replicas}}" | cut -d'/' -f1)
    run_test "Blue Environment Active" "[ '$current_env' -gt 0 ]"
    
    # Check green environment (should be scaled to 0)
    local green_env=$(docker service ls --filter name=safevideo_server-green --format "{{.Replicas}}" | cut -d'/' -f1)
    run_test "Green Environment Inactive" "[ '$green_env' -eq 0 ]"
    
    # Test deployment script availability
    run_test "Deployment Script Exists" "[ -x '$PROJECT_ROOT/deploy/blue-green-deploy.sh' ]"
    
    # Test dry run capability
    run_test "Deployment Dry Run" "DRY_RUN=true $PROJECT_ROOT/deploy/blue-green-deploy.sh green latest 60"
}

# Function to test backup and recovery
test_backup_recovery() {
    log "${BLUE}Testing backup and recovery...${NC}"
    
    # Database backup test
    run_test "Database Backup Creation" "docker exec \$(docker ps -q -f name=mysql-master) mysqldump -u root --all-databases > /tmp/test_backup.sql 2>/dev/null"
    
    # Backup file validation
    run_test "Backup File Valid" "[ -s /tmp/test_backup.sql ] && head -1 /tmp/test_backup.sql | grep -q 'MySQL dump'"
    
    # Log backup test
    run_test "Application Logs Accessible" "docker service logs safevideo_server-blue 2>/dev/null | head -1 | grep -q '.'"
    
    # Configuration backup
    run_test "Configuration Files Exist" "[ -f '$PROJECT_ROOT/docker/production/docker-compose.production.yml' ]"
    
    # Cleanup test backup
    rm -f /tmp/test_backup.sql
}

# Function to test disaster recovery
test_disaster_recovery() {
    log "${BLUE}Testing disaster recovery capabilities...${NC}"
    
    # Service restart test
    log "Testing service restart capability..."
    local service_id=$(docker service ls --filter name=safevideo_client --format "{{.ID}}")
    if [ -n "$service_id" ]; then
        docker service update --force "$service_id" >/dev/null 2>&1
        sleep 10
        run_test "Service Recovery After Restart" "curl -s $TEST_BASE_URL/ | grep -q 'html\\|SafeVideo'"
    else
        log "${YELLOW}Skipping service restart test - service not found${NC}"
    fi
    
    # Network connectivity test
    run_test "Inter-service Communication" "docker exec \$(docker ps -q -f name=server-blue) curl -s http://mysql-master:3306 2>/dev/null || docker exec \$(docker ps -q -f name=server-blue) nc -z mysql-master 3306"
    
    # Storage persistence test
    run_test "Data Persistence" "docker volume ls | grep -q safevideo"
}

# Function to generate test report
generate_test_report() {
    local report_file="$TEST_RESULTS_DIR/integration_test_report_$TIMESTAMP.html"
    
    cat > "$report_file" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>SafeVideo Integration Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #2c3e50; color: white; padding: 20px; text-align: center; }
        .summary { background: #ecf0f1; padding: 15px; margin: 20px 0; }
        .passed { color: #27ae60; }
        .failed { color: #e74c3c; }
        .test-section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; }
        pre { background: #f8f9fa; padding: 10px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="header">
        <h1>SafeVideo Integration Test Report</h1>
        <p>Generated: $(date)</p>
    </div>
    
    <div class="summary">
        <h2>Test Summary</h2>
        <p><strong>Total Tests:</strong> $TOTAL_TESTS</p>
        <p><strong class="passed">Passed:</strong> $PASSED_TESTS</p>
        <p><strong class="failed">Failed:</strong> $FAILED_TESTS</p>
        <p><strong>Success Rate:</strong> $(( PASSED_TESTS * 100 / TOTAL_TESTS ))%</p>
    </div>
    
    <div class="test-section">
        <h2>Test Details</h2>
        <pre>$(cat "$TEST_LOG")</pre>
    </div>
</body>
</html>
EOF
    
    log "${GREEN}Test report generated: $report_file${NC}"
}

# Function to cleanup test resources
cleanup_test_resources() {
    log "Cleaning up test resources..."
    
    # Remove test files
    rm -f /tmp/test_backup.sql
    
    # Reset any rate limiting
    sleep 60
    
    log "${GREEN}✓ Cleanup completed${NC}"
}

# Main execution function
main() {
    log "${GREEN}Starting SafeVideo Integration Test Suite...${NC}"
    
    # Test execution order
    check_docker_services
    test_application_endpoints
    test_database_connectivity
    test_security_features
    test_monitoring_metrics
    test_performance
    test_blue_green_deployment
    test_backup_recovery
    test_disaster_recovery
    
    # Generate report
    generate_test_report
    
    # Cleanup
    cleanup_test_resources
    
    # Final summary
    log "${BLUE}===========================================${NC}"
    if [ $FAILED_TESTS -eq 0 ]; then
        log "${GREEN}🎉 ALL TESTS PASSED! ($PASSED_TESTS/$TOTAL_TESTS)${NC}"
        log "${GREEN}SafeVideo system is ready for production${NC}"
    else
        log "${RED}⚠️  SOME TESTS FAILED ($FAILED_TESTS/$TOTAL_TESTS)${NC}"
        log "${RED}Please review failed tests before production deployment${NC}"
    fi
    log "${BLUE}===========================================${NC}"
    
    # Exit with appropriate code
    exit $FAILED_TESTS
}

# Command line options
case "${1:-}" in
    "--help"|"-h")
        echo "SafeVideo Integration Test Suite"
        echo ""
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --help, -h          Show this help message"
        echo "  --report-only       Generate report from existing log"
        echo ""
        echo "Environment variables:"
        echo "  TEST_BASE_URL       Base URL for testing (default: http://localhost)"
        echo "  TEST_TIMEOUT        Timeout for service waits (default: 30)"
        echo "  DOCKER_COMPOSE_FILE Docker compose file to use"
        exit 0
        ;;
    "--report-only")
        generate_test_report
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac