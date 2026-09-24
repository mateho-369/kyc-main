# Sharegram KYC Integration Components

このディレクトリには、Sharegram連携用のフロントエンドコンポーネントが含まれています。

## コンポーネント一覧

### 1. SharegramGateway.jsx
Sharegram KYC登録のメインゲートウェイコンポーネント

**機能:**
- URLパラメータの検証と解析
- セキュリティチェック
- 3段階の進捗表示
- Firebase認証画面への遷移
- 認証完了後のSharegramへの結果送信

**URLパラメータ:**
- `user_id`: SharegramユーザーID（必須）
- `callback_url`: 認証完了後のコールバックURL（必須）
- `api_key`: Sharegram APIキー（必須）
- `redirect_url`: 最終リダイレクトURL（オプション）
- `company_id`: 企業ID（オプション）
- `session_id`: セッションID（オプション）
- `locale`: 言語設定（デフォルト: ja）

### 2. SharegramFirebaseAuth.jsx
Firebase認証を行うコンポーネント

**機能:**
- メール/パスワード認証
- Google認証
- 新規登録・ログイン・パスワードリセット
- Sharegram用の追加情報の保存
- 認証完了後のコールバック処理

**セキュリティ機能:**
- フォームバリデーション
- エラーハンドリング
- CSRFトークン対応
- セッション管理

## 使用方法

### 基本的な使用例

```jsx
import SharegramGateway from './components/sharegram/SharegramGateway';

// /kyc/register?user_id=123&callback_url=https://sharegram.com/callback&api_key=abc123
function App() {
  return (
    <Routes>
      <Route path="/kyc/register" element={<SharegramGateway />} />
    </Routes>
  );
}
```

### 認証成功時の処理

```jsx
const handleAuthSuccess = (user, idToken) => {
  // 認証成功時の処理
  console.log('認証成功:', user);
  
  // Sharegramに結果を送信
  sendAuthResultToSharegram(user, idToken, sharegramParams);
};
```

## APIエンドポイント

### 1. POST /api/sharegram/auth-result
認証結果をSharegramに送信

**リクエスト:**
```json
{
  "callback_url": "https://sharegram.com/callback",
  "api_key": "your-api-key",
  "result": {
    "user_id": "sharegram-user-id",
    "firebase_uid": "firebase-uid",
    "email": "user@example.com",
    "display_name": "User Name",
    "photo_url": "https://example.com/photo.jpg",
    "session_id": "session-id",
    "status": "success"
  }
}
```

### 2. POST /api/users/sharegram-register
Sharegram用ユーザー情報の保存

**リクエスト:**
```json
{
  "firebase_uid": "firebase-uid",
  "sharegram_user_id": "sharegram-user-id",
  "email": "user@example.com",
  "display_name": "User Name",
  "photo_url": "https://example.com/photo.jpg",
  "session_id": "session-id",
  "company_id": "company-id",
  "locale": "ja"
}
```

## スタイリング

### レスポンシブデザイン
- モバイル: 768px以下
- タブレット: 769px-1024px
- デスクトップ: 1025px以上

### カスタムCSS
```css
/* モバイル最適化 */
@media (max-width: 768px) {
  .sharegram-container {
    padding: 1rem;
  }
  
  .progress-steps {
    flex-direction: column;
    gap: 1rem;
  }
}

/* アニメーション */
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

## セキュリティ

### URLパラメータ検証
- 必須パラメータの存在チェック
- URL形式の検証
- 文字列形式の検証

### APIキー検証
- 環境変数での管理
- ハッシュ化による保存
- 本番環境での厳密な検証

### セキュリティヘッダー
- HTTPS強制
- CSRFトークン
- セキュアCookie

## エラーハンドリング

### 検証エラー
```jsx
const validationErrors = [
  'ユーザーIDが指定されていません',
  'コールバックURLが指定されていません',
  'APIキーが指定されていません'
];
```

### セキュリティ警告
```jsx
const securityWarnings = [
  'コールバックURLはHTTPSが推奨されます',
  '不正なリファラーからのアクセスです'
];
```

## 開発・デバッグ

### ログ出力
```javascript
// 開発環境でのみログを出力
if (process.env.NODE_ENV === 'development') {
  console.log('Debug info:', debugData);
}
```

### テスト用URL
```
http://localhost:3000/kyc/register?user_id=test123&callback_url=https://example.com/callback&api_key=test-key
```

## 今後の拡張

1. **多言語対応**
   - i18nライブラリの導入
   - 言語パラメータに基づく表示切り替え

2. **認証方法の追加**
   - Facebook認証
   - Twitter認証
   - Apple認証

3. **KYC機能の拡張**
   - 本人確認書類のアップロード
   - 顔認証
   - 住所確認

4. **分析機能**
   - 認証完了率の追跡
   - エラー発生率の監視
   - ユーザー行動の分析

## 参考リンク

- [Firebase Authentication](https://firebase.google.com/docs/auth)
- [React Router](https://reactrouter.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Lucide Icons](https://lucide.dev/)