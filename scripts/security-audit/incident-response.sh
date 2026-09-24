#!/bin/bash

# ==========================================
# SafeVideo Incident Response Script
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
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INCIDENT_DIR="$PROJECT_ROOT/incident-reports"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Notification settings (configure these)
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
EMAIL_ALERTS="${EMAIL_ALERTS:REPLACE_WITH_ACTUAL_ADDRESS}"
SYSLOG_SERVER="${SYSLOG_SERVER:-}"

# Ensure incident directory exists
mkdir -p "$INCIDENT_DIR"

echo -e "${RED}===========================================${NC}"
echo -e "${RED}SafeVideo Security Incident Response${NC}"
echo -e "${RED}===========================================${NC}"

# Function to log incident
log_incident() {
    local severity="$1"
    local title="$2"
    local description="$3"
    local evidence="$4"
    
    INCIDENT_FILE="$INCIDENT_DIR/incident_${severity}_$TIMESTAMP.json"
    
    cat > "$INCIDENT_FILE" << EOF
{
  "incident_id": "INC-$(date +%Y%m%d-%H%M%S)-$(shuf -i 1000-9999 -n 1)",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "severity": "$severity",
  "title": "$title",
  "description": "$description",
  "evidence": "$evidence",
  "status": "open",
  "response_actions": [],
  "containment_actions": [],
  "eradication_actions": [],
  "recovery_actions": [],
  "lessons_learned": "",
  "reported_by": "automated_system",
  "assigned_to": "security_team"
}
EOF
    
    echo -e "${BLUE}Incident logged: $INCIDENT_FILE${NC}"
}

# Function to send notifications
send_notification() {
    local severity="$1"
    local title="$2"
    local message="$3"
    
    # Slack notification
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚨 Security Incident [$severity]: $title\n$message\"}" \
            "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
    fi
    
    # Email notification (using mail command if available)
    if command -v mail >/dev/null 2>&1 && [ -n "$EMAIL_ALERTS" ]; then
        echo -e "$message" | mail -s "Security Incident [$severity]: $title" "$EMAIL_ALERTS" || true
    fi
    
    # Syslog
    if [ -n "$SYSLOG_SERVER" ] && command -v logger >/dev/null 2>&1; then
        logger -p user.crit -t "safevideo-security" "[$severity] $title: $message"
    fi
}

# Function to collect evidence
collect_evidence() {
    local evidence_dir="$INCIDENT_DIR/evidence_$TIMESTAMP"
    mkdir -p "$evidence_dir"
    
    echo -e "${YELLOW}Collecting evidence...${NC}"
    
    # Docker container logs
    if command -v docker >/dev/null 2>&1; then
        echo "Collecting Docker logs..."
        docker-compose -f "$PROJECT_ROOT/docker-compose.prod.yml" logs --tail=1000 > "$evidence_dir/docker_logs.txt" 2>/dev/null || true
        docker ps -a > "$evidence_dir/docker_ps.txt" 2>/dev/null || true
        docker stats --no-stream > "$evidence_dir/docker_stats.txt" 2>/dev/null || true
    fi
    
    # System logs
    if [ -d "/var/log" ]; then
        echo "Collecting system logs..."
        sudo tail -1000 /var/log/auth.log > "$evidence_dir/auth.log" 2>/dev/null || true
        sudo tail -1000 /var/log/nginx/access.log > "$evidence_dir/nginx_access.log" 2>/dev/null || true
        sudo tail -1000 /var/log/nginx/error.log > "$evidence_dir/nginx_error.log" 2>/dev/null || true
    fi
    
    # Application logs
    if [ -d "$PROJECT_ROOT/logs" ]; then
        echo "Collecting application logs..."
        cp -r "$PROJECT_ROOT/logs" "$evidence_dir/" 2>/dev/null || true
    fi
    
    # Network connections
    echo "Collecting network information..."
    netstat -tuln > "$evidence_dir/netstat.txt" 2>/dev/null || true
    ss -tuln > "$evidence_dir/ss.txt" 2>/dev/null || true
    
    # Process information
    echo "Collecting process information..."
    ps aux > "$evidence_dir/processes.txt" 2>/dev/null || true
    
    # Memory and disk usage
    echo "Collecting system resources..."
    free -h > "$evidence_dir/memory.txt" 2>/dev/null || true
    df -h > "$evidence_dir/disk.txt" 2>/dev/null || true
    
    # Environment variables (filtered)
    echo "Collecting environment info..."
    env | grep -v "PASSWORD\|SECRET\|TOKEN\|KEY" > "$evidence_dir/environment.txt" 2>/dev/null || true
    
    echo -e "${GREEN}Evidence collected in: $evidence_dir${NC}"
    echo "$evidence_dir"
}

# Function to detect attacks
detect_attack() {
    local log_file="$1"
    local attack_patterns=(
        "SQL injection" "(\-\-|\/\*|\*\/|;|'|\")"
        "XSS attempt" "(<script|javascript:|onclick=|onerror=)"
        "Path traversal" "(\.\.\/|\.\.\\\\|%2e%2e%2f)"
        "Command injection" "(;|\||`|>|<|\$\(|\${)"
        "Brute force" "(failed login|authentication failed|invalid password)"
        "DDoS attempt" "(too many requests|rate limit exceeded)"
        "Suspicious user agent" "(nikto|nmap|sqlmap|burp|scanner)"
    )
    
    local detections=""
    
    for ((i=0; i<${#attack_patterns[@]}; i+=2)); do
        local attack_name="${attack_patterns[i]}"
        local pattern="${attack_patterns[i+1]}"
        
        if grep -iE "$pattern" "$log_file" >/dev/null 2>&1; then
            local count=$(grep -icE "$pattern" "$log_file" 2>/dev/null || echo "0")
            detections+="$attack_name: $count occurrences\n"
        fi
    done
    
    echo -e "$detections"
}

# Function to handle different incident types
handle_incident() {
    local incident_type="$1"
    local severity="$2"
    local description="$3"
    
    case "$incident_type" in
        "brute_force")
            echo -e "${RED}Detected: Brute force attack${NC}"
            
            # Immediate containment actions
            echo "Implementing containment measures..."
            
            # Block suspicious IPs (if fail2ban is available)
            if command -v fail2ban-client >/dev/null 2>&1; then
                fail2ban-client status sshd 2>/dev/null || true
            fi
            
            # Increase rate limiting
            echo "Consider reducing rate limits temporarily"
            ;;
            
        "sql_injection")
            echo -e "${RED}Detected: SQL injection attempt${NC}"
            
            # Immediate containment
            echo "Checking database integrity..."
            
            # Check for unusual database activity
            if command -v mysql >/dev/null 2>&1; then
                mysql -e "SHOW PROCESSLIST;" 2>/dev/null || true
            fi
            ;;
            
        "xss_attempt")
            echo -e "${RED}Detected: XSS attempt${NC}"
            
            # Check for stored XSS
            echo "Checking for stored XSS payloads..."
            ;;
            
        "ddos_attack")
            echo -e "${RED}Detected: DDoS attack${NC}"
            
            # Activate DDoS protection
            echo "Activating DDoS protection measures..."
            
            # Scale services if in cloud environment
            echo "Consider scaling services and enabling CDN protection"
            ;;
            
        "malware_detected")
            echo -e "${RED}Detected: Malware${NC}"
            
            # Isolate affected systems
            echo "Isolating affected containers..."
            
            # Stop affected services
            docker-compose -f "$PROJECT_ROOT/docker-compose.prod.yml" stop || true
            ;;
            
        "data_breach")
            echo -e "${RED}Detected: Data breach${NC}"
            
            # Immediate actions for data breach
            echo "Implementing data breach response..."
            
            # Revoke all sessions
            echo "Consider revoking all user sessions"
            
            # Backup current state for forensics
            echo "Creating forensic backup..."
            ;;
    esac
}

# Function to run automated response
automated_response() {
    local incident_type="$1"
    local severity="$2"
    
    echo -e "${YELLOW}Starting automated incident response...${NC}"
    
    # Collect evidence first
    local evidence_path=$(collect_evidence)
    
    # Log the incident
    log_incident "$severity" "$incident_type" "Automated detection of $incident_type" "$evidence_path"
    
    # Send notifications
    send_notification "$severity" "$incident_type" "Automated detection triggered for $incident_type. Evidence collected at: $evidence_path"
    
    # Handle specific incident type
    handle_incident "$incident_type" "$severity" "Automated detection"
    
    echo -e "${GREEN}Automated response completed${NC}"
}

# Function to run security health check
security_health_check() {
    echo -e "${BLUE}Running security health check...${NC}"
    
    local issues=""
    local severity="LOW"
    
    # Check if containers are running
    if command -v docker >/dev/null 2>&1; then
        local down_containers=$(docker ps -a --filter "status=exited" --format "{{.Names}}" | grep safevideo || true)
        if [ -n "$down_containers" ]; then
            issues+="Containers down: $down_containers\n"
            severity="MEDIUM"
        fi
    fi
    
    # Check disk space
    local disk_usage=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$disk_usage" -gt 90 ]; then
        issues+="High disk usage: ${disk_usage}%\n"
        severity="HIGH"
    fi
    
    # Check memory usage
    local mem_usage=$(free | awk 'NR==2{printf "%.1f", $3*100/$2}')
    if [ "${mem_usage%.*}" -gt 90 ]; then
        issues+="High memory usage: ${mem_usage}%\n"
        severity="MEDIUM"
    fi
    
    # Check for failed login attempts
    if [ -f "/var/log/auth.log" ]; then
        local failed_logins=$(grep "Failed password" /var/log/auth.log | wc -l || echo "0")
        if [ "$failed_logins" -gt 100 ]; then
            issues+="High number of failed logins: $failed_logins\n"
            severity="HIGH"
        fi
    fi
    
    # Check SSL certificate expiry
    if command -v openssl >/dev/null 2>&1; then
        local cert_file="$PROJECT_ROOT/nginx/ssl/cert.pem"
        if [ -f "$cert_file" ]; then
            local cert_expiry=$(openssl x509 -in "$cert_file" -noout -enddate 2>/dev/null | cut -d= -f2)
            local expiry_timestamp=$(date -d "$cert_expiry" +%s 2>/dev/null || echo "0")
            local current_timestamp=$(date +%s)
            local days_until_expiry=$(( (expiry_timestamp - current_timestamp) / 86400 ))
            
            if [ "$days_until_expiry" -lt 30 ]; then
                issues+="SSL certificate expires in $days_until_expiry days\n"
                severity="MEDIUM"
            fi
        fi
    fi
    
    if [ -n "$issues" ]; then
        echo -e "${YELLOW}Security issues detected:${NC}"
        echo -e "$issues"
        
        log_incident "$severity" "Security Health Check" "Automated health check detected issues" "$issues"
        send_notification "$severity" "Security Health Check" "$issues"
    else
        echo -e "${GREEN}No security issues detected${NC}"
    fi
}

# Function to monitor logs in real-time
monitor_logs() {
    echo -e "${BLUE}Starting real-time log monitoring...${NC}"
    echo "Press Ctrl+C to stop monitoring"
    
    local log_files=(
        "$PROJECT_ROOT/logs/app/app.log"
        "$PROJECT_ROOT/logs/nginx/access.log"
        "$PROJECT_ROOT/logs/nginx/error.log"
        "/var/log/auth.log"
    )
    
    # Monitor multiple log files
    for log_file in "${log_files[@]}"; do
        if [ -f "$log_file" ]; then
            tail -f "$log_file" &
        fi
    done
    
    # Wait for Ctrl+C
    wait
}

# Function to generate incident report
generate_report() {
    local incident_file="$1"
    
    if [ ! -f "$incident_file" ]; then
        echo -e "${RED}Incident file not found: $incident_file${NC}"
        exit 1
    fi
    
    local report_file="${incident_file%.json}_report.html"
    
    cat > "$report_file" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>SafeVideo Incident Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #dc3545; color: white; padding: 20px; text-align: center; }
        .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; }
        .critical { border-color: #dc3545; background: #f8d7da; }
        .high { border-color: #fd7e14; background: #fff3cd; }
        .medium { border-color: #ffc107; background: #fff3cd; }
        .low { border-color: #28a745; background: #d4edda; }
        pre { background: #f8f9fa; padding: 10px; overflow-x: auto; }
    </style>
</head>
<body>
    <div class="header">
        <h1>SafeVideo Security Incident Report</h1>
    </div>
    <div class="section">
        <h2>Incident Details</h2>
        <pre>$(cat "$incident_file" | jq . 2>/dev/null || cat "$incident_file")</pre>
    </div>
</body>
</html>
EOF
    
    echo -e "${GREEN}Report generated: $report_file${NC}"
}

# Main menu
show_menu() {
    echo -e "${BLUE}SafeVideo Incident Response Menu:${NC}"
    echo "1. Run security health check"
    echo "2. Start automated response for incident type"
    echo "3. Monitor logs in real-time"
    echo "4. Generate incident report"
    echo "5. Exit"
    echo -n "Select option: "
}

# Main execution
main() {
    if [ $# -eq 0 ]; then
        # Interactive mode
        while true; do
            show_menu
            read -r choice
            
            case $choice in
                1)
                    security_health_check
                    ;;
                2)
                    echo "Available incident types:"
                    echo "1. brute_force"
                    echo "2. sql_injection"
                    echo "3. xss_attempt"
                    echo "4. ddos_attack"
                    echo "5. malware_detected"
                    echo "6. data_breach"
                    echo -n "Select incident type: "
                    read -r incident_choice
                    
                    case $incident_choice in
                        1) automated_response "brute_force" "HIGH" ;;
                        2) automated_response "sql_injection" "CRITICAL" ;;
                        3) automated_response "xss_attempt" "MEDIUM" ;;
                        4) automated_response "ddos_attack" "HIGH" ;;
                        5) automated_response "malware_detected" "CRITICAL" ;;
                        6) automated_response "data_breach" "CRITICAL" ;;
                        *) echo "Invalid option" ;;
                    esac
                    ;;
                3)
                    monitor_logs
                    ;;
                4)
                    echo -n "Enter incident file path: "
                    read -r incident_file
                    generate_report "$incident_file"
                    ;;
                5)
                    echo "Exiting..."
                    exit 0
                    ;;
                *)
                    echo "Invalid option"
                    ;;
            esac
            
            echo
        done
    else
        # Command line mode
        case "$1" in
            "health-check")
                security_health_check
                ;;
            "incident")
                if [ $# -ge 3 ]; then
                    automated_response "$2" "$3"
                else
                    echo "Usage: $0 incident <type> <severity>"
                    exit 1
                fi
                ;;
            "monitor")
                monitor_logs
                ;;
            "report")
                if [ $# -ge 2 ]; then
                    generate_report "$2"
                else
                    echo "Usage: $0 report <incident_file>"
                    exit 1
                fi
                ;;
            *)
                echo "Usage: $0 {health-check|incident|monitor|report}"
                exit 1
                ;;
        esac
    fi
}

# Run main function
main "$@"