/**
 * Firebase認証ミドルウェア
 * Firebase AuthenticationによるSSO（シングルサインオン）を処理
 */

const admin = require('firebase-admin');
const { FirebaseUser, User } = require('../models');
const { validateToken } = require('../utils/tokenValidator');

// Firebase Admin SDKの初期化 - DISABLE_FIREBASEチェックを追加
if (!admin.apps.length && process.env.DISABLE_FIREBASE !== 'true') {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

/**
 * FirebaseトークンからユーザーIDを取得または作成
 * @param {Object} decodedToken - デコードされたFirebaseトークン
 * @returns {Object} ユーザー情報
 */
const getOrCreateUserFromFirebase = async (decodedToken) => {
  const { uid, email, name, picture, email_verified } = decodedToken;

  // Firebase UIDでユーザーを検索
  let firebaseUser = await FirebaseUser.findOne({
    where: { firebaseUid: uid },
    include: [{ model: User }]
  });

  if (firebaseUser && firebaseUser.User) {
    // 既存ユーザーの情報を更新
    await firebaseUser.update({
      email,
      displayName: name,
      photoURL: picture,
      emailVerified: email_verified,
      lastLoginAt: new Date()
    });

    return firebaseUser.User;
  }

  // 新規ユーザーの作成
  const transaction = await FirebaseUser.sequelize.transaction();
  
  try {
    // メールアドレスで既存ユーザーを検索
    let user = await User.findOne({ 
      where: { email },
      transaction 
    });

    if (!user) {
      // 完全に新規のユーザーを作成
      user = await User.create({
        email,
        name: name || email.split('@')[0],
        role: 'user',
        isActive: true,
        password: 'firebase-sso-user' // Firebase認証のため実際のパスワードは不要
      }, { transaction });
    }

    // FirebaseUserレコードを作成
    firebaseUser = await FirebaseUser.create({
      firebaseUid: uid,
      userId: user.id,
      email,
      displayName: name,
      photoURL: picture,
      emailVerified: email_verified,
      provider: decodedToken.firebase.sign_in_provider || 'password',
      lastLoginAt: new Date()
    }, { transaction });

    await transaction.commit();
    return user;

  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

/**
 * Firebase認証ミドルウェア
 * @param {boolean} options.required - 認証が必須かどうか
 * @returns {Function} Expressミドルウェア
 */
const authenticateFirebase = (options = { required: true }) => {
  return async (req, res, next) => {
    // Firebaseが無効化されている場合はスキップ（開発環境のみ）
    // 本番で DISABLE_FIREBASE=true になると、全リクエストが認証を通過して
    // test-uid として扱われる。環境変数1つで認証が消える状態を避けるため、
    // NODE_ENV=production では絶対にこの分岐に入らないようにする。
    if (process.env.DISABLE_FIREBASE === 'true') {
      if (process.env.NODE_ENV === 'production') {
        console.error('DISABLE_FIREBASE=true is not allowed in production - rejecting request');
        return res.status(500).json({
          success: false,
          error: { code: 'AUTH_MISCONFIGURED', message: '認証設定に問題があります' }
        });
      }
      // ダミーのユーザー情報を設定（開発用）
      req.user = {
        uid: 'test-uid',
        email: 'test@example.com',
        name: 'Test User'
      };
      return next();
    }
    
    try {
      let idToken = null;
      
      // 標準的な方法: Authorizationヘッダーからトークンを取得
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        idToken = authHeader.split('Bearer ')[1];
      }
      
      // 後方互換性: URLパラメータからトークンを取得（非推奨）
      if (!idToken && req.query.id_token) {
        console.warn('⚠️ URLパラメータでのトークン送信は非推奨です。Authorizationヘッダーを使用してください。');
        idToken = req.query.id_token;
      }
      
      if (!idToken) {
        if (options.required) {
          return res.status(401).json({
            success: false,
            error: 'No authorization token provided',
            code: 'NO_TOKEN'
          });
        }
        return next();
      }

      // トークンを検証（失効チェック付き）
      const decodedToken = await admin.auth().verifyIdToken(idToken, true);

      // カスタムクレームをチェック（オプション）
      if (decodedToken.customClaims && decodedToken.customClaims.blocked) {
        return res.status(403).json({
          success: false,
          error: 'User account is blocked'
        });
      }

      // ユーザー情報を取得または作成
      const user = await getOrCreateUserFromFirebase(decodedToken);

      // リクエストオブジェクトにユーザー情報を追加
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        firebaseUid: decodedToken.uid,
        isFirebaseAuth: true
      };

      req.firebaseToken = decodedToken;

      next();
    } catch (error) {
      console.error('Firebase authentication error:', error);

      if (error.code === 'auth/id-token-expired') {
        return res.status(401).json({
          success: false,
          error: 'Token has expired',
          code: 'TOKEN_EXPIRED'
        });
      }

      if (error.code === 'auth/id-token-revoked') {
        return res.status(401).json({
          success: false,
          error: 'Token has been revoked',
          code: 'TOKEN_REVOKED'
        });
      }

      if (error.code === 'auth/argument-error') {
        return res.status(400).json({
          success: false,
          error: 'Invalid token format',
          code: 'INVALID_TOKEN'
        });
      }

      res.status(401).json({
        success: false,
        error: 'Authentication failed',
        code: 'AUTH_FAILED'
      });
    }
  };
};

/**
 * Firebase認証とローカル認証の両方をサポートするハイブリッドミドルウェア
 */
const authenticateHybrid = () => {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: 'No authorization token provided'
      });
    }

    // Firebaseトークンかローカルトークンかを判定
    if (authHeader.includes('.') && authHeader.split('.').length === 3) {
      // JWTフォーマットの場合、Firebaseトークンの可能性が高い
      try {
        await authenticateFirebase({ required: true })(req, res, next);
      } catch (firebaseError) {
        // Firebaseで失敗した場合、ローカル認証を試みる
        const localAuth = require('./auth').authenticateToken;
        localAuth(req, res, next);
      }
    } else {
      // ローカルトークンとして処理
      const localAuth = require('./auth').authenticateToken;
      localAuth(req, res, next);
    }
  };
};

/**
 * Firebaseユーザーの権限を確認
 * @param {Array} requiredRoles - 必要な権限
 * @returns {Function} Expressミドルウェア
 */
const checkFirebaseRole = (requiredRoles = []) => {
  return async (req, res, next) => {
    try {
      if (!req.firebaseToken) {
        return res.status(403).json({
          success: false,
          error: 'Firebase authentication required'
        });
      }

      const { customClaims } = req.firebaseToken;
      const userRole = customClaims?.role || req.user.role || 'user';

      if (!requiredRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          required: requiredRoles,
          current: userRole
        });
      }

      next();
    } catch (error) {
      console.error('Error checking Firebase role:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify permissions'
      });
    }
  };
};

/**
 * Firebaseカスタムクレームを設定
 * @param {string} uid - Firebase UID
 * @param {Object} claims - カスタムクレーム
 */
const setCustomClaims = async (uid, claims) => {
  try {
    await admin.auth().setCustomUserClaims(uid, claims);
    console.log(`Custom claims set for user ${uid}:`, claims);
  } catch (error) {
    console.error('Error setting custom claims:', error);
    throw error;
  }
};

/**
 * Firebaseユーザーを無効化
 * @param {string} uid - Firebase UID
 */
const disableFirebaseUser = async (uid) => {
  try {
    await admin.auth().updateUser(uid, {
      disabled: true
    });
    
    // ローカルDBも更新
    await FirebaseUser.update(
      { isActive: false },
      { where: { firebaseUid: uid } }
    );
    
    console.log(`Firebase user ${uid} has been disabled`);
  } catch (error) {
    console.error('Error disabling Firebase user:', error);
    throw error;
  }
};

/**
 * Firebaseユーザーを削除
 * @param {string} uid - Firebase UID
 */
const deleteFirebaseUser = async (uid) => {
  try {
    await admin.auth().deleteUser(uid);
    
    // ローカルDBからも削除
    await FirebaseUser.destroy({
      where: { firebaseUid: uid }
    });
    
    console.log(`Firebase user ${uid} has been deleted`);
  } catch (error) {
    console.error('Error deleting Firebase user:', error);
    throw error;
  }
};

/**
 * Firebaseセッションを取り消し
 * @param {string} uid - Firebase UID
 */
const revokeFirebaseTokens = async (uid) => {
  try {
    await admin.auth().revokeRefreshTokens(uid);
    
    const user = await admin.auth().getUser(uid);
    console.log(`Tokens revoked for user ${uid}. New tokens valid after: ${user.tokensValidAfterTime}`);
    
    return user.tokensValidAfterTime;
  } catch (error) {
    console.error('Error revoking Firebase tokens:', error);
    throw error;
  }
};

module.exports = {
  authenticateFirebase,
  authenticateHybrid,
  checkFirebaseRole,
  setCustomClaims,
  disableFirebaseUser,
  deleteFirebaseUser,
  revokeFirebaseTokens,
  getOrCreateUserFromFirebase
};