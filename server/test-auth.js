/**
 * 権限チェック完全テストスクリプト
 * dev2の修正作業支援用
 */

const jwt = require('jsonwebtoken');
const axios = require('axios');

// テスト用のJWTトークン生成
function generateTestToken(userId, role) {
  const payload = {
    user: { id: userId },
    role: role
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
}

// テストシナリオ
async function runSecurityTests() {
  console.log('🔍 権限チェック完全テスト開始');
  console.log('==========================================');
  
  const baseUrl = 'http://localhost:5001/api';
  
  // テストトークンの生成
  const adminToken = generateTestToken(1, 'admin');
  const userToken = generateTestToken(2, 'user');
  
  console.log('🎯 生成されたトークン:');
  console.log('Admin Token:', adminToken);
  console.log('User Token:', userToken);
  console.log('');
  
  // テストケース1: dashboard/stats - 管理者アクセス
  console.log('📊 テスト1: dashboard/stats - 管理者アクセス');
  try {
    const response = await axios.get(`${baseUrl}/dashboard/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('✅ 管理者アクセス成功:', response.status);
  } catch (error) {
    console.log('❌ 管理者アクセス失敗:', error.response?.status, error.response?.data);
  }
  
  // テストケース2: dashboard/stats - 一般ユーザーアクセス（拒否されるべき）
  console.log('📊 テスト2: dashboard/stats - 一般ユーザーアクセス');
  try {
    const response = await axios.get(`${baseUrl}/dashboard/stats`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    console.log('❌ 一般ユーザーアクセス成功（脆弱性！）:', response.status);
  } catch (error) {
    console.log('✅ 一般ユーザーアクセス拒否:', error.response?.status, error.response?.data?.message);
  }
  
  // テストケース3: audit-logs - 管理者アクセス
  console.log('📋 テスト3: audit-logs - 管理者アクセス');
  try {
    const response = await axios.get(`${baseUrl}/audit-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('✅ 管理者アクセス成功:', response.status);
  } catch (error) {
    console.log('❌ 管理者アクセス失敗:', error.response?.status, error.response?.data);
  }
  
  // テストケース4: audit-logs - 一般ユーザーアクセス（拒否されるべき）
  console.log('📋 テスト4: audit-logs - 一般ユーザーアクセス');
  try {
    const response = await axios.get(`${baseUrl}/audit-logs`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    console.log('❌ 一般ユーザーアクセス成功（脆弱性！）:', response.status);
  } catch (error) {
    console.log('✅ 一般ユーザーアクセス拒否:', error.response?.status, error.response?.data?.message);
  }
  
  // テストケース5: 無効なトークン
  console.log('🚫 テスト5: 無効なトークン');
  try {
    const response = await axios.get(`${baseUrl}/dashboard/stats`, {
      headers: { Authorization: `Bearer invalid-token` }
    });
    console.log('❌ 無効なトークンでアクセス成功（脆弱性！）:', response.status);
  } catch (error) {
    console.log('✅ 無効なトークンアクセス拒否:', error.response?.status, error.response?.data?.message);
  }
  
  // テストケース6: トークンなし
  console.log('🚫 テスト6: トークンなし');
  try {
    const response = await axios.get(`${baseUrl}/dashboard/stats`);
    console.log('❌ トークンなしでアクセス成功（脆弱性！）:', response.status);
  } catch (error) {
    console.log('✅ トークンなしアクセス拒否:', error.response?.status, error.response?.data?.message);
  }
  
  console.log('');
  console.log('==========================================');
  console.log('🔍 権限チェック完全テスト完了');
}

// 実行
if (require.main === module) {
  runSecurityTests().catch(console.error);
}

module.exports = { runSecurityTests, generateTestToken };