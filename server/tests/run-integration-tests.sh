#!/bin/bash

# 統合テスト実行スクリプト
# SafeVideo KYC統合システムの統合テストを実行

set -e

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ログ関数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ヘッダー表示
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}SafeVideo KYC Integration Test Runner${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 現在のディレクトリ確認
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"

log_info "作業ディレクトリ: $SERVER_DIR"

# サーバーディレクトリに移動
cd "$SERVER_DIR"

# 環境変数の設定
export NODE_ENV=test
export DATABASE_URL=${DATABASE_URL:-"mysql://test:test@localhost:3306/safevideo_test"}
export REDIS_HOST=${REDIS_HOST:-"localhost"}
export REDIS_PORT=${REDIS_PORT:-"6379"}

log_info "テスト環境変数を設定しました"

# 依存関係の確認
log_info "依存関係を確認中..."

# MySQL接続確認
if ! mysql -h localhost -u test -ptest -e "SELECT 1" >/dev/null 2>&1; then
    log_error "MySQL接続に失敗しました。MySQLが起動していることを確認してください。"
    exit 1
fi
log_success "MySQL接続確認OK"

# Redis接続確認
if ! redis-cli -h $REDIS_HOST -p $REDIS_PORT ping >/dev/null 2>&1; then
    log_error "Redis接続に失敗しました。Redisが起動していることを確認してください。"
    exit 1
fi
log_success "Redis接続確認OK"

# テストデータベースのリセット
log_info "テストデータベースをリセット中..."
mysql -h localhost -u test -ptest -e "DROP DATABASE IF EXISTS safevideo_test; CREATE DATABASE safevideo_test;"
log_success "テストデータベースをリセットしました"

# テスト実行オプション
COVERAGE=${COVERAGE:-true}
VERBOSE=${VERBOSE:-false}
SPECIFIC_TEST=$1

# Jestオプション構築
JEST_OPTIONS=""

if [ "$COVERAGE" = "true" ]; then
    JEST_OPTIONS="$JEST_OPTIONS --coverage"
fi

if [ "$VERBOSE" = "true" ]; then
    JEST_OPTIONS="$JEST_OPTIONS --verbose"
fi

# 特定のテストファイル実行
if [ -n "$SPECIFIC_TEST" ]; then
    log_info "特定のテストを実行: $SPECIFIC_TEST"
    TEST_PATH="tests/integration/$SPECIFIC_TEST"
else
    log_info "全ての統合テストを実行"
    TEST_PATH="tests/integration/"
fi

# テスト実行
echo ""
log_info "Jestテストを実行中..."
echo -e "${YELLOW}----------------------------------------${NC}"

# npm testコマンドを実行
if npm test -- $TEST_PATH $JEST_OPTIONS; then
    TEST_RESULT=$?
    log_success "テストが完了しました"
else
    TEST_RESULT=$?
    log_error "テストが失敗しました"
fi

echo -e "${YELLOW}----------------------------------------${NC}"

# カバレッジレポート表示
if [ "$COVERAGE" = "true" ] && [ $TEST_RESULT -eq 0 ]; then
    echo ""
    log_info "カバレッジレポート:"
    cat tests/coverage/text-summary.txt 2>/dev/null || log_warning "カバレッジレポートが見つかりません"
fi

# 結果サマリー
echo ""
echo -e "${BLUE}========================================${NC}"
if [ $TEST_RESULT -eq 0 ]; then
    log_success "✅ 全てのテストが成功しました！"
else
    log_error "❌ テストに失敗がありました"
fi
echo -e "${BLUE}========================================${NC}"

# 使用方法の表示
if [ -z "$1" ]; then
    echo ""
    echo "使用方法:"
    echo "  ./run-integration-tests.sh                    # 全テスト実行"
    echo "  ./run-integration-tests.sh kyc.test.js       # 特定のテスト実行"
    echo ""
    echo "環境変数:"
    echo "  COVERAGE=false ./run-integration-tests.sh    # カバレッジなし"
    echo "  VERBOSE=true ./run-integration-tests.sh      # 詳細出力"
fi

exit $TEST_RESULT