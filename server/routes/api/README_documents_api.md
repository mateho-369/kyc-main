# Documents API Documentation

## 概要
External IDを使用してパフォーマーのドキュメント情報を取得するAPI。Redisキャッシュとアクセス権限管理を実装。

## エンドポイント

### 1. ドキュメント取得
```
GET /api/documents/by-external-id/:external_id
```

#### 認証
Sharegram API認証が必要（sharegramAuthミドルウェア使用）

必須ヘッダー:
- `X-Sharegram-API-Key`: APIキー
- `X-Sharegram-Signature`: HMAC-SHA256署名
- `X-Sharegram-Timestamp`: Unixタイムスタンプ
- `X-Sharegram-Integration-ID`: 統合ID
- `X-API-Client`: クライアント識別子

#### レスポンス形式

**成功時 (200 OK):**
```json
{
  "performer": {
    "id": 123,
    "external_id": "EXT123456",
    "name": {
      "lastName": "山田",
      "firstName": "太郎",
      "lastNameRoman": "Yamada",
      "firstNameRoman": "Taro"
    },
    "status": "active",
    "kycStatus": "verified"
  },
  "documents": [
    {
      "type": "agreementFile",
      "originalName": "agreement.pdf",
      "mimeType": "application/pdf",
      "verified": true,
      "verifiedAt": "2024-06-30T10:00:00Z",
      "uploadedAt": "2024-06-29T15:00:00Z",
      "downloadUrl": "/api/performers/123/documents/agreementFile"
    },
    {
      "type": "idFront",
      "originalName": "id_front.jpg",
      "mimeType": "image/jpeg",
      "verified": true,
      "verifiedAt": "2024-06-30T10:00:00Z",
      "uploadedAt": "2024-06-29T15:00:00Z",
      "downloadUrl": "/api/performers/123/documents/idFront"
    }
  ],
  "metadata": {
    "totalDocuments": 3,
    "verifiedDocuments": 2,
    "pendingDocuments": 1,
    "lastUpdated": "2024-06-30T10:00:00Z"
  }
}
```

**エラー時:**
- 404 Not Found: 指定されたexternal_idが見つからない
- 403 Forbidden: アクセス権限がない
- 401 Unauthorized: 認証失敗
- 500 Internal Server Error: サーバーエラー

### 2. キャッシュクリア
```
POST /api/documents/clear-cache/:external_id
```

#### 認証
通常の認証（authミドルウェア）+ 管理者権限が必要

#### レスポンス
```json
{
  "message": "Cache cleared successfully",
  "external_id": "EXT123456"
}
```

## 機能の特徴

### 1. Redisキャッシュ
- TTL: 5分（300秒）
- キャッシュキー形式: `documents:external_id:{external_id}`
- キャッシュヒット時は高速レスポンス
- ドキュメント更新時は手動でキャッシュクリア可能

### 2. アクセス権限管理
- `sharegram-admin`クライアント: 全てのドキュメントにアクセス可能
- その他のクライアント: active & verifiedのパフォーマーのみアクセス可能
- 不正アクセスは監査ログに記録

### 3. 監査ログ
全てのAPIアクセスは監査ログに記録:
- 成功/失敗の記録
- レスポンスタイム
- APIクライアント情報
- キャッシュヒット/ミスの記録

## 使用例

```javascript
// axios使用例
const axios = require('axios');
const crypto = require('crypto');

const getDocumentsByExternalId = async (externalId) => {
  const apiKey = 'your-api-key';
  const secretKey = 'your-secret-key';
  const timestamp = Math.floor(Date.now() / 1000);
  const integrationId = 'your-integration-id';
  
  // 署名の生成
  const payload = `GET\\n/api/documents/by-external-id/${externalId}\\n${timestamp}\\n`;
  const signature = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
  
  try {
    const response = await axios.get(`https://api.example.com/api/documents/by-external-id/${externalId}`, {
      headers: {
        'X-Sharegram-API-Key': apiKey,
        'X-Sharegram-Signature': signature,
        'X-Sharegram-Timestamp': timestamp,
        'X-Sharegram-Integration-ID': integrationId,
        'X-API-Client': 'sharegram-api'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    throw error;
  }
};
```

## パフォーマンス考慮事項
- Redisキャッシュにより2回目以降のアクセスは高速化
- 監査ログの非同期記録により応答速度への影響を最小化
- インデックスによるデータベース検索の最適化