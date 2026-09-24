/**
 * Firebase設定確認スクリプト
 * 使用方法: node firebase-health-check.js
 */

require('dotenv').config({ path: '../.env' });

console.log('=== Firebase Configuration Health Check ===\n');

// 1. 環境変数チェック
console.log('1. 環境変数の設定状況:');
const requiredEnvVars = {
  'DISABLE_FIREBASE': process.env.DISABLE_FIREBASE,
  'FIREBASE_PROJECT_ID': process.env.FIREBASE_PROJECT_ID,
  'FIREBASE_CLIENT_EMAIL': process.env.FIREBASE_CLIENT_EMAIL,
  'FIREBASE_PRIVATE_KEY': process.env.FIREBASE_PRIVATE_KEY
};

Object.entries(requiredEnvVars).forEach(([key, value]) => {
  if (key === 'FIREBASE_PRIVATE_KEY') {
    console.log(`  ${key}: ${value ? '✓ 設定済み (' + value.substring(0, 50) + '...)' : '✗ 未設定'}`);
  } else {
    console.log(`  ${key}: ${value ? '✓ 設定済み' : '✗ 未設定'}`);
  }
});

// 2. Firebase無効化チェック
console.log('\n2. Firebase有効化状態:');
if (process.env.DISABLE_FIREBASE === 'true') {
  console.log('  ⚠️  Firebase は無効化されています');
  console.log('  💡 有効化するには: DISABLE_FIREBASE=false に設定してください');
} else {
  console.log('  ✓ Firebase は有効化されています');
}

// 3. 秘密鍵フォーマットチェック
console.log('\n3. 秘密鍵フォーマット確認:');
if (process.env.FIREBASE_PRIVATE_KEY) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const hasBeginMarker = privateKey.includes('-----BEGIN PRIVATE KEY-----');
  const hasEndMarker = privateKey.includes('-----END PRIVATE KEY-----');
  const hasNewlines = privateKey.includes('\n');
  
  console.log(`  BEGIN marker: ${hasBeginMarker ? '✓' : '✗'}`);
  console.log(`  END marker: ${hasEndMarker ? '✓' : '✗'}`);
  console.log(`  改行文字: ${hasNewlines ? '✓' : '✗'}`);
  
  if (!hasNewlines && privateKey.includes('\\n')) {
    console.log('  ⚠️  改行がエスケープされています。実際の改行に変換が必要です。');
  }
} else {
  console.log('  ✗ 秘密鍵が設定されていません');
}

// 4. Firebase Admin SDK初期化テスト
console.log('\n4. Firebase Admin SDK初期化テスト:');
if (process.env.DISABLE_FIREBASE !== 'true' && 
    process.env.FIREBASE_PROJECT_ID && 
    process.env.FIREBASE_CLIENT_EMAIL && 
    process.env.FIREBASE_PRIVATE_KEY) {
  
  try {
    const admin = require('firebase-admin');
    
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
    }
    
    console.log('  ✓ Firebase Admin SDK 初期化成功');
    console.log(`  Project ID: ${admin.apps[0].options.projectId}`);
    
    // クリーンアップ
    admin.app().delete();
    
  } catch (error) {
    console.log('  ✗ Firebase Admin SDK 初期化失敗');
    console.log(`  エラー: ${error.message}`);
    
    if (error.message.includes('private key')) {
      console.log('\n  💡 秘密鍵の問題解決方法:');
      console.log('  1. service-account-key.json から private_key を正確にコピー');
      console.log('  2. .env ファイルで二重引用符で囲む');
      console.log('  3. 改行は \\n のまま保持（自動変換されます）');
    }
  }
} else {
  console.log('  ⏭️  スキップ（Firebase無効化または必要な設定が不足）');
}

// 5. 推奨事項
console.log('\n5. 推奨事項:');
if (process.env.DISABLE_FIREBASE === 'true') {
  console.log('  • DISABLE_FIREBASE=false に設定してFirebaseを有効化');
}
if (!process.env.FIREBASE_PROJECT_ID) {
  console.log('  • Firebase Console からプロジェクトIDを取得して設定');
}
if (!process.env.FIREBASE_CLIENT_EMAIL) {
  console.log('  • サービスアカウントのメールアドレスを設定');
}
if (!process.env.FIREBASE_PRIVATE_KEY) {
  console.log('  • サービスアカウントの秘密鍵を設定');
}

console.log('\n=== チェック完了 ===');