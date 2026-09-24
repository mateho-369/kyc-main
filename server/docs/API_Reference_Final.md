# SafeVideo API リファレンス（最終版）

## 概要
- **ベースURL**: `https://api.safevideo.com`
- **バージョン**: v1
- **認証**: Bearer Token (JWT)

## 目次
1. [認証](#認証)
2. [SSO統合](#sso統合)
3. [KYC検証](#kyc検証)
4. [パフォーマー管理](#パフォーマー管理)
5. [統合管理](#統合管理)
6. [Webhook](#webhook)
7. [エラーハンドリング](#エラーハンドリング)

## 認証

### 統合SSO認証
```http
POST /auth/sso/unified-login
```

SharegramまたはFirebase JWTトークンを使用してログイン

**Headers:**
```
Authorization: Bearer <sharegram_jwt_token>
X-SSO-Provider: sharegram
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": 123,
      "email": "user@example.com",
      "username": "user123",
      "displayName": "John Doe",
      "profileImage": "https://example.com/profile.jpg",
      "role": "performer",
      "isEmailVerified": true,
      "ssoProvider": "sharegram"
    },
    "expiresIn": 86400
  }
}
```

### SSO セッション検証
```http
GET /auth/sso/session/verify?sessionId=xxx
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": 123,
    "provider": "sharegram",
    "createdAt": "2024-01-01T00:00:00Z",
    "expiresAt": "2024-01-02T00:00:00Z",
    "isValid": true
  }
}
```

### 全セッションログアウト
```http
POST /auth/sso/logout-all
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "All SSO sessions logged out"
}
```

## SSO統合

### 統合状態確認
```http
GET /auth/sso/integration-status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "providers": {
      "sharegram": {
        "enabled": true,
        "configured": true
      },
      "firebase": {
        "enabled": true,
        "configured": true
      }
    }
  }
}
```

## KYC検証

### KYC申請提出
```http
POST /api/v1/kyc/submit
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "birthDate": "1990-01-01",
  "nationality": "US",
  "address": {
    "street": "123 Main St",
    "city": "Los Angeles",
    "state": "CA",
    "postalCode": "90001",
    "country": "US"
  },
  "documentType": "passport",
  "documentNumber": "A1234567",
  "documentExpiryDate": "2030-01-01"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "requestId": 456,
    "status": "pending",
    "performerId": 123,
    "submittedAt": "2024-01-01T00:00:00Z"
  }
}
```

### ドキュメントアップロード
```http
POST /api/v1/kyc/{requestId}/documents
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Form Data:**
- `idFront`: 身分証明書表面画像
- `documentType`: "identity_document"
- `side`: "front"

**Response:**
```json
{
  "success": true,
  "data": {
    "documentId": 789,
    "documentType": "identity_document",
    "status": "uploaded",
    "uploadedAt": "2024-01-01T00:00:00Z"
  }
}
```

### KYCステータス確認
```http
GET /api/v1/kyc/{requestId}/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "requestId": 456,
    "status": "in_progress",
    "verificationSteps": [
      {
        "stepType": "document_verification",
        "status": "completed",
        "completedAt": "2024-01-01T00:00:00Z"
      },
      {
        "stepType": "face_match",
        "status": "pending"
      }
    ],
    "riskScore": 85,
    "estimatedCompletionTime": "2024-01-01T01:00:00Z"
  }
}
```

### KYC承認（管理者）
```http
POST /api/v1/kyc/{requestId}/approve
Authorization: Bearer <admin_token>
```

**Request Body:**
```json
{
  "notes": "All checks passed successfully"
}
```

### KYC却下（管理者）
```http
POST /api/v1/kyc/{requestId}/reject
Authorization: Bearer <admin_token>
```

**Request Body:**
```json
{
  "reason": "document_unclear",
  "notes": "ID document is not clearly visible"
}
```

## パフォーマー管理

### パフォーマー同期
```http
POST /api/v1/performers/sync
Authorization: Bearer <admin_token>
```

**Request Body:**
```json
{
  "fullSync": true,
  "syncOptions": {
    "includeInactive": false,
    "updateExisting": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "job_123",
    "status": "queued",
    "jobType": "performer_sync",
    "parameters": {
      "fullSync": true
    },
    "queuedAt": "2024-01-01T00:00:00Z"
  }
}
```

### 同期ステータス確認
```http
GET /api/v1/performers/sync/status?jobId=job_123
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "job_123",
    "status": "processing",
    "progress": 75,
    "totalItems": 100,
    "processedItems": 75,
    "startedAt": "2024-01-01T00:00:00Z"
  }
}
```

### 個別パフォーマー同期
```http
POST /api/v1/performers/{performerId}/sync
Authorization: Bearer <admin_token>
```

**Request Body:**
```json
{
  "force": true
}
```

### 承認待ちパフォーマー一覧
```http
GET /api/v1/performers/pending-approval?page=1&limit=20
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "username": "performer123",
      "displayName": "John Performer",
      "status": "pending",
      "kycStatus": "verified",
      "submittedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "itemsPerPage": 20,
    "totalItems": 50,
    "totalPages": 3
  }
}
```

### パフォーマー承認
```http
POST /api/v1/performers/{performerId}/approve
Authorization: Bearer <admin_token>
```

**Request Body:**
```json
{
  "notes": "All verification checks passed",
  "sendNotification": true
}
```

### パフォーマー却下
```http
POST /api/v1/performers/{performerId}/reject
Authorization: Bearer <admin_token>
```

**Request Body:**
```json
{
  "reason": "inappropriate_content",
  "notes": "Profile content violates community guidelines",
  "sendNotification": true
}
```

### パフォーマーステータス更新
```http
PUT /api/v1/performers/{performerId}/status
Authorization: Bearer <admin_token>
```

**Request Body:**
```json
{
  "status": "suspended",
  "reason": "terms_violation",
  "notes": "Multiple violations of terms of service",
  "duration": 7
}
```

## 統合管理

### 統合ステータス
```http
GET /api/integration/status
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sharegram": {
      "enabled": true,
      "lastSyncDate": "2024-01-01T00:00:00Z",
      "totalSyncedPerformers": 150,
      "lastSyncStatus": "success"
    },
    "kyc": {
      "statistics": {
        "pending": 5,
        "in_progress": 3,
        "verified": 10,
        "rejected": 2,
        "expired": 1
      },
      "totalRequests": 21
    },
    "errors": {
      "hasRecentErrors": false,
      "recentErrors": []
    }
  }
}
```

### ヘルスチェック
```http
GET /api/integration/health
```

**Response:**
```json
{
  "timestamp": "2024-01-01T00:00:00Z",
  "status": "healthy",
  "checks": {
    "database": {
      "status": "healthy",
      "message": "Database connection is active"
    },
    "sharegramApi": {
      "status": "healthy",
      "message": "Sharegram API is reachable",
      "responseTime": 150
    },
    "authSystem": {
      "status": "healthy",
      "message": "Authentication system is configured"
    },
    "memory": {
      "status": "healthy",
      "heapUsed": "245MB",
      "heapTotal": "512MB",
      "usagePercent": "47.85%"
    }
  }
}
```

## Webhook

### Webhook受信エンドポイント
```http
POST /webhooks/sharegram
X-Sharegram-Signature: <signature>
```

**イベントタイプ:**
- `kyc.verification.completed`
- `kyc.verification.failed`
- `performer.profile.updated`
- `performer.status.changed`

**Request Body例（KYC完了）:**
```json
{
  "event": "kyc.verification.completed",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "verificationId": "ver_123",
    "performerId": "sg_456",
    "result": {
      "status": "passed",
      "riskScore": 95,
      "checks": {
        "documentAuthenticity": {
          "status": "passed",
          "confidence": 98
        },
        "faceMatch": {
          "status": "passed",
          "confidence": 95
        }
      }
    }
  }
}
```

### Webhook登録
```http
POST /api/v1/integrations/sharegram/webhook
Authorization: Bearer <admin_token>
```

**Request Body:**
```json
{
  "url": "https://api.safevideo.com/webhooks/sharegram",
  "events": [
    "kyc.verification.completed",
    "kyc.verification.failed",
    "performer.profile.updated"
  ]
}
```

## エラーハンドリング

### エラーレスポンス形式
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {
      "field": "Additional error details"
    }
  }
}
```

### 共通エラーコード

| コード | HTTPステータス | 説明 |
|--------|---------------|------|
| `UNAUTHORIZED` | 401 | 認証が必要 |
| `FORBIDDEN` | 403 | アクセス権限なし |
| `NOT_FOUND` | 404 | リソースが見つからない |
| `VALIDATION_ERROR` | 400 | バリデーションエラー |
| `RATE_LIMITED` | 429 | レート制限超過 |
| `INTERNAL_ERROR` | 500 | サーバー内部エラー |
| `SERVICE_UNAVAILABLE` | 503 | サービス利用不可 |

### 統合固有エラーコード

| コード | 説明 | 対処法 |
|--------|------|--------|
| `SSO_AUTH_FAILED` | SSO認証失敗 | トークンを再取得 |
| `INVALID_SHAREGRAM_TOKEN` | 無効なSharegramトークン | 新しいトークンを要求 |
| `KYC_ALREADY_IN_PROGRESS` | KYC申請が既に進行中 | 既存申請を確認 |
| `KYC_NOT_VERIFIED` | KYC未検証 | KYC検証を完了させる |
| `SYNC_ALREADY_IN_PROGRESS` | 同期が既に実行中 | 完了を待つ |
| `SYNC_RATE_LIMITED` | 同期レート制限 | 時間を置いて再試行 |
| `INTEGRATION_NOT_CONFIGURED` | 統合が未設定 | 管理画面で設定 |
| `CIRCUIT_BREAKER_OPEN` | サーキットブレーカー作動中 | 5分後に再試行 |

## レート制限

| エンドポイント | 制限 | ウィンドウ |
|---------------|------|-----------|
| 認証 | 10回 | 1分 |
| KYC提出 | 5回 | 1時間 |
| 同期 | 1回 | 5分 |
| 一般API | 100回 | 1分 |

**レート制限ヘッダー:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1641024000
```

## ページネーション

**リクエストパラメータ:**
- `page`: ページ番号（1から開始）
- `limit`: 1ページあたりのアイテム数（最大100）
- `sort`: ソートフィールド
- `order`: ソート順序（asc/desc）

**レスポンス形式:**
```json
{
  "data": [...],
  "pagination": {
    "currentPage": 1,
    "itemsPerPage": 20,
    "totalItems": 100,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```