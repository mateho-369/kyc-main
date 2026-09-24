#!/bin/bash

set -e

echo "🐳 Docker環境でのテスト実行開始"
echo "================================="

# 環境変数確認
echo "📋 環境設定確認:"
echo "NODE_ENV: ${NODE_ENV}"
echo "BASE_URL: ${BASE_URL}"
echo "DATABASE_URL: ${DATABASE_URL}"
echo "REDIS_HOST: ${REDIS_HOST}"

# データベース接続待機
echo "🔄 データベース接続待機中..."
until mysql -h test-mysql -u test_user -ptest_password -e "SELECT 1" safevideo_test >/dev/null 2>&1; do
  echo "⏳ MySQL待機中..."
  sleep 2
done
echo "✅ MySQL接続確認"

# Redis接続待機
echo "🔄 Redis接続待機中..."
until redis-cli -h test-redis ping >/dev/null 2>&1; do
  echo "⏳ Redis待機中..."
  sleep 1
done
echo "✅ Redis接続確認"

# API サーバー起動待機
echo "🔄 APIサーバー起動待機中..."
until curl -f "${BASE_URL}/health" >/dev/null 2>&1; do
  echo "⏳ API待機中..."
  sleep 3
done
echo "✅ API接続確認"

# データベース初期化
echo "🗄️ テストデータベース初期化..."
npm run db:reset || echo "⚠️ DB初期化スキップ（既に初期化済み）"

# 引数に応じてテスト実行
case "${1:-all}" in
  "unit")
    echo "🧪 単体テスト実行中..."
    npm run test:unit
    ;;
  "integration")
    echo "🔗 統合テスト実行中..."
    npm run test:integration
    ;;
  "e2e")
    echo "🎭 E2Eテスト実行中..."
    # Cypressはヘッドレスモードで実行
    npm run test:e2e -- --headless
    ;;
  "performance")
    echo "⚡ パフォーマンステスト実行中..."
    # K6テスト実行
    k6 run --out json=/app/tests/reports/k6-results.json /app/tests/performance/k6-config.js
    ;;
  "stress")
    echo "🔥 ストレステスト実行中..."
    k6 run --duration 2m --vus 50 --out json=/app/tests/reports/stress-results.json /app/tests/performance/stress-test.js
    ;;
  "db-performance")
    echo "🗄️ データベース性能テスト実行中..."
    k6 run --duration 1m --vus 20 --out json=/app/tests/reports/db-performance-results.json /app/tests/performance/database-performance.js
    ;;
  "coverage")
    echo "📊 カバレッジテスト実行中..."
    npm run test:coverage
    ;;
  "all")
    echo "🚀 全テスト実行中..."
    
    # 段階的テスト実行
    echo "1️⃣ 単体テスト実行..."
    npm run test:unit || TEST_FAILED=1
    
    echo "2️⃣ 統合テスト実行..."
    npm run test:integration || TEST_FAILED=1
    
    echo "3️⃣ カバレッジ測定..."
    npm run test:coverage || echo "⚠️ カバレッジ測定失敗"
    
    echo "4️⃣ パフォーマンステスト実行..."
    k6 run --out json=/app/tests/reports/k6-results.json /app/tests/performance/k6-config.js || echo "⚠️ パフォーマンステスト失敗"
    
    echo "5️⃣ 軽量ストレステスト実行..."
    k6 run --duration 1m --vus 30 --out json=/app/tests/reports/stress-light-results.json /app/tests/performance/stress-test.js || echo "⚠️ ストレステスト失敗"
    
    echo "6️⃣ 包括的レポート生成..."
    node /app/tests/scripts/run-all-tests.js --skip-e2e || echo "⚠️ レポート生成失敗"
    
    if [ "$TEST_FAILED" = "1" ]; then
      echo "❌ 一部テストが失敗しました"
      exit 1
    fi
    ;;
  *)
    echo "❓ 不明なテストタイプ: $1"
    echo "利用可能なオプション: unit, integration, e2e, performance, stress, db-performance, coverage, all"
    exit 1
    ;;
esac

echo "🎉 テスト実行完了"

# 結果ファイルの確認
if [ -d "/app/tests/reports" ]; then
  echo "📄 生成されたレポート:"
  ls -la /app/tests/reports/
fi

if [ -d "/app/tests/coverage" ]; then
  echo "📈 カバレッジレポート:"
  ls -la /app/tests/coverage/
fi

echo "✅ Docker環境でのテスト実行完了"