const axios = require('axios');
const chalk = require('chalk');

// テスト設定
const TEST_CONFIG = {
  baseURL: process.env.API_URL || 'https://stg.id-manager.com',
  testToken: 'sharegram-api-key-test-2025', // テスト用APIキー
  endpoints: {
    login: '/api/auth/sharegram-sso',
    logout: '/api/auth/sharegram-sso/logout',
    session: '/api/auth/sharegram-sso/session',
    refresh: '/api/auth/sharegram-sso/refresh'
  }
};

// テスト結果を格納
const testResults = {
  passed: [],
  failed: [],
  startTime: new Date()
};

// ヘルパー関数
function logTest(testName, success, details = '') {
  if (success) {
    console.log(chalk.green(`✅ ${testName}`));
    if (details) console.log(chalk.gray(`   ${details}`));
    testResults.passed.push({ test: testName, details });
  } else {
    console.log(chalk.red(`❌ ${testName}`));
    if (details) console.log(chalk.red(`   ${details}`));
    testResults.failed.push({ test: testName, details });
  }
}

// エンドポイントテスト関数
async function testEndpoint(method, path, data = null, headers = {}) {
  const url = `${TEST_CONFIG.baseURL}${path}`;
  try {
    const config = {
      method,
      url,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      validateStatus: () => true // すべてのステータスコードを受け入れる
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return {
      success: true,
      status: response.status,
      data: response.data,
      headers: response.headers
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.response?.data || error.config
    };
  }
}

// メインテスト関数
async function runTests() {
  console.log(chalk.blue('\n🚀 Sharegram SSO エンドポイントテスト開始\n'));
  console.log(chalk.gray(`API URL: ${TEST_CONFIG.baseURL}`));
  console.log(chalk.gray(`開始時刻: ${testResults.startTime.toISOString()}\n`));

  // 1. ログインエンドポイントテスト
  console.log(chalk.yellow('\n1. ログインエンドポイントテスト'));
  
  // 1.1 正常なログインリクエスト
  let loginResponse = await testEndpoint('POST', TEST_CONFIG.endpoints.login, {
    userAccessToken: TEST_CONFIG.testToken
  });
  
  logTest(
    'POST /api/auth/sharegram-sso - 正常リクエスト',
    loginResponse.status === 200 || loginResponse.status === 201,
    `ステータス: ${loginResponse.status}, レスポンス: ${JSON.stringify(loginResponse.data)}`
  );
  
  // カスタムトークンを保存（後続のテストで使用）
  let customToken = null;
  if (loginResponse.data?.customToken) {
    customToken = loginResponse.data.customToken;
  }

  // 1.2 不正なトークンでのリクエスト
  const invalidLoginResponse = await testEndpoint('POST', TEST_CONFIG.endpoints.login, {
    userAccessToken: 'invalid-token'
  });
  
  logTest(
    'POST /api/auth/sharegram-sso - 不正なトークン',
    invalidLoginResponse.status === 400 || invalidLoginResponse.status === 401,
    `ステータス: ${invalidLoginResponse.status}`
  );

  // 1.3 トークンなしでのリクエスト
  const noTokenResponse = await testEndpoint('POST', TEST_CONFIG.endpoints.login, {});
  
  logTest(
    'POST /api/auth/sharegram-sso - トークンなし',
    noTokenResponse.status === 400,
    `ステータス: ${noTokenResponse.status}`
  );

  // 2. セッション確認エンドポイントテスト
  console.log(chalk.yellow('\n2. セッション確認エンドポイントテスト'));
  
  if (customToken) {
    const sessionResponse = await testEndpoint('GET', TEST_CONFIG.endpoints.session, null, {
      'Authorization': `Bearer ${customToken}`
    });
    
    logTest(
      'GET /api/auth/sharegram-sso/session - 認証あり',
      sessionResponse.status === 200,
      `ステータス: ${sessionResponse.status}`
    );
  }

  // 2.2 認証なしでのアクセス
  const noAuthSessionResponse = await testEndpoint('GET', TEST_CONFIG.endpoints.session);
  
  logTest(
    'GET /api/auth/sharegram-sso/session - 認証なし',
    noAuthSessionResponse.status === 401 || noAuthSessionResponse.status === 403,
    `ステータス: ${noAuthSessionResponse.status}`
  );

  // 3. トークンリフレッシュエンドポイントテスト
  console.log(chalk.yellow('\n3. トークンリフレッシュエンドポイントテスト'));
  
  if (customToken) {
    const refreshResponse = await testEndpoint('POST', TEST_CONFIG.endpoints.refresh, {}, {
      'Authorization': `Bearer ${customToken}`
    });
    
    logTest(
      'POST /api/auth/sharegram-sso/refresh - 認証あり',
      refreshResponse.status === 200,
      `ステータス: ${refreshResponse.status}`
    );
    
    // 新しいトークンを保存
    if (refreshResponse.data?.sessionToken) {
      customToken = refreshResponse.data.sessionToken;
    }
  }

  // 4. ログアウトエンドポイントテスト
  console.log(chalk.yellow('\n4. ログアウトエンドポイントテスト'));
  
  if (customToken) {
    const logoutResponse = await testEndpoint('POST', TEST_CONFIG.endpoints.logout, {}, {
      'Authorization': `Bearer ${customToken}`
    });
    
    logTest(
      'POST /api/auth/sharegram-sso/logout - 認証あり',
      logoutResponse.status === 200,
      `ステータス: ${logoutResponse.status}`
    );
  }

  // 4.2 認証なしでのログアウト
  const noAuthLogoutResponse = await testEndpoint('POST', TEST_CONFIG.endpoints.logout);
  
  logTest(
    'POST /api/auth/sharegram-sso/logout - 認証なし',
    noAuthLogoutResponse.status === 401 || noAuthLogoutResponse.status === 403,
    `ステータス: ${noAuthLogoutResponse.status}`
  );

  // 5. ルーティング確認テスト
  console.log(chalk.yellow('\n5. ルーティング確認テスト'));
  
  // OPTIONSリクエスト（CORS確認）
  const corsResponse = await testEndpoint('OPTIONS', TEST_CONFIG.endpoints.login);
  
  logTest(
    'OPTIONS /api/auth/sharegram-sso - CORS確認',
    corsResponse.status === 204 || corsResponse.status === 200,
    `ステータス: ${corsResponse.status}`
  );

  // テスト結果サマリー
  console.log(chalk.blue('\n📊 テスト結果サマリー\n'));
  console.log(chalk.green(`✅ 成功: ${testResults.passed.length}`));
  console.log(chalk.red(`❌ 失敗: ${testResults.failed.length}`));
  console.log(chalk.gray(`実行時間: ${new Date() - testResults.startTime}ms\n`));

  // 失敗したテストの詳細
  if (testResults.failed.length > 0) {
    console.log(chalk.red('\n失敗したテスト:'));
    testResults.failed.forEach(test => {
      console.log(chalk.red(`- ${test.test}`));
      if (test.details) {
        console.log(chalk.gray(`  ${test.details}`));
      }
    });
  }

  // 終了
  process.exit(testResults.failed.length > 0 ? 1 : 0);
}

// テスト実行
runTests().catch(error => {
  console.error(chalk.red('\n❌ テスト実行エラー:'), error);
  process.exit(1);
});