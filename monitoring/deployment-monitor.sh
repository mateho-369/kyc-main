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
