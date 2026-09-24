// E2Eテストのグローバルセットアップ
async function globalSetup() {
  console.log('🚀 E2Eテストのグローバルセットアップを開始...');

  // Firebase Emulator の起動確認
  try {
    const response = await fetch('http://localhost:9099');
    console.log('✅ Firebase Auth Emulator は既に起動しています');
  } catch (error) {
    console.log('⚠️ Firebase Auth Emulator が起動していません');
    console.log('以下のコマンドで起動してください: firebase emulators:start --only auth');
  }

  // Firestore Emulator の起動確認
  try {
    const response = await fetch('http://localhost:8080');
    console.log('✅ Firestore Emulator は既に起動しています');
  } catch (error) {
    console.log('⚠️ Firestore Emulator が起動していません');
  }

  // バックエンドサーバーの起動確認
  try {
    const response = await fetch('http://localhost:3001/api/health');
    if (response.ok) {
      console.log('✅ バックエンドサーバーは正常に動作しています');
    } else {
      console.log('⚠️ バックエンドサーバーが正しく応答しません');
    }
  } catch (error) {
    console.log('⚠️ バックエンドサーバーとの接続に失敗しました');
    console.log('サーバーが起動していることを確認してください');
  }

  // フロントエンドサーバーの起動確認
  try {
    const response = await fetch('http://localhost:3000');
    if (response.ok) {
      console.log('✅ フロントエンドサーバーは正常に動作しています');
    } else {
      console.log('⚠️ フロントエンドサーバーが正しく応答しません');
    }
  } catch (error) {
    console.log('⚠️ フロントエンドサーバーとの接続に失敗しました');
  }

  // テスト用データの準備
  await setupTestData();

  console.log('✅ E2Eテストのグローバルセットアップが完了しました');
}

async function setupTestData() {
  console.log('📋 テストデータの準備を開始...');

  try {
    // Firebase Emulator にテストユーザーを作成
    const testUsers = [
      {
        email: 'existing-user@example.com',
        password: 'password123',
        displayName: 'Existing Test User'
      },
      {
        email: 'admin-user@example.com',
        password: 'adminpassword123',
        displayName: 'Admin Test User'
      }
    ];

    for (const user of testUsers) {
      try {
        // Firebase Auth Emulator API を使用してユーザーを作成
        const response = await fetch('http://localhost:9099/emulator/v1/projects/demo-project/accounts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: user.email,
            password: user.password,
            displayName: user.displayName,
            emailVerified: true
          })
        });

        if (response.ok) {
          console.log(`✅ テストユーザー作成成功: ${user.email}`);
        } else {
          const error = await response.text();
          console.log(`⚠️ テストユーザー作成失敗: ${user.email} - ${error}`);
        }
      } catch (error) {
        console.log(`⚠️ テストユーザー作成エラー: ${user.email} - ${error.message}`);
      }
    }

    // バックエンドAPIでのテストデータ準備
    try {
      const response = await fetch('http://localhost:3001/api/test/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'prepare-test-data'
        })
      });

      if (response.ok) {
        console.log('✅ バックエンドテストデータの準備が完了');
      } else {
        console.log('⚠️ バックエンドテストデータの準備に失敗');
      }
    } catch (error) {
      console.log('⚠️ バックエンドテストデータ準備エラー:', error.message);
    }

  } catch (error) {
    console.log('❌ テストデータ準備中にエラーが発生:', error.message);
  }

  console.log('✅ テストデータの準備が完了しました');
}

// 環境変数の確認
function validateEnvironment() {
  console.log('🔍 環境変数の確認...');

  const requiredEnvVars = [
    'REACT_APP_FIREBASE_API_KEY',
    'REACT_APP_FIREBASE_AUTH_DOMAIN',
    'REACT_APP_FIREBASE_PROJECT_ID'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.log('⚠️ 以下の環境変数が設定されていません:');
    missingVars.forEach(varName => console.log(`  - ${varName}`));
  } else {
    console.log('✅ 必要な環境変数は全て設定されています');
  }

  // テスト環境固有の設定確認
  if (process.env.REACT_APP_USE_FIREBASE_EMULATOR !== 'true') {
    console.log('⚠️ REACT_APP_USE_FIREBASE_EMULATOR=true が設定されていません');
    console.log('Firebase Emulator を使用するために設定することを推奨します');
  }

  console.log('✅ 環境変数の確認が完了しました');
}

module.exports = globalSetup;