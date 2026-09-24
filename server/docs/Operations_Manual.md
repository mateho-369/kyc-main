# SafeVideo運用手順書

> **注記（2026-09-08 時点）**
> 本書に記載の監視スタック（Prometheus / Grafana / Alertmanager 等）および
> 通知連携は、現在の本番環境には導入されていません。本書はそれらを構築する場合の
> 手順として扱ってください。現状の運用可視性は PM2 のプロセス状態とログファイルのみです。

## 目次
1. [日常運用](#日常運用)
2. [定期メンテナンス](#定期メンテナンス)
3. [バックアップとリストア](#バックアップとリストア)
4. [監視とアラート](#監視とアラート)
5. [スケーリング](#スケーリング)
6. [セキュリティ運用](#セキュリティ運用)
7. [災害復旧](#災害復旧)
8. [運用チェックリスト](#運用チェックリスト)

## 日常運用

### 1. システム起動・停止

#### サービス起動手順
```bash
# 1. 依存サービス確認
sudo systemctl status mysql
sudo systemctl status redis

# 2. アプリケーション起動
cd /opt/safevideo
pm2 start ecosystem.config.js

# 3. 起動確認
pm2 status
curl http://localhost:3000/api/integration/health
```

#### 安全な停止手順
```bash
# 1. メンテナンスモード有効化
redis-cli set "maintenance:enabled" "true"

# 2. 処理中のジョブ完了待機
npm run jobs:wait

# 3. グレースフル停止
pm2 stop safevideo-api --wait-ready

# 4. 確認
pm2 status
```

### 2. ログ管理

#### ログローテーション設定
```bash
# /etc/logrotate.d/safevideo
/var/log/safevideo/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0644 safevideo safevideo
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

#### ログ監視コマンド
```bash
# リアルタイムログ監視
pm2 logs safevideo-api --lines 100

# エラーログ抽出
grep ERROR /var/log/safevideo/app.log | tail -50

# 特定期間のログ検索
journalctl -u safevideo --since "2024-01-01" --until "2024-01-02"
```

### 3. パフォーマンス監視

#### CPU/メモリ使用率
```bash
# PM2モニター
pm2 monit

# システム全体
htop

# プロセス別詳細
ps aux | grep node | awk '{print $2, $3, $4, $11}'
```

#### データベース監視
```sql
-- アクティブな接続数
SHOW PROCESSLIST;

-- スロークエリ
SELECT * FROM mysql.slow_log 
WHERE query_time > 1 
ORDER BY query_time DESC;

-- テーブルサイズ
SELECT 
    table_name AS 'Table',
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS 'Size (MB)'
FROM information_schema.TABLES 
WHERE table_schema = 'safevideo'
ORDER BY (data_length + index_length) DESC;
```

## 定期メンテナンス

### 週次メンテナンス

#### 1. パフォーマンス分析
```bash
# 週次レポート生成
npm run report:weekly

# キャッシュヒット率確認
redis-cli info stats | grep hit
```

#### 2. ディスク容量確認
```bash
# ディスク使用状況
df -h

# 大容量ファイル検索
find /var/log -type f -size +100M -exec ls -lh {} \;

# 古いログファイル削除
find /var/log/safevideo -name "*.log" -mtime +30 -delete
```

### 月次メンテナンス

#### 1. データベース最適化
```sql
-- テーブル最適化
OPTIMIZE TABLE users, performers, kyc_requests;

-- インデックス統計更新
ANALYZE TABLE users, performers, kyc_requests;

-- 断片化確認
SELECT 
    table_name,
    data_free / 1024 / 1024 AS free_mb
FROM information_schema.tables
WHERE table_schema = 'safevideo'
    AND data_free > 100 * 1024 * 1024;
```

#### 2. セキュリティパッチ適用
```bash
# システムアップデート確認
sudo apt update
sudo apt list --upgradable

# Node.js依存関係更新
npm audit
npm audit fix

# 計画的アップデート
npm update --save
```

### 四半期メンテナンス

#### 1. SSL証明書更新
```bash
# 証明書有効期限確認
openssl x509 -in /etc/ssl/certs/safevideo.crt -noout -dates

# Let's Encrypt更新
certbot renew --dry-run
certbot renew
```

#### 2. 容量計画見直し
```bash
# 成長率分析
npm run analytics:growth

# リソース使用予測
npm run forecast:resources
```

## バックアップとリストア

### 自動バックアップ設定

#### データベースバックアップ
```bash
#!/bin/bash
# /opt/safevideo/scripts/backup-db.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/mysql"
DB_NAME="safevideo"

# バックアップ実行
mysqldump -u backup_user -p${DB_PASSWORD} \
    --single-transaction \
    --routines \
    --triggers \
    --databases ${DB_NAME} | gzip > ${BACKUP_DIR}/db_${DATE}.sql.gz

# 古いバックアップ削除（30日以上）
find ${BACKUP_DIR} -name "db_*.sql.gz" -mtime +30 -delete

# S3アップロード
aws s3 cp ${BACKUP_DIR}/db_${DATE}.sql.gz s3://safevideo-backups/mysql/
```

#### アプリケーションバックアップ
```bash
#!/bin/bash
# /opt/safevideo/scripts/backup-app.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/app"

# 設定ファイルバックアップ
tar -czf ${BACKUP_DIR}/config_${DATE}.tar.gz \
    /opt/safevideo/.env \
    /opt/safevideo/ecosystem.config.js \
    /etc/nginx/sites-available/safevideo

# アップロードファイルバックアップ
tar -czf ${BACKUP_DIR}/uploads_${DATE}.tar.gz \
    /opt/safevideo/uploads/

# S3同期
aws s3 sync ${BACKUP_DIR} s3://safevideo-backups/app/
```

### リストア手順

#### データベースリストア
```bash
# 1. バックアップファイル取得
aws s3 cp s3://safevideo-backups/mysql/db_20240101_120000.sql.gz /tmp/

# 2. 解凍
gunzip /tmp/db_20240101_120000.sql.gz

# 3. リストア
mysql -u root -p < /tmp/db_20240101_120000.sql

# 4. 権限再設定
mysql -u root -p -e "FLUSH PRIVILEGES;"
```

#### ポイントインタイムリカバリ
```sql
-- バイナリログ位置確認
SHOW MASTER STATUS;

-- 特定時点までリストア
mysqlbinlog --stop-datetime="2024-01-01 12:00:00" \
    /var/log/mysql/mysql-bin.000001 | mysql -u root -p
```

## 監視とアラート

### 監視項目設定

#### Prometheus設定
```yaml
# /etc/prometheus/prometheus.yml
scrape_configs:
  - job_name: 'safevideo'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    
  - job_name: 'node_exporter'
    static_configs:
      - targets: ['localhost:9100']
```

#### アラートルール
```yaml
# /etc/prometheus/alert.rules.yml
groups:
  - name: safevideo
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          
      - alert: DatabaseConnectionFailure
        expr: mysql_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "MySQL connection lost"
          
      - alert: HighMemoryUsage
        expr: (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.9
        for: 5m
        labels:
          severity: warning
```

### 通知設定

#### Slack通知
```javascript
// /opt/safevideo/config/alerts.js
const alertConfig = {
  slack: {
    webhook: process.env.SLACK_WEBHOOK_URL,
    channel: '#safevideo-alerts',
    username: 'SafeVideo Monitor'
  },
  thresholds: {
    errorRate: 0.05,
    responseTime: 1000,
    cpuUsage: 80,
    memoryUsage: 85,
    diskUsage: 90
  }
};
```

## スケーリング

### 水平スケーリング

#### PM2クラスター設定
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'safevideo-api',
    script: './server.js',
    instances: 'max', // CPUコア数に応じて自動設定
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

#### ロードバランサー設定
```nginx
# /etc/nginx/sites-available/safevideo
upstream safevideo_backend {
    least_conn;
    server 127.0.0.1:3001 weight=1 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3002 weight=1 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3003 weight=1 max_fails=3 fail_timeout=30s;
    keepalive 32;
}
```

### 垂直スケーリング

#### リソース追加手順
1. **メンテナンスウィンドウ設定**
   ```bash
   redis-cli set "maintenance:window" "2024-01-01 02:00:00"
   ```

2. **スナップショット作成**
   ```bash
   aws ec2 create-snapshot --volume-id vol-xxxxx
   ```

3. **インスタンスタイプ変更**
   ```bash
   aws ec2 modify-instance-attribute --instance-id i-xxxxx --instance-type t3.xlarge
   ```

## セキュリティ運用

### 定期セキュリティ監査

#### 脆弱性スキャン
```bash
# Node.js依存関係
npm audit

# システムパッケージ
sudo apt update && sudo apt list --upgradable

# ポートスキャン
nmap -sS -p- localhost
```

#### ログ監査
```bash
# 不正アクセス試行
grep "401\|403" /var/log/nginx/access.log | awk '{print $1}' | sort | uniq -c | sort -nr

# SQLインジェクション試行
grep -i "union\|select\|drop" /var/log/safevideo/app.log

# ブルートフォース検知
grep "Failed login" /var/log/safevideo/audit.log | awk '{print $5}' | sort | uniq -c | sort -nr
```

### アクセス管理

#### APIキー管理
```bash
# 期限切れキー無効化
npm run keys:expire

# 使用状況確認
npm run keys:usage --days=30

# 新規キー発行
npm run keys:generate --user=REPLACE_WITH_ACTUAL_ADDRESS
```

## 災害復旧

### RTO/RPO目標
- **RTO (Recovery Time Objective)**: 4時間
- **RPO (Recovery Point Objective)**: 1時間

### 災害復旧手順

#### 1. 初期評価
```bash
# システム状態確認
./scripts/dr-check.sh

# バックアップ確認
aws s3 ls s3://safevideo-backups/ --recursive | tail -20
```

#### 2. 代替環境起動
```bash
# DR環境起動
terraform apply -var-file=dr.tfvars

# データリストア
./scripts/dr-restore.sh --latest

# DNS切り替え
aws route53 change-resource-record-sets --hosted-zone-id Z123456 --change-batch file://dr-dns.json
```

#### 3. サービス検証
```bash
# ヘルスチェック
curl https://dr.safevideo.com/api/integration/health

# 機能テスト
npm run test:dr
```

## 運用チェックリスト

### 日次チェック
- [ ] システムヘルスチェック
- [ ] エラーログ確認
- [ ] ディスク容量確認（>20%空き）
- [ ] バックアップ完了確認
- [ ] アラート対応

### 週次チェック
- [ ] パフォーマンスレポート確認
- [ ] セキュリティログ監査
- [ ] 未処理ジョブ確認
- [ ] キャッシュ効率確認
- [ ] アップデート確認

### 月次チェック
- [ ] データベース最適化
- [ ] SSL証明書有効期限確認
- [ ] 容量予測レポート
- [ ] SLA達成率確認
- [ ] インシデントレビュー

### 緊急時連絡先
- **システム管理者**: +81-xxx-xxx-xxxx
- **開発責任者**: +81-xxx-xxx-xxxx
- **Sharegram API**: +1-xxx-xxx-xxxx
- **AWS サポート**: ケース番号: xxx-xxx-xxx