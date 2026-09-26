# Sharegram KYC システム API仕様書（Sharegram連携用）

## 1. 概要

本ドキュメントは、Sharegram から Sharegram KYC システムへの連携API仕様を定義します。

### 1.1 システム構成

```
[Sharegram] ←→ [Sharegram KYC システム]
```

### 1.2 ベースURL

| 環境 | URL |
|------|-----|
| 本番/ステージング | `https://stg.id-manager.com` |

---

## 2. 認証

### 2.1 システム間API認証

出演者情報取得APIでは、以下のヘッダーを使用します。

```http
Authorization: Bearer {api_key}
Content-Type: application/json
```

**テスト用APIキー**: `sharegram-api-key-test-2025`

### 2.2 Firebase認証

SSO連携では Firebase ID Token を使用します。

---

## 3. 認証・SSO連携API

### 3.1 認証フロー

```mermaid
sequenceDiagram
    participant U as User
    participant S as Sharegram
    participant F as Firebase
    participant SKYC as Sharegram KYC システム

    U->>S: Sharegram KYC システムで登録リクエスト
    S->>F: Firebase ID Token生成
    S->>U: Firebase ID Tokenと共にKYCサイトにリダイレクト
    U->>SKYC: Firebase ID Token付きでアクセス
    SKYC->>F: Firebase ID Token検証
    F-->>SKYC: ユーザー情報
    SKYC->>U: 自動ログイン完了
```

### 3.2 Firebase ID Token検証

Firebase ID Tokenを検証し、KYCシステムのセッショントークンを発行します。

**エンドポイント**
```
POST /api/auth/firebase-verify
```

#### リクエスト

```json
{
  "id_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "client_id": "sharegram_platform"
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|------|------|------|
| id_token | string | Yes | Firebase ID Token |
| client_id | string | Yes | クライアント識別子 |

#### レスポンス

**成功時（200 OK）**:

```json
{
  "success": true,
  "data": {
    "user": {
      "firebase_uid": "firebase_user_123",
      "name": "山田太郎",
      "email": "yamada@example.com",
      "external_id": "sharegram_user_789"
    },
    "session_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "csrf_token": "csrf_token_abc123"
  }
}
```

**エラー時（401 Unauthorized）**:

```json
{
  "success": false,
  "error": {
    "code": "FIREBASE_AUTH_ERROR",
    "message": "ID Tokenの検証に失敗しました"
  }
}
```

```json
{
  "success": false,
  "error": {
    "code": "AUTH_EXPIRED_TOKEN",
    "message": "ID Tokenの有効期限が切れています"
  }
}
```

### 3.3 Firebase SSO認証開始

Firebase ID Tokenを使用してSSOログインを実行します。成功時は指定画面へ遷移します。

**エンドポイント**
```
GET /sso
```

**完全なURL例**
```
https://stg.id-manager.com/sso?token={Firebase_ID_Token}&action=create&performer_id={performer_id}&come_back_url={encoded_url}
```

#### クエリパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| token | string | Yes | Firebase ID Token（`getIdToken()` の戻り値。**未サインインのまま遷移させない**） |
| action | string | Yes | 操作種別: `create`（新規作成）または `edit`（編集） |
| performer_id | string | No | KYCの出演者ID（action=editの場合は必須） |
| come_back_url | string | No | 認証・操作完了後のSharegramへの戻り先URL（URLエンコード必須） |

> **重要（token は必須）**
> `token` が付いていない遷移は KYC 側でログインを成立させられません。
> 未サインインのユーザーや `getIdToken()` を `await` していない値（`[object Promise]`）を
> そのまま渡すと、KYC は「Firebase ID Tokenが指定されていません」画面を表示します。
> 送信前に「トークンが取得できたか」を必ず確認してください（詳細と実装例:
> [`docs/SHAREGRAM_SSO_HANDOFF.md`](docs/SHAREGRAM_SSO_HANDOFF.md)）。
>
> 受け付ける揺れ（送信側は `token` の 1 通りでよい）:
> `id_token` / `idToken` / `firebase_token` などの別名、URLハッシュ（`#token=...`）、
> `come_back` と `come_back_url` の両方、二重エンコードされた `come_back`。 

#### リクエスト例

**新規作成の場合**:
```
GET https://stg.id-manager.com/sso?token=eyJhbGciOiJSUzI1NiIs...&action=create&come_back_url=https%3A%2F%2Fsharegram.com%2Fperformers
```

**編集の場合**:
```
GET https://stg.id-manager.com/sso?token=eyJhbGciOiJSUzI1NiIs...&action=edit&performer_id=123&come_back_url=https%3A%2F%2Fsharegram.com%2Fperformers%2F123
```

#### レスポンス

- **成功時**: Firebase Token検証後、自動ログインし`action`に応じた画面へ遷移
  - `action=create`: 出演者新規登録画面
  - `action=edit`: 指定された出演者の編集画面
  - セッションCookie（`session_token`）が設定されます
- **失敗時**: エラーページを表示（トークン無効、期限切れなど）

#### 処理フロー

1. KYCシステムがFirebase ID Tokenを検証
2. 検証成功時、ユーザーを自動ログイン
3. `action`パラメータに基づき適切な画面へ遷移
4. 操作完了後、`come_back_url`が指定されていれば該当URLへリダイレクト

---

## 4. 出演者情報API

### 4.1 出演者一覧取得

出演者の一覧を取得します。

**エンドポイント**
```
GET /api/performers
```

#### クエリパラメータ

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|-----------|------|------|-----------|------|
| status | string | No | - | ステータスでフィルタ（pending, active, rejected） |
| search | string | No | - | 検索キーワード（氏名で検索） |
| sort | string | No | createdAt | ソート順（createdAt, updatedAt, name） |
| expiring | string | No | - | 期限切れ間近フィルタ（true） |

#### リクエスト例

```bash
curl -X GET "https://stg.id-manager.com/api/performers" \
  -H "Authorization: Bearer sharegram-api-key-test-2025" \
  -H "Content-Type: application/json"
```

#### レスポンス

**成功時（200 OK）**:

```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "external_id": "sharegram_performer_456",
      "lastName": "山田",
      "firstName": "花子",
      "lastNameRoman": "Yamada",
      "firstNameRoman": "Hanako",
      "status": "active",
      "kycStatus": "verified",
      "kycVerifiedAt": "2025-05-30T12:00:00.000Z",
      "riskScore": 0.1,
      "createdAt": "2025-05-29T10:15:30.000Z",
      "updatedAt": "2025-05-30T12:00:00.000Z"
    }
  ]
}
```

#### レスポンスフィールド

| フィールド | 型 | 説明 |
|-----------|------|------|
| id | number | KYCシステム内部ID |
| external_id | string | Sharegram側の出演者ID |
| lastName | string | 姓（漢字） |
| firstName | string | 名（漢字） |
| lastNameRoman | string | 姓（ローマ字） |
| firstNameRoman | string | 名（ローマ字） |
| status | string | 出演者ステータス（pending, active, rejected） |
| kycStatus | string | KYC検証ステータス（pending, verified, rejected） |
| kycVerifiedAt | string/null | KYC検証完了日時（ISO 8601形式） |
| riskScore | number/null | リスクスコア（0.0〜1.0） |
| createdAt | string | 作成日時（ISO 8601形式） |
| updatedAt | string | 更新日時（ISO 8601形式） |

---

### 4.2 出演者情報取得

特定の出演者の詳細情報を取得します。

**エンドポイント**
```
GET /api/performers/:id
```

#### パスパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| id | number | Yes | 出演者ID |

#### リクエスト例

```bash
curl -X GET "https://stg.id-manager.com/api/performers/123" \
  -H "Authorization: Bearer sharegram-api-key-test-2025" \
  -H "Content-Type: application/json"
```

#### レスポンス

**成功時（200 OK）**:

```json
{
  "success": true,
  "data": {
    "id": 123,
    "external_id": "sharegram_performer_456",
    "lastName": "山田",
    "firstName": "花子",
    "lastNameRoman": "Yamada",
    "firstNameRoman": "Hanako",
    "status": "active",
    "kycStatus": "verified",
    "kycVerifiedAt": "2025-05-30T12:00:00.000Z",
    "riskScore": 0.1,
    "documents": {
      "agreementFile": {
        "path": "/uploads/performers/agreementFile-xxx.pdf",
        "originalName": "agreement.pdf",
        "mimeType": "application/pdf",
        "verified": true
      },
      "idFront": {
        "path": "/uploads/performers/idFront-xxx.jpg",
        "originalName": "id_front.jpg",
        "mimeType": "image/jpeg",
        "verified": true
      },
      "idBack": null,
      "selfie": {
        "path": "/uploads/performers/selfie-xxx.jpg",
        "originalName": "selfie.jpg",
        "mimeType": "image/jpeg",
        "verified": true
      },
      "selfieWithId": null
    },
    "createdAt": "2025-05-29T10:15:30.000Z",
    "updatedAt": "2025-05-30T12:00:00.000Z"
  }
}
```

#### レスポンスフィールド

| フィールド | 型 | 説明 |
|-----------|------|------|
| id | number | KYCシステム内部ID |
| external_id | string | Sharegram側の出演者ID |
| lastName | string | 姓（漢字） |
| firstName | string | 名（漢字） |
| lastNameRoman | string | 姓（ローマ字） |
| firstNameRoman | string | 名（ローマ字） |
| status | string | 出演者ステータス |
| kycStatus | string | KYC検証ステータス |
| kycVerifiedAt | string/null | KYC検証完了日時 |
| riskScore | number/null | リスクスコア |
| documents | object | 書類情報 |
| createdAt | string | 作成日時 |
| updatedAt | string | 更新日時 |

**documents内の各書類**:

| フィールド | 型 | 説明 |
|-----------|------|------|
| path | string | ファイルパス |
| originalName | string | 元のファイル名 |
| mimeType | string | MIMEタイプ |
| verified | boolean | 検証済みかどうか |

---

## 5. エラーコード一覧

| エラーコード | HTTPステータス | 説明 |
|-------------|---------------|------|
| AUTH_INVALID_TOKEN | 401 | 認証トークンが無効 |
| AUTH_EXPIRED_TOKEN | 401 | 認証トークンの有効期限切れ |
| FIREBASE_AUTH_ERROR | 401 | Firebase認証エラー |
| RESOURCE_NOT_FOUND | 404 | リソースが見つからない |
| VALIDATION_ERROR | 400 | リクエスト内容が不正 |
| SERVER_ERROR | 500 | サーバー内部エラー |

---

## 6. エラーレスポンス

### 401 Unauthorized

```json
{
  "success": false,
  "message": "認証が必要です"
}
```

### 404 Not Found

```json
{
  "success": false,
  "message": "出演者情報が見つかりません。正しいIDで再度お試しください。"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "message": "出演者情報の取得に失敗しました。",
  "error": "エラー詳細"
}
```

---

## 7. ステータス値

### status（出演者ステータス）

| 値 | 説明 |
|------|------|
| pending | 登録済み、検証待ち |
| active | 有効（検証完了） |
| rejected | 却下 |

### kycStatus（KYC検証ステータス）

| 値 | 説明 |
|------|------|
| pending | KYC検証待ち |
| verified | KYC検証完了 |
| rejected | KYC却下 |

---

## 8. 変更履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2025-12-26 | 1.1.0 | セクション3.3 Firebase SSO認証開始をチャット合意仕様に修正（エンドポイント `/sso`、パラメータ `token`, `action`, `performer_id`, `come_back_url`） |
| 2025-12-10 | 1.0.0 | 初版作成 |

**Mandatory owner scope (security):** List requests without an owner scope return `400` (`owner scope required: user_id / external_ids`); the API never returns a global performer list. Use `GET /api/performers?user_id=<Firebase uid>` or `GET /api/sharegram/performers?user_id=<Sharegram account id>`. `/api/performers?firebase_uid=<Firebase uid>` is also accepted as an explicit Firebase-UID alias. On `/api/performers`, a matching Firebase UID takes precedence for `user_id`; otherwise `user_id` is interpreted as a Sharegram account id. `external_ids` is an explicit scope on Sharegram list requests.
