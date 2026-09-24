# Sharegram Authentication Middleware

## 概要
Sharegram APIの認証を処理するミドルウェア。HMAC-SHA256署名検証、APIキー認証、X-API-Clientヘッダー検証をサポート。

## 主な機能

### 1. X-API-Clientヘッダー検証
- 必須ヘッダー: `X-API-Client`
- 有効な値: `sharegram-web`, `sharegram-mobile`, `sharegram-admin`, `sharegram-api`
- 全ての認証リクエストで必須

### 2. HMAC署名認証 (sharegramAuth)
必須ヘッダー:
- `X-Sharegram-API-Key`: APIキー
- `X-Sharegram-Signature`: HMAC-SHA256署名
- `X-Sharegram-Timestamp`: Unixタイムスタンプ（5分以内）
- `X-Sharegram-Integration-ID`: 統合ID
- `X-API-Client`: クライアント識別子

### 3. APIキー認証 (sharegramApiKeyAuth)
必須ヘッダー:
- `X-API-Key`: sk_またはpk_プレフィックス付きAPIキー
- `X-API-Client`: クライアント識別子

### 4. APIキー管理機能
- `generateApiKey(prefix)`: APIキー生成
- `hashApiKey(apiKey)`: APIキーのハッシュ化
- `verifyApiKey(providedKey, storedHash)`: APIキー検証

## 使用例

```javascript
const { sharegramAuth, sharegramApiKeyAuth, generateApiKey } = require('./middleware/sharegram-auth');

// ルートに認証を適用
router.post('/api/sharegram/data', sharegramAuth, async (req, res) => {
  // 認証済みリクエストの処理
  const { integrationId, apiClient } = req.sharegramAuth;
});

// APIキー認証を使用
router.get('/api/v2/data', sharegramApiKeyAuth, async (req, res) => {
  // 認証済みリクエストの処理
  const { keyType, apiClient } = req.apiKeyAuth;
});

// 新しいAPIキーを生成
const newApiKey = generateApiKey('sk_'); // sk_で始まるシークレットキー
```

## エラーレスポンス

### 認証失敗時
```json
{
  "error": "Authentication Failed",
  "message": "Invalid API client identifier",
  "validClients": ["sharegram-web", "sharegram-mobile", "sharegram-admin", "sharegram-api"]
}
```

### ヘッダー不足時
```json
{
  "error": "Authentication Required",
  "message": "Missing required Sharegram authentication headers",
  "missingHeaders": {
    "X-Sharegram-API-Key": false,
    "X-API-Client": true
  }
}
```