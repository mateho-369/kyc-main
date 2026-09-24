#!/bin/bash

# カナリアトラフィック設定スクリプト
# 使用方法: ./configure-canary-traffic.sh [パーセント]

PERCENTAGE=${1:-10}

echo "カナリアトラフィックを${PERCENTAGE}%に設定しています..."

# HAProxyまたはNginxの設定を更新する例
# 実際の実装は使用するロードバランサーに依存します

cat > /tmp/canary-nginx.conf << EOF
upstream backend {
    # 新バージョン (${PERCENTAGE}%のトラフィック)
    server localhost:5002 weight=$((PERCENTAGE));
    
    # 旧バージョン (残りのトラフィック)
    server localhost:5003 weight=$((100 - PERCENTAGE));
}
EOF

# Nginxの設定を更新（実際の環境に合わせて調整）
# docker exec safevideo_nginx_1 nginx -s reload

echo "カナリアトラフィックの設定が完了しました"