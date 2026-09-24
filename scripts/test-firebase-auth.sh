#!/bin/bash

# Firebase認証テストスクリプト

echo "Firebase認証テストを実行しています..."

# テストユーザー情報
TEST_EMAIL="test@example.com"
TEST_PASSWORD="testPassword123!"

# 1. ユーザー登録テスト
echo "1. ユーザー登録テスト..."
REGISTER_RESPONSE=$(curl -s -X POST http://localhost:5002/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\"}")

if [[ $REGISTER_RESPONSE == *"error"* ]] && [[ $REGISTER_RESPONSE != *"already exists"* ]]; then
    echo "ERROR: ユーザー登録に失敗しました"
    echo "Response: $REGISTER_RESPONSE"
    exit 1
fi

# 2. ログインテスト
echo "2. ログインテスト..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:5002/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\"}")

if [[ $LOGIN_RESPONSE != *"token"* ]]; then
    echo "ERROR: ログインに失敗しました"
    echo "Response: $LOGIN_RESPONSE"
    exit 1
fi

# トークンを抽出
TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.token')

# 3. 認証付きAPIアクセステスト
echo "3. 認証付きAPIアクセステスト..."
PROTECTED_RESPONSE=$(curl -s -X GET http://localhost:5002/api/dashboard \
  -H "Authorization: Bearer ${TOKEN}")

if [[ $PROTECTED_RESPONSE == *"Unauthorized"* ]]; then
    echo "ERROR: 認証付きAPIアクセスに失敗しました"
    echo "Response: $PROTECTED_RESPONSE"
    exit 1
fi

echo "Firebase認証テストが正常に完了しました"