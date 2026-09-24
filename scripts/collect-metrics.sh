#!/bin/bash

# メトリクス収集スクリプト

LOG_DIR="/var/log/safevideo/metrics"
mkdir -p $LOG_DIR

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
METRICS_FILE="$LOG_DIR/metrics-${TIMESTAMP}.json"

echo "メトリクス収集を開始しています..."

# システムメトリクス
SYSTEM_METRICS=$(cat <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "system": {
    "cpu_usage": $(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}'),
    "memory_usage": $(free | grep Mem | awk '{print ($3/$2) * 100.0}'),
    "disk_usage": $(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
  }
}
EOF
)

# Dockerコンテナメトリクス
CONTAINER_METRICS=$(docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | tail -n +2)

# APIメトリクス
API_METRICS=$(curl -s http://localhost:5002/api/metrics || echo "{}")

# すべてのメトリクスを結合
cat > "$METRICS_FILE" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "system": $(echo "$SYSTEM_METRICS" | jq -c '.system'),
  "containers": "$CONTAINER_METRICS",
  "api": $API_METRICS
}
EOF

echo "メトリクスを保存しました: $METRICS_FILE"

# Prometheusにメトリクスを送信（設定されている場合）
if [[ -n "$PROMETHEUS_PUSHGATEWAY_URL" ]]; then
    curl -X POST -H "Content-Type: application/json" \
        -d @"$METRICS_FILE" \
        "$PROMETHEUS_PUSHGATEWAY_URL/metrics/job/safevideo-deploy"
fi