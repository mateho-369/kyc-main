#!/bin/bash

# ==========================================
# SafeVideo Enhanced Monitoring Setup
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
MONITORING_DIR="$PROJECT_ROOT/monitoring"

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE}SafeVideo Enhanced Monitoring Setup${NC}"
echo -e "${BLUE}===========================================${NC}"

# Function to create directory structure
create_monitoring_structure() {
    echo -e "${YELLOW}Creating monitoring directory structure...${NC}"
    
    mkdir -p "$MONITORING_DIR"/{prometheus,grafana,alertmanager,alerts}
    mkdir -p "$MONITORING_DIR/grafana"/{dashboards,provisioning/dashboards,provisioning/datasources}
    mkdir -p "$MONITORING_DIR/prometheus"/{rules,targets}
    mkdir -p "$MONITORING_DIR/alertmanager"/{templates}
    
    echo -e "${GREEN}✓ Directory structure created${NC}"
}

# Function to create Prometheus configuration
create_prometheus_config() {
    echo -e "${YELLOW}Creating Prometheus configuration...${NC}"
    
    cat > "$MONITORING_DIR/prometheus/prometheus.yml" << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'safevideo-production'
    environment: 'prod'

# Alertmanager configuration
alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093

# Load rules once and periodically evaluate them
rule_files:
  - "rules/*.yml"

# Scrape configurations
scrape_configs:
  # Prometheus itself
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: /metrics
    scrape_interval: 30s

  # Node exporter (system metrics)
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
    scrape_interval: 15s

  # SafeVideo application servers
  - job_name: 'safevideo-blue'
    static_configs:
      - targets: ['server-blue:5000']
    metrics_path: /metrics
    scrape_interval: 15s
    params:
      environment: ['blue']

  - job_name: 'safevideo-green'
    static_configs:
      - targets: ['server-green:5000']
    metrics_path: /metrics
    scrape_interval: 15s
    params:
      environment: ['green']

  # HAProxy load balancer
  - job_name: 'haproxy'
    static_configs:
      - targets: ['load-balancer:8404']
    metrics_path: /stats/prometheus
    scrape_interval: 30s

  # MySQL database
  - job_name: 'mysql-master'
    static_configs:
      - targets: ['mysql-master:9104']
    scrape_interval: 30s

  - job_name: 'mysql-replica'
    static_configs:
      - targets: ['mysql-replica:9104']
    scrape_interval: 30s

  # Redis cluster
  - job_name: 'redis'
    static_configs:
      - targets: ['redis-cluster:9121']
    scrape_interval: 30s

  # Docker containers
  - job_name: 'docker'
    static_configs:
      - targets: ['docker-exporter:9323']
    scrape_interval: 30s

  # Nginx reverse proxy
  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx:9113']
    scrape_interval: 30s

  # Custom application metrics
  - job_name: 'safevideo-custom'
    static_configs:
      - targets: ['server-blue:5000', 'server-green:5000']
    metrics_path: /api/metrics
    scrape_interval: 30s
    basic_auth:
      username: 'metrics'
      password: 'secure_metrics_password'

# Remote write for long-term storage (optional)
# remote_write:
#   - url: "https://prometheus-remote-write-endpoint"
#     basic_auth:
#       username: "remote_user"
#       password: "remote_password"
EOF

    echo -e "${GREEN}✓ Prometheus configuration created${NC}"
}

# Function to create alerting rules
create_alerting_rules() {
    echo -e "${YELLOW}Creating alerting rules...${NC}"
    
    cat > "$MONITORING_DIR/prometheus/rules/safevideo-alerts.yml" << 'EOF'
groups:
  - name: safevideo.critical
    rules:
      # Application availability
      - alert: SafeVideoDown
        expr: up{job=~"safevideo-.*"} == 0
        for: 1m
        labels:
          severity: critical
          service: safevideo
        annotations:
          summary: "SafeVideo instance {{ $labels.instance }} is down"
          description: "SafeVideo instance {{ $labels.instance }} has been down for more than 1 minute."

      # High error rate
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.1
        for: 2m
        labels:
          severity: critical
          service: safevideo
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} for {{ $labels.instance }}"

      # Database connectivity
      - alert: DatabaseDown
        expr: up{job=~"mysql-.*"} == 0
        for: 30s
        labels:
          severity: critical
          service: database
        annotations:
          summary: "Database instance {{ $labels.instance }} is down"
          description: "MySQL instance {{ $labels.instance }} has been unreachable for more than 30 seconds."

      # Redis connectivity
      - alert: RedisDown
        expr: up{job="redis"} == 0
        for: 1m
        labels:
          severity: critical
          service: redis
        annotations:
          summary: "Redis instance is down"
          description: "Redis instance has been unreachable for more than 1 minute."

  - name: safevideo.warning
    rules:
      # High response time
      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
          service: safevideo
        annotations:
          summary: "High response time detected"
          description: "95th percentile response time is {{ $value }}s for {{ $labels.instance }}"

      # High CPU usage
      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
          service: infrastructure
        annotations:
          summary: "High CPU usage on {{ $labels.instance }}"
          description: "CPU usage is {{ $value }}% on {{ $labels.instance }}"

      # High memory usage
      - alert: HighMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 85
        for: 5m
        labels:
          severity: warning
          service: infrastructure
        annotations:
          summary: "High memory usage on {{ $labels.instance }}"
          description: "Memory usage is {{ $value }}% on {{ $labels.instance }}"

      # High disk usage
      - alert: HighDiskUsage
        expr: (1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)) * 100 > 85
        for: 5m
        labels:
          severity: warning
          service: infrastructure
        annotations:
          summary: "High disk usage on {{ $labels.instance }}"
          description: "Disk usage is {{ $value }}% on {{ $labels.instance }} for filesystem {{ $labels.mountpoint }}"

  - name: safevideo.security
    rules:
      # Multiple failed login attempts
      - alert: MultipleFailedLogins
        expr: increase(failed_login_attempts_total[5m]) > 10
        for: 1m
        labels:
          severity: warning
          service: security
        annotations:
          summary: "Multiple failed login attempts detected"
          description: "{{ $value }} failed login attempts in the last 5 minutes from {{ $labels.source_ip }}"

      # Suspicious activity
      - alert: SuspiciousActivity
        expr: increase(security_events_total{event_type="suspicious"}[5m]) > 5
        for: 1m
        labels:
          severity: warning
          service: security
        annotations:
          summary: "Suspicious activity detected"
          description: "{{ $value }} suspicious events detected in the last 5 minutes"

  - name: safevideo.business
    rules:
      # Low upload success rate
      - alert: LowUploadSuccessRate
        expr: rate(document_uploads_total{status="success"}[5m]) / rate(document_uploads_total[5m]) < 0.9
        for: 5m
        labels:
          severity: warning
          service: business
        annotations:
          summary: "Low document upload success rate"
          description: "Upload success rate is {{ $value | humanizePercentage }}"

      # High verification queue
      - alert: HighVerificationQueue
        expr: verification_queue_size > 100
        for: 10m
        labels:
          severity: warning
          service: business
        annotations:
          summary: "High verification queue size"
          description: "Verification queue has {{ $value }} pending items"
EOF

    echo -e "${GREEN}✓ Alerting rules created${NC}"
}

# Function to create Alertmanager configuration
create_alertmanager_config() {
    echo -e "${YELLOW}Creating Alertmanager configuration...${NC}"
    
    cat > "$MONITORING_DIR/alertmanager/alertmanager.yml" << 'EOF'
global:
  smtp_smarthost: 'localhost:587'
  smtp_from: 'REPLACE_WITH_ACTUAL_ADDRESS'
  smtp_auth_username: 'REPLACE_WITH_ACTUAL_ADDRESS'
  smtp_auth_password: 'smtp_password'

# Templates for custom alert formats
templates:
  - '/etc/alertmanager/templates/*.tmpl'

# Routing tree
route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'default'
  routes:
    # Critical alerts go to multiple channels
    - match:
        severity: critical
      receiver: 'critical-alerts'
      group_wait: 5s
      repeat_interval: 30m

    # Security alerts
    - match:
        service: security
      receiver: 'security-team'
      group_wait: 5s
      repeat_interval: 15m

    # Business alerts
    - match:
        service: business
      receiver: 'business-team'
      repeat_interval: 2h

    # Infrastructure alerts
    - match:
        service: infrastructure
      receiver: 'devops-team'
      repeat_interval: 1h

# Alert receivers
receivers:
  - name: 'default'
    slack_configs:
      - api_url: '${SLACK_WEBHOOK_URL}'
        channel: '#alerts'
        title: 'SafeVideo Alert'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

  - name: 'critical-alerts'
    slack_configs:
      - api_url: '${SLACK_WEBHOOK_URL}'
        channel: '#critical-alerts'
        title: 'CRITICAL: SafeVideo Alert'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
        color: 'danger'
    email_configs:
      - to: 'REPLACE_WITH_ACTUAL_ADDRESS'
        subject: 'CRITICAL: SafeVideo Alert'
        body: |
          {{ range .Alerts }}
          Alert: {{ .Annotations.summary }}
          Description: {{ .Annotations.description }}
          Instance: {{ .Labels.instance }}
          Severity: {{ .Labels.severity }}
          {{ end }}

  - name: 'security-team'
    slack_configs:
      - api_url: '${SLACK_WEBHOOK_URL}'
        channel: '#security-alerts'
        title: 'Security Alert'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
        color: 'warning'
    email_configs:
      - to: 'REPLACE_WITH_ACTUAL_ADDRESS'
        subject: 'Security Alert - SafeVideo'

  - name: 'business-team'
    slack_configs:
      - api_url: '${SLACK_WEBHOOK_URL}'
        channel: '#business-alerts'
        title: 'Business Metric Alert'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

  - name: 'devops-team'
    slack_configs:
      - api_url: '${SLACK_WEBHOOK_URL}'
        channel: '#devops-alerts'
        title: 'Infrastructure Alert'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

# Inhibition rules
inhibit_rules:
  # Inhibit warning alerts if critical alert is firing
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'instance']

  # Inhibit high CPU if the instance is down
  - source_match:
      alertname: 'SafeVideoDown'
    target_match:
      alertname: 'HighCPUUsage'
    equal: ['instance']
EOF

    echo -e "${GREEN}✓ Alertmanager configuration created${NC}"
}

# Function to create Grafana datasource configuration
create_grafana_datasources() {
    echo -e "${YELLOW}Creating Grafana datasource configuration...${NC}"
    
    cat > "$MONITORING_DIR/grafana/provisioning/datasources/prometheus.yml" << 'EOF'
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
    jsonData:
      timeInterval: 15s
      queryTimeout: 60s
      httpMethod: GET
    secureJsonData:
      # Add authentication if needed
EOF

    echo -e "${GREEN}✓ Grafana datasources created${NC}"
}

# Function to create Grafana dashboard configuration
create_grafana_dashboards() {
    echo -e "${YELLOW}Creating Grafana dashboard configuration...${NC}"
    
    cat > "$MONITORING_DIR/grafana/provisioning/dashboards/dashboards.yml" << 'EOF'
apiVersion: 1

providers:
  - name: 'SafeVideo Dashboards'
    orgId: 1
    folder: 'SafeVideo'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /etc/grafana/dashboards
EOF

    echo -e "${GREEN}✓ Grafana dashboard configuration created${NC}"
}

# Function to create custom Grafana dashboard
create_safevideo_dashboard() {
    echo -e "${YELLOW}Creating SafeVideo main dashboard...${NC}"
    
    cat > "$MONITORING_DIR/grafana/dashboards/safevideo-main.json" << 'EOF'
{
  "annotations": {
    "list": [
      {
        "builtIn": 1,
        "datasource": "-- Grafana --",
        "enable": true,
        "hide": true,
        "iconColor": "rgba(0, 211, 255, 1)",
        "name": "Annotations & Alerts",
        "type": "dashboard"
      }
    ]
  },
  "editable": true,
  "gnetId": null,
  "graphTooltip": 0,
  "id": null,
  "links": [],
  "panels": [
    {
      "datasource": "Prometheus",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "drawStyle": "line",
            "fillOpacity": 10,
            "gradientMode": "none",
            "hideFrom": {
              "legend": false,
              "tooltip": false,
              "vis": false
            },
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "never",
            "spanNulls": false,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "red",
                "value": 80
              }
            ]
          },
          "unit": "reqps"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 0,
        "y": 0
      },
      "id": 1,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom"
        },
        "tooltip": {
          "mode": "single"
        }
      },
      "targets": [
        {
          "expr": "sum(rate(http_requests_total[5m])) by (instance)",
          "interval": "",
          "legendFormat": "{{instance}}",
          "refId": "A"
        }
      ],
      "title": "Request Rate",
      "type": "timeseries"
    },
    {
      "datasource": "Prometheus",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "red",
                "value": 1
              }
            ]
          },
          "unit": "percent"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 12,
        "y": 0
      },
      "id": 2,
      "options": {
        "orientation": "auto",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "showThresholdLabels": false,
        "showThresholdMarkers": true,
        "text": {}
      },
      "pluginVersion": "8.0.0",
      "targets": [
        {
          "expr": "rate(http_requests_total{status=~\"5..\"}[5m]) / rate(http_requests_total[5m]) * 100",
          "interval": "",
          "legendFormat": "Error Rate",
          "refId": "A"
        }
      ],
      "title": "Error Rate",
      "type": "gauge"
    },
    {
      "datasource": "Prometheus",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "drawStyle": "line",
            "fillOpacity": 10,
            "gradientMode": "none",
            "hideFrom": {
              "legend": false,
              "tooltip": false,
              "vis": false
            },
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "never",
            "spanNulls": false,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "red",
                "value": 80
              }
            ]
          },
          "unit": "s"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 8,
        "w": 24,
        "x": 0,
        "y": 8
      },
      "id": 3,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom"
        },
        "tooltip": {
          "mode": "single"
        }
      },
      "targets": [
        {
          "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, instance))",
          "interval": "",
          "legendFormat": "95th percentile - {{instance}}",
          "refId": "A"
        },
        {
          "expr": "histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, instance))",
          "interval": "",
          "legendFormat": "50th percentile - {{instance}}",
          "refId": "B"
        }
      ],
      "title": "Response Time",
      "type": "timeseries"
    }
  ],
  "refresh": "30s",
  "schemaVersion": 27,
  "style": "dark",
  "tags": [
    "safevideo",
    "monitoring"
  ],
  "templating": {
    "list": []
  },
  "time": {
    "from": "now-1h",
    "to": "now"
  },
  "timepicker": {},
  "timezone": "",
  "title": "SafeVideo Main Dashboard",
  "uid": "safevideo-main",
  "version": 1
}
EOF

    echo -e "${GREEN}✓ SafeVideo main dashboard created${NC}"
}

# Function to create deployment monitoring script
create_deployment_monitor() {
    echo -e "${YELLOW}Creating deployment monitoring script...${NC}"
    
    cat > "$MONITORING_DIR/deployment-monitor.sh" << 'EOF'
#!/bin/bash

# Deployment monitoring script
# This script checks the health of a deployment and can be used for automated rollback

set -euo pipefail

ENVIRONMENT="${1:-blue}"
TIMEOUT="${2:-300}"
CHECKS_INTERVAL=10

echo "Monitoring deployment to $ENVIRONMENT environment..."

start_time=$(date +%s)
end_time=$((start_time + TIMEOUT))

while [ $(date +%s) -lt $end_time ]; do
    # Check service health
    if curl -s "http://localhost/api/health" | grep -q "ok"; then
        # Check error rate
        error_rate=$(curl -s "http://prometheus:9090/api/v1/query?query=rate(http_requests_total{status=~\"5..\"}[5m])/rate(http_requests_total[5m])" | jq -r '.data.result[0].value[1] // "0"')
        
        if (( $(echo "$error_rate < 0.01" | bc -l) )); then
            echo "Deployment successful! Error rate: $error_rate"
            exit 0
        else
            echo "High error rate detected: $error_rate"
        fi
    else
        echo "Health check failed"
    fi
    
    echo "Waiting... ($(date))"
    sleep $CHECKS_INTERVAL
done

echo "Deployment monitoring timeout reached"
exit 1
EOF

    chmod +x "$MONITORING_DIR/deployment-monitor.sh"
    echo -e "${GREEN}✓ Deployment monitoring script created${NC}"
}

# Main function
main() {
    echo -e "${GREEN}Setting up enhanced monitoring for SafeVideo...${NC}"
    
    create_monitoring_structure
    create_prometheus_config
    create_alerting_rules
    create_alertmanager_config
    create_grafana_datasources
    create_grafana_dashboards
    create_safevideo_dashboard
    create_deployment_monitor
    
    echo -e "${GREEN}===========================================${NC}"
    echo -e "${GREEN}Enhanced monitoring setup completed!${NC}"
    echo -e "${GREEN}===========================================${NC}"
    echo -e "${BLUE}Configuration files created in: $MONITORING_DIR${NC}"
    echo -e "${BLUE}Don't forget to:${NC}"
    echo -e "${BLUE}1. Configure SLACK_WEBHOOK_URL in alertmanager.yml${NC}"
    echo -e "${BLUE}2. Update email settings in alertmanager.yml${NC}"
    echo -e "${BLUE}3. Customize alert thresholds as needed${NC}"
    echo -e "${BLUE}4. Deploy the monitoring stack with docker-compose${NC}"
}

# Run main function
main "$@"