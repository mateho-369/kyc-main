import { initializeApp } from 'firebase/app';
import { getAuth, browserSessionPersistence, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
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
    console.error('Firebase configuration is incomplete; refusing to initialize against a fallback project:', missingVars);
    return false;
  }

  // 本番環境でHTTPSチェック（一時的に警告のみ）
  if (process.env.NODE_ENV === 'production' && window.location.protocol !== 'https:') {
    console.warn('⚠️ セキュリティ警告: HTTPSを推奨します（一時的にHTTPを許可）');
    // throw new Error('セキュアな接続（HTTPS）が必要です');
  }
  
  return true;
};

// Use only the explicitly configured shared Firebase project. Never silently fall
// back to a hard-coded project, which can authenticate against the wrong account set.
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID
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