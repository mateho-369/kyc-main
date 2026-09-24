# セキュアな権限チェック機能 - 統合設計仕様書

## 概要

SafeVideoサーバーアプリケーションにおけるセキュアな権限チェック機能の統合設計仕様書です。この設計では、認証・認可・セキュリティの各層で包括的な保護を提供し、認証バイパスや権限昇格攻撃を防止します。

## 1. アーキテクチャ概要

### 1.1 システム構成

```
┌─────────────────────┐
│     クライアント     │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│   API Gateway       │
│   - Rate Limiting   │
│   - IP Restriction  │
│   - Request Logging │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  認証レイヤー        │
│  - 統一認証         │
│  - JWT & Firebase  │
│  - セッション管理   │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  認可レイヤー        │
│  - RBAC            │
│  - Permission-based │
│  - Resource-based  │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  セキュリティレイヤー │
│  - Attack Detection │
│  - Audit Logging   │
│  - Threat Response │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  アプリケーション   │
│  - Business Logic  │
│  - Data Access     │
└─────────────────────┘
```

### 1.2 コンポーネント関係

```
auth-unified.js
├── JWT認証
├── Firebase認証
├── 認証結果の統合
└── セッション管理

permission-manager.js
├── ロールベースアクセス制御
├── 権限チェック
├── 階層的権限管理
└── 動的権限評価

security-enhanced.js
├── 認証バイパス防止
├── 権限昇格攻撃防止
├── 不審なアクセス検出
└── セキュリティイベント記録

api-protection.js
├── エンドポイント保護
├── レート制限
├── 機密データ保護
└── ブルートフォース対策
```

## 2. 統一認証ミドルウェア

### 2.1 設計原則

- **単一エントリポイント**: 全ての認証処理を一箇所で管理
- **複数認証方式サポート**: JWT・Firebase認証の統合
- **フェイルセーフ設計**: 認証失敗時の安全な処理
- **監査ログ統合**: 全認証イベントの記録

### 2.2 実装仕様

```javascript
// 統一認証ミドルウェアの使用例
const { unifiedAuth, requireAuth, requireAdmin } = require('./middleware/auth-unified');

// 基本認証
app.use('/api/protected', unifiedAuth({ required: true }));

// 管理者認証
app.use('/api/admin', requireAdmin);

// オプショナル認証
app.use('/api/public', unifiedAuth({ required: false }));
```

### 2.3 認証フロー

```
1. トークン抽出
   ├── Authorization Header
   ├── Firebase-Token Header
   └── Cookie

2. 認証方式判定
   ├── Firebase優先
   └── JWT フォールバック

3. 認証実行
   ├── トークン検証
   ├── ユーザー情報取得
   └── 権限情報設定

4. 結果処理
   ├── 成功: ユーザー情報設定
   ├── 失敗: エラーレスポンス
   └── 監査ログ記録
```

### 2.4 セキュリティ機能

- **トークン検証**: 署名・有効期限・形式チェック
- **ユーザー状態確認**: アクティブ状態・ブロック状態
- **セッション管理**: 同時セッション制限・IP追跡
- **監査ログ**: 全認証イベントの記録

## 3. 権限管理システム

### 3.1 RBAC（Role-Based Access Control）

#### 3.1.1 デフォルトロール

| ロール | レベル | 権限範囲 |
|--------|--------|----------|
| super_admin | 1000 | 全システム権限 |
| admin | 800 | 管理者権限 |
| moderator | 600 | コンテンツ管理 |
| support | 400 | サポート権限 |
| user | 200 | 基本ユーザー |
| guest | 100 | 限定アクセス |

#### 3.1.2 権限カテゴリ

```javascript
// システム管理権限
SYSTEM_ADMIN: 'system:admin'
SYSTEM_CONFIG: 'system:config'
SYSTEM_LOGS: 'system:logs'

// ユーザー管理権限
USER_CREATE: 'user:create'
USER_READ: 'user:read'
USER_UPDATE: 'user:update'
USER_DELETE: 'user:delete'

// パフォーマー管理権限
PERFORMER_APPROVE: 'performer:approve'
PERFORMER_SUSPEND: 'performer:suspend'

// KYC管理権限
KYC_VERIFY: 'kyc:verify'
KYC_APPROVE: 'kyc:approve'
KYC_REJECT: 'kyc:reject'
```

### 3.2 Permission-Based Access Control

#### 3.2.1 権限チェック方式

```javascript
// 単一権限チェック
const { requirePermission } = require('./middleware/permission-manager');
app.use('/api/admin/users', requirePermission('user:create'));

// 複数権限チェック（AND）
const { requireAllPermissions } = require('./middleware/permission-manager');
app.use('/api/admin/system', requireAllPermissions(['system:admin', 'system:config']));

// 複数権限チェック（OR）
const { requireAnyPermission } = require('./middleware/permission-manager');
app.use('/api/moderate', requireAnyPermission(['performer:approve', 'kyc:verify']));
```

#### 3.2.2 階層的権限管理

```javascript
// 階層的権限チェック
const { requireRole } = require('./middleware/permission-manager');
app.use('/api/admin', requireRole('admin')); // admin以上の権限が必要
```

### 3.3 動的権限チェック

```javascript
// リソースベースの権限チェック
const hasPermission = await permissionManager.checkResourcePermission(
  userId,
  'document',
  'read',
  documentOwnerId
);
```

## 4. セキュリティ強化機能

### 4.1 認証バイパス防止

#### 4.1.1 保護されたパスの定義

```javascript
const protectedPaths = [
  '/api/admin',
  '/api/auth/admin',
  '/api/performers/admin',
  '/api/audit-logs',
  '/api/system'
];
```

#### 4.1.2 バイパス検出パターン

```javascript
const suspiciousPatterns = [
  /\.\.\//, // Path traversal
  /\/admin\/\w+\/bypass/, // Admin bypass attempts
  /\/auth\/\w+\/skip/, // Auth skip attempts
  /\/system\/\w+\/override/ // System override attempts
];
```

### 4.2 セッション管理の強化

#### 4.2.1 セッション情報

```javascript
const sessionInfo = {
  userId: user.id,
  sessionId: generateSessionId(),
  clientIP: req.ip,
  userAgent: req.headers['user-agent'],
  lastActivity: Date.now(),
  authMethod: 'jwt|firebase'
};
```

#### 4.2.2 セッション保護

- **IP追跡**: 異なるIPからのアクセス検出
- **User-Agent検証**: 異なるブラウザからのアクセス検出
- **同時セッション制限**: 最大同時セッション数の制限
- **セッション有効期限**: 24時間の自動タイムアウト

### 4.3 権限昇格攻撃の防止

#### 4.3.1 昇格パターン検出

```javascript
const escalationPatterns = [
  { pattern: /\/api\/users\/\d+\/role/, method: 'PUT' },
  { pattern: /\/api\/auth\/promote/, method: 'POST' },
  { pattern: /\/api\/admin\/grant/, method: 'POST' }
];
```

#### 4.3.2 リクエストボディ検証

```javascript
const suspiciousFields = ['role', 'permissions', 'isAdmin', 'level'];
```

### 4.4 不審なアクセス検出

#### 4.4.1 攻撃パターン

```javascript
const attackPatterns = [
  // SQLインジェクション
  /(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bUNION\b)/i,
  
  // XSS
  /<script[^>]*>.*?<\/script>/i,
  
  // Path traversal
  /\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c/i,
  
  // Command injection
  /(\|\||&&|;|`|\$\(|\${)/
];
```

## 5. API保護戦略

### 5.1 エンドポイント分類

#### 5.1.1 保護レベル

| カテゴリ | 認証 | 権限 | レート制限 | 例 |
|----------|------|------|------------|-----|
| public | 不要 | なし | 低 | /api/health |
| protected | 必須 | 基本 | 中 | /api/profile |
| admin | 必須 | 管理者 | 高 | /api/admin |
| webhook | カスタム | なし | 中 | /api/webhooks |

#### 5.1.2 レート制限設定

```javascript
const RATE_LIMITS = {
  GENERAL: { windowMs: 15 * 60 * 1000, max: 100 },
  AUTH: { windowMs: 15 * 60 * 1000, max: 5 },
  ADMIN: { windowMs: 15 * 60 * 1000, max: 200 },
  UPLOAD: { windowMs: 60 * 60 * 1000, max: 10 }
};
```

### 5.2 API保護実装

#### 5.2.1 保護設定の適用

```javascript
const { applyApiProtection } = require('./middleware/api-protection');

// Express アプリケーションに保護を適用
applyApiProtection(app);
```

#### 5.2.2 個別エンドポイント保護

```javascript
// 管理者専用エンドポイント
app.use('/api/admin', 
  createRateLimit(RATE_LIMITS.ADMIN),
  unifiedAuth({ required: true }),
  requirePermission(PERMISSIONS.SYSTEM_ADMIN)
);

// ファイルアップロード
app.use('/api/upload',
  createRateLimit(RATE_LIMITS.UPLOAD),
  unifiedAuth({ required: true }),
  requirePermission(PERMISSIONS.DOCUMENT_CREATE)
);
```

### 5.3 機密データ保護

#### 5.3.1 レスポンスサニタイゼーション

```javascript
const sensitiveFields = [
  'password',
  'passwordHash',
  'privateKey',
  'secret',
  'token',
  'apiKey'
];
```

#### 5.3.2 データマスキング

```javascript
const sanitizeResponse = (data) => {
  // 機密フィールドの除去
  // ネストされたオブジェクトの処理
  // 配列データの処理
};
```

## 6. 監査とログ記録

### 6.1 セキュリティイベント

#### 6.1.1 イベントタイプ

```javascript
const SECURITY_EVENT_TYPES = {
  AUTH_BYPASS_ATTEMPT: 'auth_bypass_attempt',
  PRIVILEGE_ESCALATION: 'privilege_escalation',
  SESSION_HIJACKING: 'session_hijacking',
  SUSPICIOUS_PAYLOAD: 'suspicious_payload',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded'
};
```

#### 6.1.2 ログ記録内容

```javascript
const logEntry = {
  event: 'SECURITY_EVENT',
  message: 'Description',
  details: {
    userId: 'user123',
    clientIP: '192.168.1.1',
    userAgent: 'Mozilla/5.0...',
    requestPath: '/api/admin',
    method: 'POST'
  },
  timestamp: new Date(),
  severity: 'high|medium|low'
};
```

### 6.2 監査ログ統合

#### 6.2.1 ログ出力先

- **ファイル**: `/logs/security.log`
- **データベース**: `audit_logs` テーブル
- **外部サービス**: Syslog、CloudWatch、Elasticsearch

#### 6.2.2 アラート機能

```javascript
// 高重要度イベントのアラート
if (logEntry.severity === 'high' || logEntry.severity === 'critical') {
  await sendSecurityAlert(logEntry);
}
```

## 7. 実装ガイドライン

### 7.1 セットアップ手順

#### 7.1.1 パッケージインストール

```bash
npm install express-rate-limit express-slow-down
npm install firebase-admin jsonwebtoken
npm install crypto bcryptjs
```

#### 7.1.2 環境変数設定

```env
# JWT設定
JWT_SECRET=your-strong-jwt-secret

# Firebase設定
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_PRIVATE_KEY=your-private-key

# セキュリティ設定
STRICT_SESSION_SECURITY=true
MAX_CONCURRENT_SESSIONS=3
API_KEYS=key1,key2,key3
WEBHOOK_SECRET=your-webhook-secret

# IP制限
ALLOWED_IPS=192.168.1.0/24,10.0.0.0/8
```

### 7.2 統合方法

#### 7.2.1 Express アプリケーション

```javascript
const express = require('express');
const { applyApiProtection } = require('./middleware/api-protection');
const { permissionManager } = require('./middleware/permission-manager');

const app = express();

// セキュリティ設定の適用
applyApiProtection(app);

// デフォルトロールの初期化
await permissionManager.initializeDefaultRoles();

// サーバー起動
app.listen(3000, () => {
  console.log('Server running with enhanced security');
});
```

#### 7.2.2 ルート設定

```javascript
const { requireAuth, requireAdmin } = require('./middleware/auth-unified');
const { requirePermission } = require('./middleware/permission-manager');

// 認証必須
app.use('/api/protected', requireAuth);

// 管理者必須
app.use('/api/admin', requireAdmin);

// 特定権限必須
app.use('/api/kyc', requirePermission('kyc:verify'));
```

### 7.3 テスト方法

#### 7.3.1 認証テスト

```javascript
// JWT認証テスト
const response = await request(app)
  .get('/api/protected')
  .set('Authorization', `Bearer ${jwtToken}`)
  .expect(200);

// Firebase認証テスト
const response = await request(app)
  .get('/api/protected')
  .set('Firebase-Token', firebaseToken)
  .expect(200);
```

#### 7.3.2 権限テスト

```javascript
// 権限不足テスト
const response = await request(app)
  .get('/api/admin')
  .set('Authorization', `Bearer ${userToken}`)
  .expect(403);

// 権限充足テスト
const response = await request(app)
  .get('/api/admin')
  .set('Authorization', `Bearer ${adminToken}`)
  .expect(200);
```

## 8. 運用とメンテナンス

### 8.1 定期的な作業

#### 8.1.1 セキュリティ監視

- **ログ監視**: 異常なアクセスパターンの検出
- **アラート確認**: 高重要度イベントの対応
- **統計分析**: 認証・認可の失敗率分析

#### 8.1.2 設定見直し

- **レート制限**: トラフィックに応じた調整
- **権限設定**: 新しい機能に対する権限定義
- **セキュリティポリシー**: 脅威の変化に応じた更新

### 8.2 トラブルシューティング

#### 8.2.1 よくある問題

1. **認証失敗**: トークンの有効期限・形式確認
2. **権限エラー**: ユーザーのロール・権限確認
3. **レート制限**: 制限値の調整
4. **セッション問題**: IP・User-Agent の変更確認

#### 8.2.2 ログの確認

```bash
# セキュリティログの確認
tail -f logs/security.log

# 監査ログの確認
tail -f logs/audit.log

# エラーログの確認
tail -f logs/error.log
```

## 9. セキュリティ考慮事項

### 9.1 脅威モデル

#### 9.1.1 対象脅威

- **認証バイパス**: 不正な認証回避
- **権限昇格**: 不正な権限取得
- **セッションハイジャック**: セッション乗っ取り
- **ブルートフォース**: 総当たり攻撃
- **DDoS**: サービス拒否攻撃

#### 9.1.2 対策レベル

| 脅威 | 対策レベル | 実装状況 |
|------|------------|----------|
| 認証バイパス | 高 | ✅ 完了 |
| 権限昇格 | 高 | ✅ 完了 |
| セッションハイジャック | 中 | ✅ 完了 |
| ブルートフォース | 中 | ✅ 完了 |
| DDoS | 中 | ✅ 完了 |

### 9.2 セキュリティベストプラクティス

#### 9.2.1 認証

- **強力なパスワード**: 複雑なパスワード要件
- **多要素認証**: 2FA の実装推奨
- **トークン管理**: 適切な有効期限設定
- **暗号化**: 機密データの暗号化

#### 9.2.2 認可

- **最小権限の原則**: 必要最小限の権限付与
- **権限の定期見直し**: 不要な権限の削除
- **ロール分離**: 適切なロール設計
- **監査証跡**: 権限変更の記録

#### 9.2.3 一般的なセキュリティ

- **入力検証**: 全入力データの検証
- **出力エンコーディング**: XSS対策
- **HTTPS強制**: 通信の暗号化
- **セキュリティヘッダー**: 適切なHTTPヘッダー設定

## 10. 結論

本設計では、SafeVideoサーバーアプリケーションにおいて、認証・認可・セキュリティの各層で包括的な保護を提供する統合システムを実装しました。

### 10.1 主な成果

1. **統一認証システム**: JWT・Firebase認証の統合
2. **階層的権限管理**: RBAC・Permission-based の実装
3. **セキュリティ強化**: 攻撃検出・防御機能の実装
4. **API保護**: 全エンドポイントの保護設定
5. **監査ログ**: 包括的なログ記録システム

### 10.2 セキュリティレベル

- **認証**: 多重認証・フェイルセーフ設計
- **認可**: 細粒度権限制御・動的チェック
- **攻撃対策**: 多層防御・リアルタイム検出
- **監査**: 全イベント記録・アラート機能

### 10.3 今後の拡張

1. **機械学習**: 異常検出の高度化
2. **自動対応**: 脅威の自動ブロック
3. **統合**: SIEM システムとの連携
4. **分析**: セキュリティ分析の高度化

このセキュリティ設計により、SafeVideoサーバーは現代的な脅威に対して堅牢な防御を提供し、安全で信頼性の高いサービスを実現できます。