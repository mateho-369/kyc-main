# パフォーマンス最適化ガイド

## 概要
このドキュメントでは、Sharegram KYCシステムに実装されたパフォーマンス最適化機能について説明します。

## 1. データベースインデックス最適化

### 実装ファイル
`migrations/20240101000013-add-performance-indexes.js`

### インデックス一覧

#### Performersテーブル
- **idx_performers_external_id**: external_idの一意インデックス（高速検索）
- **idx_performers_status_kyc_status**: status + kycStatusの複合インデックス
- **idx_performers_user_id_status**: userId + statusの複合インデックス
- **idx_performers_active_only**: アクティブなパフォーマーのみの部分インデックス
- **idx_performers_created_at/updated_at**: ソート用インデックス
- **idx_performers_fulltext_name**: 名前の全文検索インデックス（PostgreSQL）

#### AuditLogsテーブル
- **idx_audit_logs_user_action**: userId + actionの複合インデックス
- **idx_audit_logs_resource**: resourceType + resourceIdの複合インデックス
- **idx_audit_logs_recent_user_activity**: 最近30日のアクティビティ部分インデックス

#### その他のテーブル
- ApiLogs、SharegramIntegrations、KycDocumentsにも適切なインデックスを追加

### マイグレーション実行
```bash
npm run migrate
# または
npx sequelize-cli db:migrate
```

## 2. 多層キャッシュ戦略

### 実装ファイル
`services/cacheStrategy.js`

### キャッシュレイヤー
1. **L1キャッシュ（メモリ）**
   - NodeCacheを使用
   - 超高速アクセス（ナノ秒レベル）
   - TTL: 60秒（デフォルト）
   - 最大10,000キー

2. **L2キャッシュ（Redis）**
   - 分散キャッシュ
   - 複数サーバー間で共有
   - TTL: 300秒（デフォルト）
   - 永続化オプション

### 使用例

```javascript
const { cacheStrategy } = require('./services/cacheStrategy');

// 単一値の取得/設定
const data = await cacheStrategy.getOrSet(
  'performer:123',
  async () => await fetchPerformerFromDB(123),
  { ttl: 600 }
);

// バッチ取得
const results = await cacheStrategy.mget([
  'performer:123',
  'performer:124',
  'performer:125'
]);

// キャッシュ削除
await cacheStrategy.delete('performer:123');
await cacheStrategy.deletePattern('performer:*');

// 統計情報
const stats = cacheStrategy.getStats();
console.log(stats.hitRates); // { l1: '85.50%', l2: '92.30%' }
```

## 3. N+1問題の解決

### 実装ファイル
`services/queryOptimizer.js`

### 最適化されたクエリメソッド

#### getPerformersOptimized
```javascript
const { queryOptimizer } = require('./services/queryOptimizer');

// N+1問題を回避した一覧取得
const result = await queryOptimizer.getPerformersOptimized({
  status: 'active',
  page: 1,
  limit: 50
});
```

特徴：
- 関連データを1つのクエリで取得
- 必要な属性のみを選択
- separateオプションで別クエリ実行
- 自動キャッシング

#### getPerformerWithRelations
```javascript
// 関連データを含む単一エンティティ取得
const performer = await queryOptimizer.getPerformerWithRelations(123);
```

#### getPerformersBatch
```javascript
// IN句を使用したバッチ取得
const performers = await queryOptimizer.getPerformersBatch([123, 124, 125]);
```

## 4. パフォーマンスベストプラクティス

### クエリ最適化
1. **適切なインデックスの使用**
   - WHERE句で使用するカラムにインデックス
   - 複合インデックスは左端から使用

2. **選択的な属性取得**
   ```javascript
   // Good
   Performer.findAll({ attributes: ['id', 'name', 'status'] })
   
   // Bad
   Performer.findAll() // 全属性を取得
   ```

3. **Eager Loading vs Lazy Loading**
   ```javascript
   // Eager Loading（推奨）
   Performer.findAll({ include: [User] })
   
   // Lazy Loading（N+1問題の原因）
   const performers = await Performer.findAll();
   for (const p of performers) {
     await p.getUser(); // N+1問題！
   }
   ```

### キャッシュ戦略
1. **適切なTTL設定**
   - 頻繁に変更されるデータ: 1-5分
   - 静的なマスターデータ: 1-24時間
   - ユーザーセッション: 15-30分

2. **キャッシュキーの設計**
   ```javascript
   // Good: 階層的で予測可能
   'performer:123:basic'
   'performers:list:active:page:1'
   
   // Bad: フラットで管理困難
   'performer123basic'
   ```

3. **キャッシュ無効化**
   ```javascript
   // データ更新時は必ずキャッシュを無効化
   await performer.update(data);
   await queryOptimizer.invalidatePerformerCache(performer.id);
   ```

### 監視とメトリクス
1. **キャッシュヒット率の監視**
   ```javascript
   const stats = cacheStrategy.getStats();
   // L1ヒット率 > 80%、L2ヒット率 > 90%を目標
   ```

2. **クエリ実行時間の監視**
   ```javascript
   const start = Date.now();
   const result = await query();
   const duration = Date.now() - start;
   console.log(`Query took ${duration}ms`);
   ```

3. **メモリ使用量の監視**
   ```javascript
   const memStats = cacheStrategy.getStats().memoryUsage;
   ```

## 5. トラブルシューティング

### パフォーマンス問題の診断
1. **スロークエリの特定**
   ```sql
   -- PostgreSQL
   SELECT query, calls, mean_time
   FROM pg_stat_statements
   ORDER BY mean_time DESC
   LIMIT 10;
   ```

2. **インデックスの使用状況確認**
   ```sql
   -- PostgreSQL
   SELECT schemaname, tablename, indexname, idx_scan
   FROM pg_stat_user_indexes
   ORDER BY idx_scan;
   ```

3. **キャッシュミスの調査**
   - キャッシュキーの一貫性を確認
   - TTLが短すぎないか確認
   - キャッシュサイズの制限を確認

### よくある問題と解決策

| 問題 | 原因 | 解決策 |
|------|------|--------|
| 高いレスポンスタイム | N+1問題 | queryOptimizerを使用 |
| メモリ使用量増加 | キャッシュサイズ無制限 | maxKeys設定を調整 |
| キャッシュヒット率低下 | TTLが短すぎる | 適切なTTLに調整 |
| DBコネクション枯渇 | 同時接続数過多 | コネクションプール調整 |

## 6. パフォーマンステスト

### 負荷テストツール
```bash
# Apache Bench
ab -n 1000 -c 50 http://localhost:5000/api/performers

# Artillery
artillery quick --count 50 --num 1000 http://localhost:5000/api/performers
```

### ベンチマーク目標
- API応答時間: < 100ms (P95)
- キャッシュヒット率: > 90%
- 同時接続数: > 1000
- スループット: > 1000 req/s