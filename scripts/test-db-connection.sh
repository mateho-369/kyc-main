#!/bin/bash

# データベース接続テストスクリプト

echo "データベース接続テストを実行しています..."

# MySQLコンテナ内でテストクエリを実行
TEST_QUERY="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'safevideo';"

RESULT=$(docker exec safevideo_mysql_1 mysql -u root -p${DB_PASSWORD} -e "$TEST_QUERY" 2>&1)

if [[ $? -ne 0 ]]; then
    echo "ERROR: データベース接続に失敗しました"
    echo "Error: $RESULT"
    exit 1
fi

# テーブル数を確認
TABLE_COUNT=$(echo "$RESULT" | tail -n 1)
echo "データベース内のテーブル数: $TABLE_COUNT"

# Firebase統合テーブルの存在確認
FIREBASE_TABLES=("firebase_users" "sharegram_integrations" "kyc_requests")

for table in "${FIREBASE_TABLES[@]}"; do
    EXISTS=$(docker exec safevideo_mysql_1 mysql -u root -p${DB_PASSWORD} -D safevideo -e "SHOW TABLES LIKE '$table';" 2>&1 | grep -c "$table")
    if [[ $EXISTS -eq 0 ]]; then
        echo "WARNING: テーブル '$table' が見つかりません"
    else
        echo "OK: テーブル '$table' が存在します"
    fi
done

echo "データベース接続テストが完了しました"