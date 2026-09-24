# SafeVideo監視システムセットアップガイド

> **注記（2026-09-08 時点）**
> 本書に記載の監視スタック（Prometheus / Grafana / Alertmanager 等）および
> 通知連携は、現在の本番環境には導入されていません。本書はそれらを構築する場合の
> 手順として扱ってください。現状の運用可視性は PM2 のプロセス状態とログファイルのみです。

## 概要
このガイドでは、SafeVideo KYCシステムの監視環境をセットアップする手順を説明します。

## 必要なコンポーネント

1. **Prometheus** - メトリクス収集
2. **Grafana** - 可視化
3. **Alertmanager** - アラート管理

## 1. Prometheusセットアップ

### インストール
```bash
# Docker Composeを使用する場合
docker-compose up -d prometheus
```

### 設定ファイル (prometheus.yml)
```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alerts.yaml"

scrape_configs:
  - job_name: 'safevideo'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
```

## 2. アプリケーション統合

### server.jsへの追加
```javascript
const { 
  prometheusMiddleware, 
  createMetricsEndpoint, 
  startMetricsCollection 
} = require('./monitoring/prometheus-metrics');

// Prometheusミドルウェアを追加
app.use(prometheusMiddleware());

// メトリクスエンドポイントを追加
app.use(createMetricsEndpoint());

// メトリクス収集を開始
startMetricsCollection();
```

### 使用例
```javascript
const { MetricsCollector } = require('./monitoring/prometheus-metrics');
const collector = new MetricsCollector();

// Sharegram API呼び出しを記録
const startTime = Date.now();
try {
  const result = await sharegramAPI.call();
  collector.recordSharegramApiCall('POST', '/api/performers', 'success', (Date.now() - startTime) / 1000);
} catch (error) {
  collector.recordSharegramApiCall('POST', '/api/performers', 'failed', (Date.now() - startTime) / 1000);
}

// KYC検証を記録
collector.recordKycVerification('verified', 'full', 'sharegram', 45.2);

// エラーを記録
collector.recordError('authentication', 'critical', 'api');
```

## 3. Grafanaダッシュボード

### インポート手順
1. Grafanaにログイン
2. 左メニューから「+ → Import」を選択
3. `grafana-dashboard.json`をアップロード
4. データソースとして「Prometheus」を選択
5. 「Import」をクリック

### ダッシュボードの内容
- **Sharegram Integration Monitoring**: API呼び出し、エラー率、応答時間
- **KYC Monitoring**: 検証状況、期限切れ警告、処理時間
- **System Performance**: APIパフォーマンス、同時接続数、DB接続プール
- **Webhook Monitoring**: 配信率、遅延、リトライ状況

## 4. アラート設定

### Alertmanager設定 (alertmanager.yml)
```yaml
global:
  resolve_timeout: 5m
  slack_api_url: 'YOUR_SLACK_WEBHOOK_URL'

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h
  receiver: 'team-X-mails'
  
  routes:
  - match:
      severity: critical
    receiver: pagerduty-critical
    
  - match:
      team: security
    receiver: security-team

receivers:
- name: 'team-X-mails'
  email_configs:
  - to: 'team-X+alerts@example.org'

- name: 'pagerduty-critical'
  pagerduty_configs:
  - service_key: YOUR_PAGERDUTY_KEY

- name: 'security-team'
  slack_configs:
  - channel: '#security-alerts'
```

## 5. 重要なメトリクス

### Sharegram統合
- `sharegram_api_calls_total`: API呼び出し総数
- `sharegram_api_duration_seconds`: API応答時間
- `sharegram_sync_status`: 同期ステータス（0=停止, 1=稼働中）

### KYC
- `kyc_verifications_total`: KYC検証総数
- `kyc_performers_by_status`: ステータス別Performer数
- `kyc_expiration_warnings`: KYC期限切れ警告

### システム
- `api_requests_total`: API呼び出し総数
- `api_request_duration_seconds`: API応答時間
- `errors_total`: エラー総数
- `database_connection_pool_size`: DB接続プール状態

## 6. トラブルシューティング

### メトリクスが表示されない場合
1. `/metrics`エンドポイントにアクセスして確認
2. Prometheusのtargetsページで接続状態を確認
3. アプリケーションログでエラーを確認

### アラートが発火しない場合
1. Prometheusのalerts画面で状態を確認
2. Alertmanagerのログを確認
3. 通知先の設定を確認

## 7. パフォーマンスチューニング

### メトリクス収集の最適化
```javascript
// 高頻度メトリクスはサンプリングを使用
if (Math.random() < 0.1) { // 10%サンプリング
  collector.recordApiRequest(method, route, statusCode, duration);
}
```

### 保持期間の設定
```yaml
# prometheus.yml
global:
  external_labels:
    monitor: 'safevideo'
storage:
  tsdb:
    retention.time: 30d
    retention.size: 50GB
```

## 8. セキュリティ考慮事項

1. メトリクスエンドポイントへのアクセス制限
```javascript
app.use('/metrics', requireInternalNetwork, createMetricsEndpoint());
```

2. 機密情報の除外
- APIキーやトークンをメトリクスに含めない
- 個人情報をラベルに使用しない

3. TLS/SSL設定
- PrometheusとGrafana間の通信を暗号化
- 外部からのアクセスにはVPNを使用

## 9. 定期メンテナンス

### 週次タスク
- アラート設定の見直し
- ダッシュボードの更新
- メトリクスの使用状況確認

### 月次タスク
- 保持データのクリーンアップ
- パフォーマンス分析
- アラート閾値の調整

## 10. 連絡先

- 監視チーム: REPLACE_WITH_ACTUAL_ADDRESS
- 緊急連絡先: +81-XXX-XXXX-XXXX
- Wiki: https://wiki.safevideo.com/monitoring