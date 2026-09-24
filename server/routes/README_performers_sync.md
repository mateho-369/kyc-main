# Performers Sync API Documentation

## 概要
外部システムからパフォーマー情報を同期するためのAPIエンドポイント。external_idを使用した重複チェックと100件単位のバッチ処理をサポート。

## エンドポイント
```
POST /api/performers/sync
```

## 認証
- 認証が必要（authミドルウェア使用）
- 管理者権限（role: 'admin'）が必要

## リクエスト形式

### Headers
```
Authorization: Bearer <token>
Content-Type: application/json
```

### Body
```json
{
  "performers": [
    {
      "external_id": "EXT123456",
      "lastName": "山田",
      "firstName": "太郎",
      "lastNameRoman": "Yamada",
      "firstNameRoman": "Taro",
      "status": "active",
      "documents": {
        "agreementFile": {
          "path": "/path/to/file",
          "originalName": "agreement.pdf",
          "mimeType": "application/pdf",
          "verified": false
        }
      }
    }
  ]
}
```

## レスポンス形式

### 成功時 (200 OK)
```json
{
  "message": "同期処理が完了しました",
  "results": {
    "total": 150,
    "created": 100,
    "updated": 45,
    "skipped": 5,
    "errors": [
      {
        "external_id": "EXT789",
        "error": "external_idが必須です"
      }
    ]
  }
}
```

### エラー時
- 403 Forbidden: 管理者権限がない場合
- 400 Bad Request: リクエストデータが不正な場合
- 500 Internal Server Error: サーバーエラー

## 処理の特徴

### 1. External ID による重複チェック
- `external_id`フィールドで既存レコードを検索
- 存在する場合は更新、存在しない場合は新規作成
- `external_id`はユニーク制約があるため重複不可

### 2. バッチ処理
- 100件単位でバッチ処理を実行
- 大量データの処理でもタイムアウトを防止
- Promise.allによる並列処理で高速化

### 3. エラーハンドリング
- 個別のレコードでエラーが発生しても処理継続
- エラー詳細は結果に含まれる
- スキップされたレコード数も記録

### 4. 監査ログ
- 同期処理の実行履歴を自動記録
- 実行者、処理結果、IPアドレスなどを保存

## 使用例

```javascript
// Node.js/axios の例
const axios = require('axios');

const syncPerformers = async () => {
  try {
    const response = await axios.post('https://api.example.com/api/performers/sync', {
      performers: [
        {
          external_id: 'SHAREGRAM_001',
          lastName: '田中',
          firstName: '花子',
          lastNameRoman: 'Tanaka',
          firstNameRoman: 'Hanako',
          status: 'pending'
        }
      ]
    }, {
      headers: {
        'Authorization': 'Bearer YOUR_AUTH_TOKEN',
        'Content-Type': 'application/json'
      }
    });
    
    console.log('同期結果:', response.data.results);
  } catch (error) {
    console.error('同期エラー:', error.response.data);
  }
};
```

## 注意事項
- external_idは必須フィールドです
- 大量データ同期時は適切な間隔を空けて実行してください
- documentsフィールドは既存データとマージされます（上書きではありません）