#!/usr/bin/env node

// Firebase初期化テストスクリプト
require('dotenv').config();

console.log('=== Firebase初期化テスト開始 ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DISABLE_FIREBASE:', process.env.DISABLE_FIREBASE);
console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID);
console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? '設定済み' : '未設定');
console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? '設定済み' : '未設定');

try {
  console.log('\n--- firebase-admin.jsを読み込み中 ---');
  const firebaseAdmin = require('./config/firebase-admin');
  
  console.log('\n初期化結果:');
  console.log('app:', firebaseAdmin.app ? '初期化成功' : '初期化失敗');
  console.log('auth:', firebaseAdmin.auth ? '利用可能' : '利用不可');
  console.log('firestore:', firebaseAdmin.firestore ? '利用可能' : '利用不可');
  
  // 認証ミドルウェアのテスト
  console.log('\n--- 認証ミドルウェアのテスト ---');
  const { authenticateFirebase } = require('./middleware/firebaseAuth');
  console.log('authenticateFirebase:', typeof authenticateFirebase === 'function' ? '関数として利用可能' : 'エラー');
  
  const firebaseSSO = require('./middleware/firebaseSSO');
  console.log('firebaseSSO:', firebaseSSO ? 'モジュール読み込み成功' : 'エラー');
  
  console.log('\n✅ Firebase初期化テスト完了！');
  process.exit(0);
} catch (error) {
  console.error('\n❌ エラーが発生しました:');
  console.error('エラー名:', error.name);
  console.error('エラーメッセージ:', error.message);
  console.error('スタックトレース:', error.stack);
  process.exit(1);
}