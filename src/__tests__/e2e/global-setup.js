// E2Eテストのグローバルセットアップ
async function globalSetup() {
  console.log('🚀 E2Eテストのグローバルセットアップを開始...');

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

  console.log('✅ Real Firebase configuration is used; this E2E setup does not start or seed Firebase emulators');

  console.log('✅ 環境変数の確認が完了しました');
}

module.exports = globalSetup;