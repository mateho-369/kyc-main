// セキュリティ修正のテストスクリプト
// CVSS 8.8脆弱性（権限昇格）の修正確認

const express = require('express');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// テスト用のJWT_SECRETが設定されていない場合のデフォルト値
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345';

// 修正されたauth.jsミドルウェアを読み込み
const auth = require('./middleware/auth');

// モックデータベース（テスト用）
const mockUsers = {
  1: { id: 1, role: 'user', name: 'Test User' },
  2: { id: 2, role: 'admin', name: 'Test Admin' }
};

// Userモデルのモック（修正版のauth.jsをテストするため）
const User = {
  findByPk: async (id) => {
    console.log(`🔍 Mock DB Query: Finding user with ID ${id}`);
    // データベースから正しいroleを返す
    const user = mockUsers[id];
    if (user) {
      return {
        id: user.id,
        role: user.role // DBから正しいroleを返す
      };
    }
    return null;
  }
};

// modelsモジュールのモック
require.cache[require.resolve('./models')] = {
  exports: { User }
};

// テスト用Expressアプリ
const app = express();
app.use(express.json());

// テストエンドポイント
app.get('/test/auth', auth, (req, res) => {
  res.json({
    message: 'Auth successful',
    user: req.user
  });
});

// 監査ログのテストエンドポイント（管理者のみ）
app.get('/test/audit-logs', auth, (req, res) => {
  // auditLogs.jsの権限チェックロジックを再現
  if (!req.user || req.user.role !== 'admin') {
    console.log('🚨 SECURITY BLOCK: Non-admin access attempt', {
      userId: req.user?.id,
      userRole: req.user?.role,
      path: req.path
    });
    return res.status(403).json({ 
      message: '権限がありません。管理者のみアクセス可能です。',
      code: 'ADMIN_ONLY'
    });
  }
  
  res.json({
    message: 'Admin access granted',
    logs: ['sample log 1', 'sample log 2']
  });
});

// テストケース実行
async function runTests() {
  console.log('🚀 セキュリティ修正テスト開始\n');
  
  // テストケース1: 正常なユーザートークン（roleなし）
  console.log('📋 テストケース1: 正常なユーザートークン（roleなし）');
  const userTokenNoRole = jwt.sign(
    { user: { id: 1 } },
    process.env.JWT_SECRET
  );
  await testRequest('/test/auth', userTokenNoRole, 'Case 1');
  
  // テストケース2: 正常な管理者トークン（roleあり）
  console.log('\n📋 テストケース2: 正常な管理者トークン（roleあり）');
  const adminTokenWithRole = jwt.sign(
    { user: { id: 2 }, role: 'admin' },
    process.env.JWT_SECRET
  );
  await testRequest('/test/auth', adminTokenWithRole, 'Case 2');
  
  // テストケース3: 悪意のあるトークン（一般ユーザーが管理者roleを偽装）
  console.log('\n📋 テストケース3: 悪意のあるトークン（一般ユーザーが管理者roleを偽装）');
  const maliciousToken = jwt.sign(
    { user: { id: 1 }, role: 'admin' }, // ユーザーID 1は本来一般ユーザー
    process.env.JWT_SECRET
  );
  await testRequest('/test/auth', maliciousToken, 'Case 3');
  
  // テストケース4: 監査ログへのアクセステスト（一般ユーザー）
  console.log('\n📋 テストケース4: 監査ログへのアクセステスト（一般ユーザー）');
  await testRequest('/test/audit-logs', userTokenNoRole, 'Case 4');
  
  // テストケース5: 監査ログへのアクセステスト（管理者）
  console.log('\n📋 テストケース5: 監査ログへのアクセステスト（管理者）');
  await testRequest('/test/audit-logs', adminTokenWithRole, 'Case 5');
  
  // テストケース6: 監査ログへのアクセステスト（偽装トークン）
  console.log('\n📋 テストケース6: 監査ログへのアクセステスト（偽装トークン）');
  await testRequest('/test/audit-logs', maliciousToken, 'Case 6');
  
  console.log('\n✅ テスト完了\n');
  process.exit(0);
}

// HTTPリクエストをシミュレート
async function testRequest(path, token, testName) {
  const req = {
    path,
    header: (name) => {
      if (name === 'Authorization') {
        return `Bearer ${token}`;
      }
      return null;
    },
    user: null
  };
  
  const res = {
    statusCode: 200,
    jsonData: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.jsonData = data;
      console.log(`📊 ${testName} - Response:`, {
        status: this.statusCode,
        data
      });
      return this;
    },
    send: function(data) {
      console.log(`📊 ${testName} - Response:`, {
        status: this.statusCode,
        data
      });
      return this;
    }
  };
  
  // ミドルウェアを実行
  await new Promise((resolve) => {
    const middleware = app._router.stack.find(layer => 
      layer.route && layer.route.path === path
    );
    
    if (middleware) {
      const handlers = middleware.route.stack.map(layer => layer.handle);
      
      // auth ミドルウェアを実行
      auth(req, res, () => {
        // ルートハンドラを実行
        handlers[handlers.length - 1](req, res);
        resolve();
      });
    } else {
      resolve();
    }
  });
  
  // 結果を分析
  if (testName === 'Case 3' || testName === 'Case 6') {
    if (req.user && req.user.role === 'user') {
      console.log('✅ 脆弱性修正確認: 偽装された管理者roleは無視され、DBから正しいroleが取得されました');
    } else if (req.user && req.user.role === 'admin' && req.user.id === 1) {
      console.log('❌ 脆弱性が残存: 一般ユーザーが管理者として認識されています！');
    }
  }
}

// サーバー起動
const PORT = process.env.TEST_PORT || 5001;
const server = app.listen(PORT, () => {
  console.log(`🔧 テストサーバー起動 on port ${PORT}`);
  runTests();
});

// エラーハンドリング
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  server.close();
  process.exit(1);
});