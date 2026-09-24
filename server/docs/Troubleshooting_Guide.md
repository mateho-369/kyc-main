# トラブルシューティングガイド

## 目次
1. [接続関連の問題](#接続関連の問題)
2. [認証・SSO関連](#認証sso関連)
3. [KYC検証の問題](#kyc検証の問題)
4. [データ同期エラー](#データ同期エラー)
5. [パフォーマンス問題](#パフォーマンス問題)
6. [エラーコード一覧](#エラーコード一覧)
7. [緊急時対応](#緊急時対応)

## 接続関連の問題

### 問題: Sharegram APIに接続できない

#### 症状
- `ECONNREFUSED`エラー
- タイムアウトエラー
- 503 Service Unavailable

#### 確認事項
1. **ネットワーク接続**
   ```bash
   # Sharegram APIへの疎通確認
   curl -I https://api.sharegram.com/v1/health
   ```

2. **API認証情報**
   ```bash
   # 環境変数確認
   echo $SHAREGRAM_API_KEY
   echo $SHAREGRAM_SECRET_KEY
   ```

3. **SSL証明書**
   ```bash
   # 証明書の有効性確認
   openssl s_client -connect api.sharegram.com:443 -servername api.sharegram.com
   ```

#### 解決方法
1. **ファイアウォール設定**
   ```bash
   # アウトバウンド443ポートを開放
   sudo ufw allow out 443/tcp
   ```

2. **DNSキャッシュクリア**
   ```bash
   # Linux/Mac
   sudo dscacheutil -flushcache
   
   # または
   sudo systemctl restart systemd-resolved
   ```

3. **リトライ設定調整**
   ```javascript
   // recoveryService設定
   {
     maxRetries: 5,
     initialDelay: 2000,
     maxDelay: 60000,
     backoffMultiplier: 2
   }
   ```

### 問題: Webhook受信できない

#### 症状
- Sharegram管理画面でWebhook失敗
- イベントが届かない

#### 確認事項
1. **エンドポイントの公開状態**
   ```bash
   curl -X POST https://your-domain.com/webhooks/sharegram \
     -H "Content-Type: application/json" \
     -d '{"test": true}'
   ```

2. **署名検証**
   ```javascript
   // ログで署名確認
   grep "Webhook signature" /var/log/safevideo/app.log
   ```

#### 解決方法
1. **Webhook URLの再登録**
   ```bash
   npm run webhook:register
   ```

2. **署名シークレットの更新**
   ```bash
   # .envファイル更新
   SHAREGRAM_WEBHOOK_SECRET=new_secret_here
   
   # アプリケーション再起動
   pm2 restart safevideo-api
   ```

## 認証・SSO関連

### 問題: SSO ログインが失敗する

#### 症状
- "Invalid token"エラー
- リダイレクトループ
- セッション作成失敗

#### 確認事項
1. **JWKSエンドポイント**
   ```bash
   curl https://api.sharegram.com/.well-known/jwks.json
   ```

2. **トークンの有効性**
   ```javascript
   // JWTデコード（検証なし）
   const decoded = jwt.decode(token, { complete: true });
   console.log(decoded);
   ```

3. **Redis接続**
   ```bash
   redis-cli -n 2 ping
   ```

#### 解決方法
1. **JWKS URIの更新**
   ```bash
   SHAREGRAM_JWKS_URI=https://api.sharegram.com/.well-known/jwks.json
   ```

2. **時刻同期**
   ```bash
   # NTP同期
   sudo ntpdate -s time.nist.gov
   ```

3. **セッションクリア**
   ```bash
   # Redis内の全SSOセッションクリア
   redis-cli -n 2 --scan --pattern "sso:*" | xargs redis-cli -n 2 del
   ```

### 問題: ユーザーマッピングエラー

#### 症状
- 重複ユーザーエラー
- プロフィール情報不一致

#### 解決方法
1. **重複アカウント統合**
   ```sql
   -- 重複確認
   SELECT email, COUNT(*) 
   FROM users 
   GROUP BY email 
   HAVING COUNT(*) > 1;
   ```

2. **手動マッピング**
   ```javascript
   POST /api/v1/admin/users/merge
   {
     "primaryUserId": 123,
     "duplicateUserIds": [456, 789]
   }
   ```

## KYC検証の問題

### 問題: KYC検証がタイムアウトする

#### 症状
- 30秒以上レスポンスなし
- `ETIMEDOUT`エラー

#### 確認事項
1. **ファイルサイズ**
   ```bash
   # アップロード制限確認
   grep upload_max_filesize /etc/php/php.ini
   ```

2. **メモリ使用量**
   ```bash
   # Node.jsヒープサイズ
   node --max-old-space-size=4096 server.js
   ```

#### 解決方法
1. **画像最適化**
   ```javascript
   // 画像リサイズ設定
   const sharp = require('sharp');
   
   await sharp(inputBuffer)
     .resize(1920, 1080, { fit: 'inside' })
     .jpeg({ quality: 85 })
     .toBuffer();
   ```

2. **非同期処理**
   ```javascript
   // バックグラウンドジョブとして処理
   await BatchJob.create({
     jobType: 'kyc_verification',
     parameters: { kycRequestId },
     priority: 'high'
   });
   ```

### 問題: KYC結果が同期されない

#### 症状
- Sharegramで承認済みだがSafeVideoで未反映
- ステータス不一致

#### 解決方法
1. **手動同期トリガー**
   ```bash
   npm run kyc:sync --requestId=123
   ```

2. **Webhook再送信要求**
   ```javascript
   POST /api/v1/admin/kyc/resync
   {
     "requestIds": [123, 456, 789]
   }
   ```

## データ同期エラー

### 問題: パフォーマー情報が同期されない

#### 症状
- 最終同期日時が古い
- プロフィール情報の不一致

#### 確認事項
1. **同期ジョブ状態**
   ```sql
   SELECT * FROM batch_jobs 
   WHERE job_type = 'performer_sync' 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```

2. **エラーログ**
   ```bash
   grep "sync failed" /var/log/safevideo/sync.log | tail -50
   ```

#### 解決方法
1. **個別同期**
   ```javascript
   POST /api/v1/performers/123/sync
   {
     "force": true
   }
   ```

2. **バッチジョブリセット**
   ```sql
   UPDATE batch_jobs 
   SET status = 'queued', error = NULL 
   WHERE id = 123;
   ```

## パフォーマンス問題

### 問題: API レスポンスが遅い

#### 症状
- レスポンスタイム > 1秒
- タイムアウト頻発

#### 確認事項
1. **データベースクエリ**
   ```sql
   -- スロークエリログ確認
   SELECT * FROM mysql.slow_log 
   ORDER BY query_time DESC 
   LIMIT 10;
   ```

2. **Redis パフォーマンス**
   ```bash
   redis-cli --latency
   redis-cli --latency-history
   ```

#### 解決方法
1. **インデックス追加**
   ```sql
   -- 頻繁に検索されるカラムにインデックス
   CREATE INDEX idx_sharegram_id ON users(sharegram_id);
   CREATE INDEX idx_kyc_status ON kyc_requests(status, created_at);
   ```

2. **キャッシュ実装**
   ```javascript
   // Redis キャッシュ
   const cacheKey = `performer:${performerId}`;
   const cached = await redis.get(cacheKey);
   
   if (cached) {
     return JSON.parse(cached);
   }
   
   const data = await fetchFromDB();
   await redis.setex(cacheKey, 3600, JSON.stringify(data));
   ```

### 問題: メモリリーク

#### 症状
- メモリ使用量が継続的に増加
- OOMエラー

#### 解決方法
1. **ヒープダンプ分析**
   ```bash
   # ヒープダンプ取得
   node --inspect server.js
   kill -USR2 <pid>
   ```

2. **メモリ制限設定**
   ```bash
   # PM2設定
   pm2 start server.js --max-memory-restart 1G
   ```

## エラーコード一覧

| エラーコード | 説明 | 対処法 |
|------------|------|--------|
| `SSO_AUTH_FAILED` | SSO認証失敗 | トークンの有効性確認 |
| `KYC_ALREADY_IN_PROGRESS` | KYC申請重複 | 既存申請の確認 |
| `SYNC_RATE_LIMITED` | 同期レート制限 | 時間を置いて再試行 |
| `INVALID_SHAREGRAM_TOKEN` | 無効なトークン | トークン再取得 |
| `CIRCUIT_BREAKER_OPEN` | サーキットブレーカー作動 | 5分後に再試行 |
| `INTEGRATION_NOT_CONFIGURED` | 統合未設定 | 管理画面で設定 |
| `WEBHOOK_SIGNATURE_INVALID` | Webhook署名不正 | シークレット確認 |

## 緊急時対応

### 1. サービス完全停止時

```bash
# 1. ヘルスチェック
curl http://localhost:3000/api/integration/health

# 2. プロセス確認
ps aux | grep node
pm2 list

# 3. 緊急再起動
pm2 restart all --update-env

# 4. ログ確認
pm2 logs --lines 200
```

### 2. データベース接続エラー

```bash
# 1. MySQL状態確認
sudo systemctl status mysql

# 2. 接続テスト
mysql -h localhost -u safevideo -p -e "SELECT 1"

# 3. 接続プールリセット
pm2 restart safevideo-api
```

### 3. Sharegram API完全停止

```javascript
// フォールバックモード有効化
POST /api/v1/admin/integration/fallback
{
  "provider": "sharegram",
  "enable": true,
  "duration": 3600 // 1時間
}
```

### 4. 大量エラー発生時

```bash
# 1. エラー集計
grep ERROR /var/log/safevideo/app.log | awk '{print $5}' | sort | uniq -c | sort -nr

# 2. 特定エラーの詳細
grep -A 5 -B 5 "specific_error" /var/log/safevideo/app.log

# 3. 一時的な機能無効化
redis-cli set "feature:kyc:enabled" "false" EX 3600
```

## サポート連絡先

### 内部サポート
- システム管理者: REPLACE_WITH_ACTUAL_ADDRESS
- 開発チーム: REPLACE_WITH_ACTUAL_ADDRESS
- 緊急連絡: +1-xxx-xxx-xxxx

### 外部サポート
- Sharegram API: api-support@sharegram.com
- Sharegram緊急: https://status.sharegram.com

## ログファイル場所

```bash
# アプリケーションログ
/var/log/safevideo/app.log

# エラーログ
/var/log/safevideo/error.log

# 同期ログ
/var/log/safevideo/sync.log

# 監査ログ
/var/log/safevideo/audit.log

# Nginxログ
/var/log/nginx/access.log
/var/log/nginx/error.log
```