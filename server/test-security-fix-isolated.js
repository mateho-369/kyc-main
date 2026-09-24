// 独立型セキュリティ修正テスト（DB接続なし）
// CVSS 8.8脆弱性（権限昇格）の修正確認

const jwt = require('jsonwebtoken');

// テスト用のJWT_SECRET
const JWT_SECRET = 'test-secret-key-12345';

// モックデータベース
const mockUsers = {
  1: { id: 1, role: 'user', name: 'Test User' },
  2: { id: 2, role: 'admin', name: 'Test Admin' }
};

// 修正前のauth関数（脆弱性あり）
async function vulnerableAuth(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = decoded.user;
    
    // 脆弱性: トークンに含まれるroleを信頼してしまう
    if (decoded.role) {
      user.role = decoded.role;
    }
    
    // DBからの取得は、roleがない場合のみ
    if (!user.role && user.id) {
      const userFromDB = mockUsers[user.id];
      if (userFromDB) {
        user.role = userFromDB.role;
      }
    }
    
    return { success: true, user };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// 修正後のauth関数（セキュア）
async function secureAuth(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = decoded.user;
    
    // セキュリティ修正: 常にDBからroleを取得
    if (user.id) {
      const userFromDB = mockUsers[user.id];
      if (userFromDB) {
        // DBから取得したroleを使用（トークンのroleは無視）
        user.role = userFromDB.role;
        
        // デバッグ情報
        if (decoded.role && decoded.role !== userFromDB.role) {
          console.log('⚠️ 権限昇格の試みを検出！', {
            userId: user.id,
            tokenRole: decoded.role,
            actualRole: userFromDB.role
          });
        }
      } else {
        return { success: false, error: 'ユーザーが見つかりません' };
      }
    } else {
      return { success: false, error: '無効なトークン形式' };
    }
    
    return { success: true, user };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// テスト実行
async function runTests() {
  console.log('🚀 セキュリティ修正テスト（独立版）開始\n');
  
  // テストトークンの生成
  const userToken = jwt.sign({ user: { id: 1 } }, JWT_SECRET);
  const adminToken = jwt.sign({ user: { id: 2 }, role: 'admin' }, JWT_SECRET);
  const maliciousToken = jwt.sign({ user: { id: 1 }, role: 'admin' }, JWT_SECRET); // 権限昇格の試み
  
  console.log('=== 脆弱性のあるコードのテスト ===');
  
  // 脆弱性のあるコードでのテスト
  console.log('\n1. 通常のユーザートークン:');
  let result = await vulnerableAuth(userToken);
  console.log('結果:', result);
  
  console.log('\n2. 管理者トークン:');
  result = await vulnerableAuth(adminToken);
  console.log('結果:', result);
  
  console.log('\n3. 悪意のあるトークン（ユーザーID:1が管理者roleを偽装）:');
  result = await vulnerableAuth(maliciousToken);
  console.log('結果:', result);
  if (result.success && result.user.role === 'admin' && result.user.id === 1) {
    console.log('❌ 脆弱性確認: 一般ユーザーが管理者として認識されました！');
  }
  
  console.log('\n\n=== 修正後のセキュアなコードのテスト ===');
  
  // セキュアなコードでのテスト
  console.log('\n1. 通常のユーザートークン:');
  result = await secureAuth(userToken);
  console.log('結果:', result);
  
  console.log('\n2. 管理者トークン:');
  result = await secureAuth(adminToken);
  console.log('結果:', result);
  
  console.log('\n3. 悪意のあるトークン（ユーザーID:1が管理者roleを偽装）:');
  result = await secureAuth(maliciousToken);
  console.log('結果:', result);
  if (result.success && result.user.role === 'user' && result.user.id === 1) {
    console.log('✅ 脆弱性修正確認: 偽装された管理者roleは無視され、正しいrole(user)が設定されました！');
  }
  
  // 監査ログアクセスのシミュレーション
  console.log('\n\n=== 監査ログアクセスのシミュレーション ===');
  
  const testAuditAccess = async (authFunc, token, testName) => {
    const authResult = await authFunc(token);
    if (!authResult.success) {
      console.log(`${testName}: 認証失敗 - ${authResult.error}`);
      return;
    }
    
    // auditLogs.jsの権限チェックロジックを再現
    const user = authResult.user;
    if (!user || user.role !== 'admin') {
      console.log(`${testName}: アクセス拒否 - 管理者権限が必要です`);
    } else {
      console.log(`${testName}: アクセス許可 - 管理者として認証されました`);
    }
  };
  
  console.log('\n修正前（脆弱）:');
  await testAuditAccess(vulnerableAuth, userToken, 'ユーザートークン');
  await testAuditAccess(vulnerableAuth, adminToken, '管理者トークン');
  await testAuditAccess(vulnerableAuth, maliciousToken, '偽装トークン');
  
  console.log('\n修正後（セキュア）:');
  await testAuditAccess(secureAuth, userToken, 'ユーザートークン');
  await testAuditAccess(secureAuth, adminToken, '管理者トークン');
  await testAuditAccess(secureAuth, maliciousToken, '偽装トークン');
  
  console.log('\n✅ テスト完了\n');
}

// メイン実行
runTests().catch(console.error);