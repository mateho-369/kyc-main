# Sharegram統合ガイド

## 目次
1. [概要](#概要)
2. [前提条件](#前提条件)
3. [初期設定](#初期設定)
4. [統合実装](#統合実装)
5. [テストと検証](#テストと検証)
6. [本番環境への展開](#本番環境への展開)
7. [監視とメンテナンス](#監視とメンテナンス)

## 概要

SafeVideoプラットフォームとSharegramの統合により、以下の機能が実現されます：

- **シングルサインオン（SSO）**: SharegramアカウントでのSafeVideoログイン
- **KYC検証統合**: Sharegram APIを利用した本人確認プロセス
- **パフォーマーデータ同期**: プロフィール情報の自動同期
- **リアルタイム通知**: Webhookによるイベント連携

## 前提条件

### 必要な環境
- Node.js 14.x以上
- MySQL 5.7以上
- Redis 6.x以上
- SSL証明書（HTTPS必須）

### Sharegramアカウント要件
- Sharegram Partnerアカウント
- API認証情報（API Key、Secret Key）
- Webhook設定権限

## 初期設定

### 1. 環境変数の設定

`.env`ファイルに以下の設定を追加：

```bash
# Sharegram API設定
SHAREGRAM_API_URL=https://api.sharegram.com/v1
SHAREGRAM_API_KEY=your_api_key_here
SHAREGRAM_SECRET_KEY=your_secret_key_here
SHAREGRAM_WEBHOOK_SECRET=your_webhook_secret_here

# Sharegram SSO設定
SHAREGRAM_JWKS_URI=https://api.sharegram.com/.well-known/jwks.json
SHAREGRAM_ISSUER=https://api.sharegram.com
SHAREGRAM_AUDIENCE=your_client_id_here
SHAREGRAM_AUTH_URL=https://auth.sharegram.com

# Redis設定（SSO用）
REDIS_SSO_DB=2
REDIS_RECOVERY_DB=3
```

### 2. データベースマイグレーション

統合用のテーブルを作成：

```bash
# マイグレーション実行
npm run migrate

# 確認
npm run migrate:status
```

### 3. SSL証明書の設定

HTTPS通信が必須のため、SSL証明書を設定：

```nginx
server {
    listen 443 ssl http2;
    server_name api.safevideo.com;
    
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 統合実装

### 1. Sharegram統合の有効化

管理画面から統合を有効化：

```javascript
POST /api/v1/integrations/sharegram/enable
{
  "apiKey": "your_api_key",
  "secretKey": "your_secret_key",
  "webhookUrl": "https://api.safevideo.com/webhooks/sharegram",
  "enableSSO": true,
  "enableKYC": true,
  "syncInterval": 3600 // 1時間ごと
}
```

### 2. SSO実装

#### フロントエンド実装例

```javascript
// Sharegramログインボタン
const handleSharegramLogin = async () => {
  try {
    // SharegramからのJWTトークンを取得
    const sharegramToken = await getSharegramToken();
    
    // SafeVideo APIでトークン検証
    const response = await fetch('/auth/sso/unified-login', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sharegramToken}`,
        'X-SSO-Provider': 'sharegram'
      }
    });
    
    const data = await response.json();
    if (data.success) {
      // ログイン成功処理
      localStorage.setItem('token', data.data.token);
      window.location.href = '/dashboard';
    }
  } catch (error) {
    console.error('SSO login failed:', error);
  }
};
```

### 3. KYC統合

#### KYC検証フロー

```javascript
// KYCリクエスト送信
const submitKYC = async (performerId, documents) => {
  const response = await fetch('/api/v1/kyc/submit', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      firstName: 'John',
      lastName: 'Doe',
      birthDate: '1990-01-01',
      nationality: 'US',
      address: {
        street: '123 Main St',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        country: 'US'
      },
      documentType: 'passport',
      documentNumber: 'A1234567',
      documents: documents
    })
  });
  
  return response.json();
};
```

### 4. Webhook設定

Sharegramからのイベント受信設定：

```javascript
// Webhook受信エンドポイント
POST /webhooks/sharegram

// 対応イベント
- kyc.verification.completed
- kyc.verification.failed
- performer.profile.updated
- performer.status.changed
```

## テストと検証

### 1. 統合テストの実行

```bash
# 統合テスト実行
npm run test:integration

# 特定のテストのみ
npm run test:integration -- kyc.test.js
```

### 2. 接続確認

#### ヘルスチェック
```bash
curl https://api.safevideo.com/api/integration/health
```

期待されるレスポンス：
```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "healthy" },
    "sharegramApi": { "status": "healthy", "responseTime": 150 },
    "authSystem": { "status": "healthy" },
    "memory": { "status": "healthy", "usagePercent": "45.23%" }
  }
}
```

### 3. SSO動作確認

1. Sharegram認証ページへリダイレクト
2. Sharegramでログイン
3. SafeVideoへ自動ログイン
4. ユーザー情報の同期確認

## 本番環境への展開

### 1. 環境設定の確認

```bash
# 本番環境変数の確認
npm run config:validate

# SSL証明書の検証
npm run ssl:check
```

### 2. デプロイメントチェックリスト

- [ ] 環境変数が正しく設定されている
- [ ] SSL証明書が有効
- [ ] データベースマイグレーション完了
- [ ] Redisが正しく設定されている
- [ ] ログ出力先が設定されている
- [ ] 監視システムが設定されている

### 3. 段階的ロールアウト

```bash
# 1. カナリアデプロイ（10%のトラフィック）
npm run deploy:canary

# 2. 監視（30分）
npm run monitor:canary

# 3. 完全デプロイ
npm run deploy:production
```

## 監視とメンテナンス

### 1. 監視項目

#### API監視
- レスポンスタイム
- エラー率
- スループット

#### 統合監視
- Sharegram API接続状態
- SSO成功率
- KYC処理時間

### 2. アラート設定

```javascript
// アラート閾値設定例
{
  "alerts": {
    "api_error_rate": {
      "threshold": 5, // 5%以上でアラート
      "window": "5m"
    },
    "sharegram_connection": {
      "threshold": 3, // 3回連続失敗でアラート
      "window": "1m"
    },
    "kyc_processing_time": {
      "threshold": 30000, // 30秒以上でアラート
      "window": "1m"
    }
  }
}
```

### 3. メンテナンス手順

#### 定期メンテナンス
- 週次: ログローテーション
- 月次: パフォーマンス分析
- 四半期: セキュリティ監査

#### 緊急時対応
1. サーキットブレーカーの確認
2. フォールバックモードへの切り替え
3. Sharegram APIステータス確認
4. ログ分析と原因特定

### 4. バックアップとリカバリー

```bash
# 統合設定のバックアップ
npm run backup:integration

# リカバリー手順
npm run recovery:start
```

## トラブルシューティング

よくある問題については[Troubleshooting_Guide.md](./Troubleshooting_Guide.md)を参照してください。

## サポート

- 技術サポート: REPLACE_WITH_ACTUAL_ADDRESS
- Sharegram API: https://developer.sharegram.com
- 緊急連絡先: +1-xxx-xxx-xxxx