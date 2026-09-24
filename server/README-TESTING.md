# SafeVideo KYC - テスト環境ガイド

## 📋 目次

1. [テスト概要](#テスト概要)
2. [テスト環境構築](#テスト環境構築)
3. [テスト実行方法](#テスト実行方法)
4. [テスト種別詳細](#テスト種別詳細)
5. [カバレッジ目標](#カバレッジ目標)
6. [継続的インテグレーション](#継続的インテグレーション)
7. [トラブルシューティング](#トラブルシューティング)

## テスト概要

SafeVideo KYCシステムは包括的なテスト戦略を採用し、以下の4つのテストレイヤーで品質を保証しています：

### テストピラミッド
```
        E2E Tests
       /           \
    Integration Tests
   /                   \
  Unit Tests (基盤)
```

- **単体テスト (Unit Tests)**: 個別のコンポーネント・関数の動作検証
- **統合テスト (Integration Tests)**: API・データベース統合動作検証
- **E2Eテスト (End-to-End Tests)**: 実際のユーザーフロー検証
- **パフォーマンステスト**: 負荷・ストレス・データベース性能検証

### 品質目標
- **テストカバレッジ**: 80%以上
- **E2Eカバレッジ**: 主要ユーザーフロー100%
- **APIレスポンス時間**: 95%ile < 500ms
- **エラー率**: < 5%

## テスト環境構築

### 1. 必須依存関係

```bash
# Node.js パッケージインストール
npm install

# K6 (パフォーマンステスト用)
# macOS
brew install k6

# Ubuntu/Debian
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
choco install k6
```

### 2. テストデータベース設定

```bash
# テスト用データベース作成
mysql -u root -p -e "CREATE DATABASE safevideo_test;"

# 環境変数設定
export NODE_ENV=test
export DATABASE_URL="mysql://username:password@localhost:3306/safevideo_test"
export REDIS_DB=15  # テスト用Redis DB
```

### 3. Redis設定

```bash
# Redis起動
redis-server

# テスト用DB確認
redis-cli SELECT 15
redis-cli FLUSHDB
```

## テスト実行方法

### 🚀 基本コマンド

```bash
# 全テスト実行（推奨）
npm test

# 特定のテストタイプのみ実行
npm run test:unit           # 単体テスト
npm run test:integration    # 統合テスト
npm run test:e2e            # E2Eテスト
npm run test:performance    # パフォーマンステスト

# その他のオプション
npm run test:coverage       # カバレッジ付きテスト
npm run test:watch          # ウォッチモード
npm run test:ci             # CI環境用（E2Eスキップ）
```

### ⚙️ 高度なオプション

```bash
# 単体テストのみ実行
node tests/scripts/run-all-tests.js --unit-only

# E2Eテストスキップ
node tests/scripts/run-all-tests.js --skip-e2e

# パフォーマンステストスキップ
node tests/scripts/run-all-tests.js --skip-performance

# 詳細出力
node tests/scripts/run-all-tests.js --verbose

# ヘルプ表示
node tests/scripts/run-all-tests.js --help
```

### 🎯 対象別テスト実行

```bash
# 認証系のテストのみ
npm run test:unit -- --testNamePattern="auth"

# 特定ファイルのテスト
npm run test:integration -- tests/integration/auth.test.js

# E2Eテストをブラウザで実行
npm run test:e2e:open
```

## テスト種別詳細

### 1. 単体テスト (Unit Tests)

**対象**: 個別関数、ユーティリティ、バリデーション等
**フレームワーク**: Jest + Supertest

```bash
# 実行
npm run test:unit

# ウォッチモード
npm run test:watch
```

**テストファイル場所**: `tests/unit/`

### 2. 統合テスト (Integration Tests)

**対象**: APIエンドポイント、データベース操作、外部サービス連携
**フレームワーク**: Jest + Supertest

```bash
# 実行
npm run test:integration
```

**主要テスト項目**:
- 認証フロー (`tests/integration/auth.test.js`)
- API v1 全機能 (`tests/integration/api-v1.test.js`)
- データベース操作
- Firebase連携
- エラーハンドリング
- レート制限

### 3. E2Eテスト (End-to-End Tests)

**対象**: 実際のブラウザでのユーザーインタラクション
**フレームワーク**: Cypress

```bash
# ヘッドレス実行
npm run test:e2e

# ブラウザで実行（開発用）
npm run test:e2e:open
```

**主要テストシナリオ**:
- 認証フロー (`tests/e2e/integration/auth-flow.cy.js`)
- パフォーマー管理 (`tests/e2e/integration/performer-management.cy.js`)
- 一括操作
- 検索・フィルタリング
- レスポンシブデザイン
- アクセシビリティ

**カスタムコマンド**:
- `cy.login()` - ログイン
- `cy.createPerformer()` - パフォーマー作成
- `cy.performBatchImport()` - バッチインポート
- `cy.testAccessibility()` - アクセシビリティチェック

### 4. パフォーマンステスト

**フレームワーク**: K6

#### 4.1 基本負荷テスト
```bash
npm run test:performance
```
- 段階的負荷増加（10→100ユーザー）
- APIレスポンス時間測定
- スループット測定
- エラー率監視

#### 4.2 ストレステスト
```bash
npm run test:stress
```
- 高負荷テスト（最大1000ユーザー）
- システム限界点の特定
- 回復性テスト

#### 4.3 データベース性能テスト
```bash
npm run test:db-performance
```
- 複雑クエリ性能
- 接続プール負荷
- JOIN集約処理

## カバレッジ目標

### 目標値
- **全体カバレッジ**: 80%以上
- **ステートメント**: 80%以上
- **ブランチ**: 75%以上
- **関数**: 85%以上
- **行**: 80%以上

### カバレッジ除外対象
```javascript
// jest.config.js
collectCoverageFrom: [
  'routes/**/*.js',
  'middleware/**/*.js',
  'models/**/*.js',
  'services/**/*.js',
  'utils/**/*.js',
  '!**/node_modules/**',
  '!**/tests/**',        // テストファイル除外
  '!**/coverage/**',     // カバレッジレポート除外
  '!server.js'           // エントリーポイント除外
]
```

### カバレッジレポート確認
```bash
# カバレッジ付きテスト実行
npm run test:coverage

# HTMLレポート確認
open tests/coverage/lcov-report/index.html
```

## 継続的インテグレーション

### GitHub Actions設定例

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: safevideo_test
        ports:
          - 3306:3306
      
      redis:
        image: redis:7
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install K6
        run: |
          sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6
      
      - name: Run tests
        run: npm run test:ci
        env:
          NODE_ENV: test
          DATABASE_URL: mysql://root:root@127.0.0.1:3306/safevideo_test
          REDIS_HOST: 127.0.0.1
      
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          file: ./tests/coverage/lcov.info
```

### PR時の自動チェック

```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npm run lint
npm run test:unit
```

## トラブルシューティング

### よくある問題と解決方法

#### 1. データベース接続エラー
```bash
# エラー: ECONNREFUSED 127.0.0.1:3306
# 解決: MySQLサービス起動確認
brew services start mysql
# または
systemctl start mysql
```

#### 2. Redis接続エラー
```bash
# エラー: Redis connection failed
# 解決: Redisサービス起動
redis-server
```

#### 3. E2Eテスト失敗
```bash
# エラー: Cypress binary not found
# 解決: Cypressの再インストール
npx cypress install
```

#### 4. K6が見つからない
```bash
# エラー: k6: command not found
# 解決: K6インストール確認
which k6
# または再インストール
brew install k6
```

#### 5. メモリ不足エラー
```bash
# エラー: JavaScript heap out of memory
# 解決: Node.jsメモリ制限拡張
export NODE_OPTIONS="--max-old-space-size=4096"
npm test
```

#### 6. ポート競合エラー
```bash
# エラー: Port 3000 is already in use
# 解決: プロセス確認・終了
lsof -ti:3000 | xargs kill -9
```

### テストデータリセット

```bash
# データベースリセット
npm run db:reset

# Redis テストデータクリア
redis-cli SELECT 15
redis-cli FLUSHDB

# テストログクリア
npm run logs:clear
```

### デバッグモード

```bash
# Jestデバッグ
node --inspect-brk node_modules/.bin/jest --runInBand

# Cypressデバッグ
DEBUG=cypress:* npm run test:e2e

# K6詳細ログ
k6 run --log-output=file=k6.log tests/performance/k6-config.js
```

## テストレポート

### 自動生成レポート

テスト実行後、以下のレポートが自動生成されます：

- **HTMLレポート**: `tests/reports/test-report-{timestamp}.html`
- **最新レポート**: `tests/reports/latest-report.html`
- **カバレッジレポート**: `tests/coverage/lcov-report/index.html`
- **パフォーマンスレポート**: `tests/performance/reports/`

### レポート確認

```bash
# 最新のテストレポートを開く
open tests/reports/latest-report.html

# カバレッジレポートを開く
open tests/coverage/lcov-report/index.html
```

---

## 🚀 クイックスタート

```bash
# 1. 依存関係インストール
npm install

# 2. 環境設定
export NODE_ENV=test

# 3. テスト実行
npm test
```

これで SafeVideo KYC システムの包括的なテストが実行されます！

---

**問題が発生した場合は、開発チームまでお問い合わせください。**