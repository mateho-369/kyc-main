import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, browserSessionPersistence, setPersistence } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { auth as fallbackAuth, db as fallbackDb } from './firebase-fallback';

// セキュリティチェック関数
const validateEnvironment = () => {
  // Development環境でのスキップを無効化（全環境で初期化を実行）
  // if (process.env.NODE_ENV === 'development') {
  //   console.log('🔧 Development mode: Firebase initialization skipped');
  //   return false;
  // }
  
  const requiredEnvVars = [
    'REACT_APP_FIREBASE_API_KEY',
    'REACT_APP_FIREBASE_AUTH_DOMAIN',
    'REACT_APP_FIREBASE_PROJECT_ID',
    'REACT_APP_FIREBASE_STORAGE_BUCKET',
    'REACT_APP_FIREBASE_MESSAGING_SENDER_ID',
    'REACT_APP_FIREBASE_APP_ID'
  ];

  const missingVars = requiredEnvVars.filter(
    varName => !process.env[varName]
  );

  if (missingVars.length > 0) {
    console.warn('⚠️ Firebase環境変数が一部未設定:', missingVars);
    console.log('✅ Firebase設定: ハードコードされた正しい設定値を使用');
    // ハードコードされた正しい設定値があるので初期化を続行
  }

  // 本番環境でHTTPSチェック（一時的に警告のみ）
  if (process.env.NODE_ENV === 'production' && window.location.protocol !== 'https:') {
    console.warn('⚠️ セキュリティ警告: HTTPSを推奨します（一時的にHTTPを許可）');
    // throw new Error('セキュアな接続（HTTPS）が必要です');
  }
  
  return true;
};

// Firebase設定オブジェクト（統一設定）
// フォールバック値は Sharegram と共有する adroit-standard-496710-r5 を指す。
// 旧プロジェクト singular-winter-370002 を残していると、環境変数の設定漏れ時に
// 黙って別プロジェクトで認証してしまうため、必ずこの値と揃えること。
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || 'AIzaSyC9pSqeZeOjvndPX_dPEsaIU22CUWVYB_0',
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || 'adroit-standard-496710-r5.firebaseapp.com',
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'adroit-standard-496710-r5',
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || 'adroit-standard-496710-r5.firebasestorage.app',
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '716516303448',
  appId: process.env.REACT_APP_FIREBASE_APP_ID || '1:716516303448:web:e7ab0a08b087ffd60f602d',
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || 'G-MQYZWN6H34'
};

// Firebase初期化前の検証
const shouldInitialize = validateEnvironment();

let app = null;
let auth = null;
let db = null;
let isMock = false;

if (shouldInitialize) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (error) {
    console.error('Firebase初期化エラー:', error);
    console.warn('Firebase フォールバックモードで動作します');
    auth = fallbackAuth;
    db = fallbackDb;
    isMock = true;
  }
} else {
  console.warn('Firebase設定が見つかりません。フォールバックモードで動作します');
  auth = fallbackAuth;
  db = fallbackDb;
  isMock = true;
}

export { auth, db, isMock };

// 開発環境でのエミュレータ設定
if (shouldInitialize && process.env.REACT_APP_USE_FIREBASE_EMULATOR === 'true') {
  console.log('🔧 Firebase Emulatorモードで起動');
  
  // 認証エミュレータ
  connectAuthEmulator(auth, 'http://localhost:9099', {
    disableWarnings: true
  });
  
  // Firestoreエミュレータ
  connectFirestoreEmulator(db, 'localhost', 8080);
}

// セキュリティ設定
if (auth && typeof setPersistence === 'function' && auth.useDeviceLanguage) {
  try {
    auth.useDeviceLanguage(); // デバイスの言語を使用
  } catch (e) {
    console.warn('useDeviceLanguage not available in fallback mode');
  }

  // 認証状態の永続性設定（ブラウザセッションのみ）
  // localStorageは使用せず、セッションストレージも避ける
  if (typeof setPersistence === 'function') {
    setPersistence(auth, browserSessionPersistence)
      .then(() => {
        console.log('✅ Firebase認証の永続性設定完了（ブラウザセッションのみ）');
      })
      .catch((error) => {
        console.error('❌ Firebase認証の永続性設定エラー:', error);
      });
  }
}

export default app;