#!/bin/bash

# カナリア監視スクリプト
# 使用方法: ./monitor-canary.sh [監視時間（秒）]

DURATION=${1:-1800}  # デフォルト30分
INTERVAL=60  # 60秒ごとにチェック
ERROR_THRESHOLD=5  # エラー率閾値（%）

START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION))

echo "カナリア監視を開始します（${DURATION}秒間）"

while [ $(date +%s) -lt $END_TIME ]; do
    # メトリクスを収集
    ERROR_RATE=$(curl -s http://localhost:9090/api/v1/query?query=rate\(http_requests_total\{status=~\"5..\"\}\[5m\]\) | jq -r '.data.result[0].value[1]' || echo "0")
    RESPONSE_TIME=$(curl -s http://localhost:9090/api/v1/query?query=http_request_duration_seconds | jq -r '.data.result[0].value[1]' || echo "0")
    
    # しきい値チェック
    if (( $(echo "$ERROR_RATE > $ERROR_THRESHOLD" | bc -l) )); then
        echo "ERROR: エラー率が閾値を超えました: ${ERROR_RATE}%"
        exit 1
    fi
    
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] エラー率: ${ERROR_RATE}%, 応答時間: ${RESPONSE_TIME}s"
    
    sleep $INTERVAL
done

echo "カナリア監視が正常に完了しました"