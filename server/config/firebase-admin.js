// Firebase Admin SDK設定
const admin = require('firebase-admin');
const winston = require('winston');

// ロガーの設定
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: 'logs/firebase-error.log', 
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: 'logs/firebase-combined.log',
      maxsize: 10485760,
      maxFiles: 10
    })
  ]
});

// 開発環境ではコンソールにも出力
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

let firebaseApp = null;
let auth = null;
let firestore = null;

// Firebase Admin SDK初期化関数
const initializeFirebaseAdmin = () => {
  try {
    // Admin SDK trusts emulator-issued unsigned tokens when this is set; production
    // must never silently use the Auth Emulator.
    if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new Error('FIREBASE_AUTH_EMULATOR_HOST is forbidden in production');
    }

    // Firebase無効化フラグのチェック
    if (process.env.DISABLE_FIREBASE === 'true') {
      logger.info('Firebase Admin SDK disabled by DISABLE_FIREBASE flag');
      return {
        app: null,
        auth: null,
        firestore: null,
        disabled: true
      };
    }

    // 既に初期化済みの場合はスキップ
    if (firebaseApp && admin.apps.length > 0) {
      logger.info('Firebase Admin SDK already initialized');
      return {
        app: firebaseApp,
        auth,
        firestore
      };
    }

    // 環境変数の検証
    const requiredEnvVars = [
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PRIVATE_KEY'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    // サービスアカウント認証情報
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    };

    // Firebase Admin SDK初期化（重複チェック）
    if (admin.apps.length === 0) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
    } else {
      firebaseApp = admin.app();
    }

    // サービスの取得
    auth = admin.auth();
    firestore = admin.firestore();

    // Firestoreの設定
    firestore.settings({
      timestampsInSnapshots: true,
      ignoreUndefinedProperties: true
    });

    logger.info('Firebase Admin SDK initialized successfully', {
      projectId: serviceAccount.projectId
    });

    // 接続テスト
    testFirebaseConnection();

    return {
      app: firebaseApp,
      auth,
      firestore
    };
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin SDK', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

// Firebase接続テスト
const testFirebaseConnection = async () => {
  try {
    // Auth サービスのテスト
    const users = await auth.listUsers(1);
    logger.info('Firebase Auth service is accessible', {
      userCount: users.users.length
    });

    // Firestore サービスのテスト
    const testDoc = await firestore.collection('_test').doc('connection').get();
    logger.info('Firebase Firestore service is accessible');

    return true;
  } catch (error) {
    logger.error('Firebase connection test failed', {
      error: error.message,
      code: error.code
    });
    return false;
  }
};

// カスタムトークンの生成
const createCustomToken = async (uid, claims = {}) => {
  try {
    const token = await auth.createCustomToken(uid, claims);
    logger.info('Custom token created', { uid });
    return token;
  } catch (error) {
    logger.error('Failed to create custom token', {
      uid,
      error: error.message
    });
    throw error;
  }
};

// IDトークンの検証
const verifyIdToken = async (idToken, checkRevoked = true) => {
  try {
    const decodedToken = await auth.verifyIdToken(idToken, checkRevoked);
    logger.info('ID token verified', { uid: decodedToken.uid });
    return decodedToken;
  } catch (error) {
    logger.error('Failed to verify ID token', {
      error: error.message,
      code: error.code
    });
    throw error;
  }
};

// セッションクッキーの作成
const createSessionCookie = async (idToken, expiresIn = 60 * 60 * 24 * 14 * 1000) => {
  try {
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
    logger.info('Session cookie created');
    return sessionCookie;
  } catch (error) {
    logger.error('Failed to create session cookie', {
      error: error.message
    });
    throw error;
  }
};

// セッションクッキーの検証
const verifySessionCookie = async (sessionCookie, checkRevoked = true) => {
  try {
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, checkRevoked);
    logger.info('Session cookie verified', { uid: decodedClaims.uid });
    return decodedClaims;
  } catch (error) {
    logger.error('Failed to verify session cookie', {
      error: error.message,
      code: error.code
    });
    throw error;
  }
};

// ユーザーの作成
const createUser = async (properties) => {
  try {
    const userRecord = await auth.createUser(properties);
    logger.info('Firebase user created', { uid: userRecord.uid });
    return userRecord;
  } catch (error) {
    logger.error('Failed to create Firebase user', {
      email: properties.email,
      error: error.message
    });
    throw error;
  }
};

// ユーザーの更新
const updateUser = async (uid, properties) => {
  try {
    const userRecord = await auth.updateUser(uid, properties);
    logger.info('Firebase user updated', { uid });
    return userRecord;
  } catch (error) {
    logger.error('Failed to update Firebase user', {
      uid,
      error: error.message
    });
    throw error;
  }
};

// ユーザーの削除
const deleteUser = async (uid) => {
  try {
    await auth.deleteUser(uid);
    logger.info('Firebase user deleted', { uid });
    return true;
  } catch (error) {
    logger.error('Failed to delete Firebase user', {
      uid,
      error: error.message
    });
    throw error;
  }
};

// カスタムクレームの設定
const setCustomUserClaims = async (uid, customClaims) => {
  try {
    await auth.setCustomUserClaims(uid, customClaims);
    logger.info('Custom claims set', { uid, claims: customClaims });
    return true;
  } catch (error) {
    logger.error('Failed to set custom claims', {
      uid,
      error: error.message
    });
    throw error;
  }
};

// ユーザーの取得
const getUser = async (uid) => {
  try {
    const userRecord = await auth.getUser(uid);
    return userRecord;
  } catch (error) {
    logger.error('Failed to get Firebase user', {
      uid,
      error: error.message
    });
    throw error;
  }
};

// メールでユーザーを取得
const getUserByEmail = async (email) => {
  try {
    const userRecord = await auth.getUserByEmail(email);
    return userRecord;
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return null;
    }
    logger.error('Failed to get Firebase user by email', {
      email,
      error: error.message
    });
    throw error;
  }
};

// トークンの無効化
const revokeRefreshTokens = async (uid) => {
  try {
    await auth.revokeRefreshTokens(uid);
    logger.info('Refresh tokens revoked', { uid });
    return true;
  } catch (error) {
    logger.error('Failed to revoke refresh tokens', {
      uid,
      error: error.message
    });
    throw error;
  }
};

// 初期化とエクスポート
const firebase = initializeFirebaseAdmin();

module.exports = {
  admin,
  auth: firebase.auth,
  firestore: firebase.firestore,
  app: firebase.app,
  // ユーティリティ関数
  createCustomToken,
  verifyIdToken,
  createSessionCookie,
  verifySessionCookie,
  createUser,
  updateUser,
  deleteUser,
  setCustomUserClaims,
  getUser,
  getUserByEmail,
  revokeRefreshTokens,
  // 再初期化用
  initializeFirebaseAdmin,
  logger
};