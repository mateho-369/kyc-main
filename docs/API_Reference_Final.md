# Sharegram KYC統合 API リファレンス（最終版）

## 概要

このドキュメントは、SafeVideo KYCシステムとSharegram統合のための完全なAPIリファレンスです。

### ベースURL
```
https://api.safevideo.com/api/v1
```

### 認証
すべてのAPIリクエストには以下のいずれかの認証が必要です：
- JWT Bearer Token
- X-API-Client ヘッダー + API Key
- Firebase Token

## 目次

1. [認証 API](#認証-api)
2. [パフォーマー API](#パフォーマー-api)
3. [KYC API](#kyc-api)
4. [ドキュメント API](#ドキュメント-api)
5. [Webhook API](#webhook-api)
6. [統合 API](#統合-api)
7. [エラーコード](#エラーコード)

---

## 認証 API

### 統合ログイン
```http
POST /auth/unified-login
```

Firebase/Sharegramの統合認証を行います。

**リクエスト:**
```json
{
  "provider": "firebase" | "sharegram",
  "token": "string",
  "deviceId": "string" (optional)
}
```

**レスポンス:**
```json
{
  "accessToken": "jwt_token",
  "refreshToken": "refresh_token",
  "user": {
    "id": "string",
    "email": "string",
    "name": "string",
    "role": "admin" | "user",
    "provider": "firebase" | "sharegram"
  },
  "expiresIn": 86400
}
```

### セッション検証
```http
GET /auth/session/verify
Authorization: Bearer {token}
```

**レスポンス:**
```json
{
  "valid": true,
  "user": {
    "id": "string",
    "email": "string",
    "role": "string"
  },
  "expiresAt": "2025-07-01T12:00:00Z"
}
```

### 全デバイスログアウト
```http
POST /auth/logout-all
Authorization: Bearer {token}
```

**レスポンス:**
```json
{
  "message": "全デバイスからログアウトしました",
  "revokedSessions": 3
}
```

---

## パフォーマー API

### パフォーマー同期
```http
POST /performers/sync
X-API-Client: sharegram-api
X-API-Key: {api_key}
```

外部システムからパフォーマーデータを同期します（最大100件/リクエスト）。

**リクエスト:**
```json
{
  "performers": [
    {
      "external_id": "SHARE-12345",
      "firstName": "太郎",
      "lastName": "山田",
      "firstNameRoman": "Taro",
      "lastNameRoman": "Yamada",
      "status": "pending" | "active" | "inactive",
      "documents": {
        "idFront": "url_to_document",
        "idBack": "url_to_document",
        "selfie": "url_to_document"
      }
    }
  ]
}
```

**レスポンス:**
```json
{
  "message": "同期処理が完了しました",
  "results": {
    "total": 100,
    "created": 45,
    "updated": 50,
    "skipped": 5,
    "errors": [
      {
        "external_id": "SHARE-99999",
        "error": "Invalid data format"
      }
    ]
  }
}
```

### パフォーマー承認
```http
POST /performers/{performer_id}/approve
Authorization: Bearer {token}
```

**パスパラメータ:**
- `performer_id`: パフォーマーID（数値）

**レスポンス:**
```json
{
  "message": "出演者が承認されました",
  "performer": {
    "id": 123,
    "external_id": "SHARE-12345",
    "name": "山田 太郎",
    "status": "active",
    "approvedAt": "2025-07-01T12:00:00Z",
    "approvedBy": 456
  }
}
```

### 登録完了通知
```http
POST /performers/{performer_id}/registration-complete
Authorization: Bearer {token}
```

**レスポンス:**
```json
{
  "message": "登録が完了しました",
  "performer": {
    "id": 123,
    "kycStatus": "in_progress",
    "registrationCompletedAt": "2025-07-01T12:00:00Z"
  }
}
```

### パフォーマー検索
```http
GET /performers/search?q={query}&status={status}&limit={limit}&offset={offset}
Authorization: Bearer {token}
```

**クエリパラメータ:**
- `q`: 検索キーワード（名前、external_id）
- `status`: フィルター（active, inactive, pending）
- `limit`: 取得件数（デフォルト: 20、最大: 100）
- `offset`: オフセット（デフォルト: 0）

**レスポンス:**
```json
{
  "data": [
    {
      "id": 123,
      "external_id": "SHARE-12345",
      "name": "山田 太郎",
      "status": "active",
      "kycStatus": "verified"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasNext": true
  }
}
```

---

## KYC API

### KYCリクエスト作成
```http
POST /kyc/requests
Authorization: Bearer {token}
```

**リクエスト:**
```json
{
  "performerId": 123,
  "verificationType": "standard" | "enhanced",
  "documents": {
    "idType": "passport" | "driver_license" | "national_id",
    "idNumber": "AB123456"
  }
}
```

**レスポンス:**
```json
{
  "kycRequest": {
    "id": 789,
    "performerId": 123,
    "status": "pending",
    "verificationType": "standard",
    "createdAt": "2025-07-01T12:00:00Z"
  }
}
```

### ドキュメントアップロード
```http
POST /kyc/requests/{request_id}/documents
Authorization: Bearer {token}
Content-Type: multipart/form-data
```

**フォームデータ:**
- `type`: ドキュメントタイプ（idFront, idBack, selfie, proof_of_address）
- `file`: アップロードファイル（最大10MB）

**レスポンス:**
```json
{
  "document": {
    "id": 456,
    "type": "idFront",
    "url": "/api/documents/456",
    "uploadedAt": "2025-07-01T12:00:00Z",
    "status": "pending_verification"
  }
}
```

### KYC承認
```http
POST /kyc/requests/{request_id}/approve
Authorization: Bearer {token}
```

**リクエスト（オプション）:**
```json
{
  "notes": "すべての書類が確認され、問題ありません",
  "verificationScore": 95
}
```

**レスポンス:**
```json
{
  "message": "KYCリクエストが承認されました",
  "kycRequest": {
    "id": 789,
    "status": "approved",
    "approvedAt": "2025-07-01T12:00:00Z",
    "approvedBy": 456
  }
}
```

### KYC拒否
```http
POST /kyc/requests/{request_id}/reject
Authorization: Bearer {token}
```

**リクエスト:**
```json
{
  "reason": "document_unclear" | "document_expired" | "mismatch" | "suspicious",
  "notes": "身分証明書の有効期限が切れています"
}
```

### Sharegram検証結果受信
```http
POST /kyc/sharegram/verification-result
X-API-Client: sharegram-api
X-API-Key: {api_key}
```

**リクエスト:**
```json
{
  "external_id": "SHARE-12345",
  "verificationId": "VER-789",
  "result": "approved" | "rejected" | "pending",
  "verifiedAt": "2025-07-01T12:00:00Z",
  "details": {
    "score": 95,
    "checks": {
      "document": "pass",
      "biometric": "pass",
      "database": "pass"
    }
  }
}
```

---

## ドキュメント API

### External IDによるドキュメント取得
```http
GET /documents/by-external-id/{external_id}?type={type}
Authorization: Bearer {token}
```

**パスパラメータ:**
- `external_id`: SharegramのパフォーマーID

**クエリパラメータ:**
- `type`: ドキュメントタイプ（idFront, idBack, selfie, all）

**レスポンス:**
```json
{
  "performer": {
    "id": 123,
    "external_id": "SHARE-12345",
    "name": "山田 太郎"
  },
  "documents": [
    {
      "id": 456,
      "type": "idFront",
      "url": "/api/documents/456",
      "uploadedAt": "2025-07-01T10:00:00Z",
      "status": "verified"
    }
  ]
}
```

### ドキュメントメタデータ取得
```http
GET /documents/{document_id}/metadata
Authorization: Bearer {token}
```

**レスポンス:**
```json
{
  "id": 456,
  "type": "idFront",
  "mimeType": "image/jpeg",
  "size": 2048576,
  "dimensions": {
    "width": 1920,
    "height": 1080
  },
  "uploadedAt": "2025-07-01T10:00:00Z",
  "uploadedBy": 789,
  "verificationStatus": "verified",
  "verifiedAt": "2025-07-01T11:00:00Z",
  "metadata": {
    "exif": {},
    "hash": "sha256:abcdef..."
  }
}
```

---

## Webhook API

### コンテンツ承認通知
```http
POST /webhooks/content-approved
X-Webhook-Signature: {signature}
```

**リクエスト:**
```json
{
  "event": "content.approved",
  "timestamp": "2025-07-01T12:00:00Z",
  "data": {
    "contentId": "CONTENT-123",
    "performerId": "SHARE-12345",
    "approvedBy": "ADMIN-456",
    "metadata": {
      "contentType": "video",
      "duration": 300
    }
  }
}
```

### KYC承認通知
```http
POST /webhooks/kyc-approved
X-Webhook-Signature: {signature}
```

**リクエスト:**
```json
{
  "event": "kyc.approved",
  "timestamp": "2025-07-01T12:00:00Z",
  "data": {
    "performerId": "SHARE-12345",
    "kycRequestId": "KYC-789",
    "verificationScore": 95
  }
}
```

### Webhook設定
```http
POST /webhooks
Authorization: Bearer {token}
```

**リクエスト:**
```json
{
  "url": "https://your-domain.com/webhook",
  "events": ["performer.approved", "kyc.completed"],
  "secret": "your_webhook_secret",
  "isActive": true
}
```

---

## 統合 API

### 統合ステータス
```http
GET /integration/status
X-API-Client: {client_id}
```

**レスポンス:**
```json
{
  "status": "operational",
  "services": {
    "database": "connected",
    "redis": "connected",
    "sharegram": "connected",
    "firebase": "connected"
  },
  "version": "1.0.0",
  "uptime": 864000,
  "lastSync": "2025-07-01T11:00:00Z"
}
```

### ヘルスチェック
```http
GET /integration/health
```

**レスポンス:**
```json
{
  "status": "healthy",
  "timestamp": "2025-07-01T12:00:00Z",
  "checks": {
    "database": {
      "status": "healthy",
      "latency": 5
    },
    "redis": {
      "status": "healthy",
      "latency": 1
    },
    "sharegram_api": {
      "status": "healthy",
      "latency": 45
    }
  }
}
```

---

## エラーコード

### エラーレスポンス形式
```json
{
  "error": {
    "code": "SHARE001",
    "message": "認証に失敗しました",
    "category": "authentication",
    "details": {
      "field": "token",
      "reason": "expired"
    },
    "timestamp": "2025-07-01T12:00:00Z",
    "requestId": "req_abc123"
  }
}
```

### エラーコード一覧

#### 認証エラー (SHARE001-099)
| コード | メッセージ | 説明 |
|-------|-----------|------|
| SHARE001 | 認証に失敗しました | トークンが無効または期限切れ |
| SHARE002 | 認証情報が不足しています | 必要なヘッダーが欠落 |
| SHARE003 | APIキーが無効です | 提供されたAPIキーが無効 |
| SHARE004 | アクセス権限がありません | リソースへのアクセス権限なし |
| SHARE005 | セッションが期限切れです | セッションの再認証が必要 |

#### データ検証エラー (SHARE100-199)
| コード | メッセージ | 説明 |
|-------|-----------|------|
| SHARE101 | 必須フィールドが不足しています | リクエストに必須項目が欠落 |
| SHARE102 | データ形式が不正です | 提供されたデータの形式エラー |
| SHARE103 | ファイルサイズが制限を超えています | アップロードファイルが大きすぎる |
| SHARE104 | 無効なファイル形式です | サポートされていないファイル形式 |

#### パフォーマーエラー (SHARE200-299)
| コード | メッセージ | 説明 |
|-------|-----------|------|
| SHARE201 | パフォーマーが見つかりません | 指定されたIDのパフォーマーが存在しない |
| SHARE202 | External IDが重複しています | 既に同じexternal_idが登録済み |
| SHARE203 | パフォーマーステータスが無効です | 操作に必要なステータス条件を満たしていない |

#### 同期エラー (SHARE300-399)
| コード | メッセージ | 説明 |
|-------|-----------|------|
| SHARE301 | 同期処理に失敗しました | バッチ処理中にエラー発生 |
| SHARE302 | 同期データが不正です | 同期データの検証エラー |
| SHARE303 | 同期制限を超えました | 一度に同期できる件数を超過 |

#### Webhookエラー (SHARE400-499)
| コード | メッセージ | 説明 |
|-------|-----------|------|
| SHARE401 | Webhook署名が無効です | 署名検証に失敗 |
| SHARE402 | Webhookイベントが無効です | サポートされていないイベントタイプ |
| SHARE403 | Webhook配信に失敗しました | エンドポイントへの配信エラー |

#### システムエラー (SHARE700-999)
| コード | メッセージ | 説明 |
|-------|-----------|------|
| SHARE701 | データベースエラー | DB接続またはクエリエラー |
| SHARE702 | キャッシュエラー | Redis接続エラー |
| SHARE703 | 外部サービスエラー | Sharegram APIとの通信エラー |
| SHARE999 | 内部サーバーエラー | 予期しないシステムエラー |

---

## レート制限

### 制限値
- 一般API: 1000リクエスト/分
- 同期API: 100リクエスト/分
- Webhook: 10000リクエスト/分

### レスポンスヘッダー
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1719835260
```

### 制限超過時のレスポンス
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "レート制限を超えました",
    "retryAfter": 60
  }
}
```

---

## ページネーション

リスト系APIは以下の形式でページネーションをサポート：

**リクエスト:**
```
GET /api/performers?limit=20&offset=40
```

**レスポンス:**
```json
{
  "data": [...],
  "pagination": {
    "total": 1250,
    "limit": 20,
    "offset": 40,
    "hasNext": true,
    "hasPrev": true
  }
}
```

---

## Webhook署名検証

Webhookリクエストの署名検証方法：

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const timestamp = req.headers['x-webhook-timestamp'];
  const message = `${timestamp}.${JSON.stringify(payload)}`;
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');
    
  return signature === `sha256=${expectedSignature}`;
}
```

---

## SDKとツール

### 公式SDK
- Node.js: `npm install @safevideo/sharegram-sdk`
- Python: `pip install safevideo-sharegram`
- PHP: `composer require safevideo/sharegram-sdk`

### Postmanコレクション
[Sharegram KYC API Postman Collection](https://www.postman.com/safevideo/sharegram-kyc-api)

### OpenAPI仕様
[OpenAPI 3.0 Specification](/api/openapi.yaml)

---

## サポート

技術的な質問については、担当者へ直接ご連絡ください。
専用のサポート窓口・チャットチャンネルは設けていません。

---

*最終更新日: 2025年7月1日*
*バージョン: 1.0.0*