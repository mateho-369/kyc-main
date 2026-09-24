// Firebase認証統合APIエンドポイント v2
const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const crypto = require('crypto');
const { 
  verifyIdToken,
  createCustomToken,
  createSessionCookie,
  verifySessionCookie,
  createUser,
  updateUser,
  setCustomUserClaims,
  getUserByEmail,
  revokeRefreshTokens,
  logger
} = require('../config/firebase-admin');
const { User, FirebaseUser } = require('../models');
const { authHybrid, authOptional } = require('../middleware/auth-hybrid');
const { cookieConfig } = require('../middleware/security');
const { csrfProtection, generateCSRFToken, verifyCSRFToken } = require('../middleware/security');

// 入力検証ミドルウェア
const validateFirebaseAuth = [
  check('idToken')
    .notEmpty().withMessage('Firebase IDトークンが必要です')
    .isLength({ min: 100 }).withMessage('有効なIDトークンを提供してください')
];

const validateUserRegistration = [
  check('email')
    .isEmail().normalizeEmail().withMessage('有効なメールアドレスを入力してください'),
  check('password')
    .isLength({ min: 12 }).withMessage('パスワードは12文字以上必要です')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('パスワードは大文字、小文字、数字、特殊文字を含む必要があります'),
  check('displayName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-zA-Z\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+$/)
    .withMessage('表示名に使用できない文字が含まれています')
];

// エラーハンドリング
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  next();
};

// @route   POST /api/auth/firebase/verify
// @desc    Firebase IDトークンを検証し、セッションを作成
// @access  Public
router.post('/verify', csrfProtection, validateFirebaseAuth, handleValidationErrors, async (req, res) => {
  const { idToken } = req.body;

  try {
    // Firebase IDトークンの検証
    const decodedToken = await verifyIdToken(idToken);
    
    // FirebaseユーザーをDBから取得または作成
    let firebaseUser = await FirebaseUser.findOne({
      where: { firebaseUid: decodedToken.uid }
    });

    if (!firebaseUser) {
      // 新規Firebaseユーザーの作成
      firebaseUser = await FirebaseUser.create({
        firebaseUid: decodedToken.uid,
        email: decodedToken.email || '',
        displayName: decodedToken.name || '',
        photoURL: decodedToken.picture || null,
        emailVerified: decodedToken.email_verified || false,
        providerId: decodedToken.firebase?.sign_in_provider || 'unknown',
        customClaims: {},
        firebaseMetadata: {
          lastSignInTime: new Date().toISOString(),
          creationTime: new Date(decodedToken.auth_time * 1000).toISOString()
        }
      });
    }

    // ローカルユーザーとの同期
    let localUser = null;
    if (firebaseUser.userId) {
      localUser = await User.findByPk(firebaseUser.userId);
    } else if (decodedToken.email) {
      // メールアドレスで既存ユーザーを検索
      localUser = await User.findOne({ where: { email: decodedToken.email } });
      
      if (localUser) {
        // 既存ユーザーとFirebaseユーザーを関連付け
        await firebaseUser.update({ userId: localUser.id });
      }
    }

    // ローカルユーザーが存在しない場合は作成
    if (!localUser && decodedToken.email) {
      localUser = await User.create({
        email: decodedToken.email,
        name: decodedToken.name || decodedToken.email.split('@')[0],
        password: crypto.randomBytes(32).toString('hex'), // ランダムパスワード
        role: 'user'
      });

      await firebaseUser.update({ userId: localUser.id });
    }

    // セッションクッキーの作成
    const sessionCookie = await createSessionCookie(idToken);
    
    // CSRFトークンの生成
    const csrfToken = crypto.randomBytes(32).toString('hex');

    // セッション情報をCookieに設定
    res.cookie('__session', sessionCookie, {
      ...cookieConfig,
      maxAge: 14 * 24 * 60 * 60 * 1000 // 14日間
    });

    res.cookie('csrfToken', csrfToken, {
      ...cookieConfig,
      httpOnly: false // JavaScriptから読み取り可能
    });

    // 最終ログイン時刻を更新
    if (localUser) {
      await localUser.update({ lastLoginAt: new Date() });
    }

    logger.info('Firebase authentication successful', {
      uid: decodedToken.uid,
      email: decodedToken.email
    });

    res.json({
      success: true,
      user: localUser ? {
        id: localUser.id,
        email: localUser.email,
        name: localUser.name,
        role: localUser.role
      } : null,
      firebaseUser: {
        uid: firebaseUser.firebaseUid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        emailVerified: firebaseUser.emailVerified
      },
      csrfToken
    });

  } catch (error) {
    logger.error('Firebase authentication failed', {
      error: error.message,
      code: error.code
    });

    const statusCode = error.code === 'auth/id-token-expired' ? 401 : 400;
    res.status(statusCode).json({
      error: 'Authentication failed',
      message: getFirebaseErrorMessage(error.code) || error.message
    });
  }
});

// @route   POST /api/auth/firebase/register
// @desc    新規ユーザー登録（Firebase + ローカル）
// @access  Public
router.post('/register', csrfProtection, validateUserRegistration, handleValidationErrors, async (req, res) => {
  const { email, password, displayName } = req.body;

  try {
    // 既存ユーザーチェック
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        error: 'Registration failed',
        message: 'このメールアドレスは既に登録されています'
      });
    }

    // Firebaseユーザーの作成
    const firebaseUserRecord = await createUser({
      email,
      password,
      displayName: displayName || email.split('@')[0],
      emailVerified: false
    });

    // ローカルユーザーの作成
    const localUser = await User.create({
      email,
      name: displayName || email.split('@')[0],
      password, // bcryptハッシュはモデルのbeforeCreateで実行
      role: 'user'
    });

    // FirebaseUserレコードの作成
    const firebaseUser = await FirebaseUser.create({
      userId: localUser.id,
      firebaseUid: firebaseUserRecord.uid,
      email: firebaseUserRecord.email,
      displayName: firebaseUserRecord.displayName || '',
      emailVerified: false,
      providerId: 'password',
      customClaims: {},
      firebaseMetadata: {
        creationTime: firebaseUserRecord.metadata.creationTime
      }
    });

    // カスタムトークンの生成
    const customToken = await createCustomToken(firebaseUserRecord.uid, {
      role: 'user'
    });

    logger.info('User registration successful', {
      uid: firebaseUserRecord.uid,
      email
    });

    res.status(201).json({
      success: true,
      user: {
        id: localUser.id,
        email: localUser.email,
        name: localUser.name,
        role: localUser.role
      },
      customToken,
      message: 'ユーザー登録が完了しました。メール認証を行ってください。'
    });

  } catch (error) {
    logger.error('User registration failed', {
      email,
      error: error.message,
      code: error.code
    });

    res.status(400).json({
      error: 'Registration failed',
      message: getFirebaseErrorMessage(error.code) || error.message
    });
  }
});

// @route   POST /api/auth/firebase/session
// @desc    セッションクッキーの検証
// @access  Private
router.post('/session', csrfProtection, async (req, res) => {
  const sessionCookie = req.cookies.__session;
  const csrfToken = req.headers['x-csrf-token'];

  if (!sessionCookie) {
    return res.status(401).json({
      error: 'No session',
      message: 'セッションが存在しません'
    });
  }

  // CSRF検証
  if (!csrfToken || csrfToken !== req.cookies.csrfToken) {
    return res.status(403).json({
      error: 'CSRF validation failed',
      message: '無効なCSRFトークンです'
    });
  }

  try {
    // セッションクッキーの検証
    const decodedClaims = await verifySessionCookie(sessionCookie);

    // Firebaseユーザーとローカルユーザーの取得
    const firebaseUser = await FirebaseUser.findOne({
      where: { firebaseUid: decodedClaims.uid },
      include: [{ model: User, as: 'localUser' }]
    });

    if (!firebaseUser || !firebaseUser.localUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'ユーザー情報が見つかりません'
      });
    }

    res.json({
      success: true,
      user: {
        id: firebaseUser.localUser.id,
        email: firebaseUser.localUser.email,
        name: firebaseUser.localUser.name,
        role: firebaseUser.localUser.role
      },
      firebase: {
        uid: firebaseUser.firebaseUid,
        email: firebaseUser.email,
        emailVerified: firebaseUser.emailVerified
      }
    });

  } catch (error) {
    logger.error('Session validation failed', {
      error: error.message,
      code: error.code
    });

    if (error.code === 'auth/session-cookie-expired') {
      return res.status(401).json({
        error: 'Session expired',
        message: 'セッションが期限切れです'
      });
    }

    res.status(401).json({
      error: 'Invalid session',
      message: 'セッションが無効です'
    });
  }
});

// @route   POST /api/auth/firebase/logout
// @desc    ログアウト（セッション無効化）
// @access  Private
router.post('/logout', csrfProtection, authHybrid, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Firebaseユーザーの取得
    const firebaseUser = await FirebaseUser.findOne({
      where: { userId }
    });

    if (firebaseUser) {
      // Firebaseのリフレッシュトークンを無効化
      await revokeRefreshTokens(firebaseUser.firebaseUid);
    }

    // Cookieをクリア
    res.clearCookie('__session');
    res.clearCookie('csrfToken');
    res.clearCookie('refreshToken');

    logger.info('User logged out', {
      userId,
      email: req.user.email
    });

    res.json({
      success: true,
      message: 'ログアウトしました'
    });

  } catch (error) {
    logger.error('Logout failed', {
      userId: req.user?.id,
      error: error.message
    });

    // エラーが発生してもCookieはクリア
    res.clearCookie('__session');
    res.clearCookie('csrfToken');
    res.clearCookie('refreshToken');

    res.json({
      success: true,
      message: 'ログアウトしました'
    });
  }
});

// @route   PUT /api/auth/firebase/update-profile
// @desc    プロフィール更新
// @access  Private
router.put('/update-profile', csrfProtection, authHybrid, [
  check('displayName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 }),
  check('photoURL')
    .optional()
    .isURL()
], handleValidationErrors, async (req, res) => {
  const { displayName, photoURL } = req.body;
  const userId = req.user.id;

  try {
    // FirebaseユーザーとローカルユーザーのIDを取得
    const firebaseUser = await FirebaseUser.findOne({
      where: { userId }
    });

    if (!firebaseUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'ユーザー情報が見つかりません'
      });
    }

    // Firebase側の更新
    const updates = {};
    if (displayName !== undefined) updates.displayName = displayName;
    if (photoURL !== undefined) updates.photoURL = photoURL;

    await updateUser(firebaseUser.firebaseUid, updates);

    // ローカルDBの更新
    await firebaseUser.update(updates);

    if (displayName && req.user) {
      await User.update(
        { name: displayName },
        { where: { id: userId } }
      );
    }

    logger.info('Profile updated', {
      userId,
      updates
    });

    res.json({
      success: true,
      message: 'プロフィールを更新しました',
      profile: {
        displayName: displayName || firebaseUser.displayName,
        photoURL: photoURL || firebaseUser.photoURL
      }
    });

  } catch (error) {
    logger.error('Profile update failed', {
      userId,
      error: error.message
    });

    res.status(500).json({
      error: 'Update failed',
      message: 'プロフィールの更新に失敗しました'
    });
  }
});

// @route   GET /api/auth/firebase/status
// @desc    Firebase接続状態とシステムヘルス情報を取得
// @access  Private
router.get('/status', authHybrid, async (req, res) => {
  try {
    const userId = req.user.id;
    let firebaseConnectionStatus = 'unknown';
    let userAuthStatus = 'unauthenticated';
    let systemHealth = 'healthy';
    let firebaseUser = null;
    let sessionCookie = null;

    // Firebase接続状態をチェック
    try {
      // 現在のユーザーのFirebase情報を取得してFirebase接続を確認
      firebaseUser = await FirebaseUser.findOne({
        where: { userId },
        include: [{ model: User, as: 'localUser' }]
      });

      if (firebaseUser) {
        firebaseConnectionStatus = 'connected';
        userAuthStatus = 'authenticated';

        // セッションクッキーの状態をチェック
        sessionCookie = req.cookies.__session;
        if (sessionCookie) {
          try {
            const decodedClaims = await verifySessionCookie(sessionCookie);
            if (decodedClaims && decodedClaims.uid === firebaseUser.firebaseUid) {
              userAuthStatus = 'session_valid';
            } else {
              userAuthStatus = 'session_mismatch';
              systemHealth = 'warning';
            }
          } catch (sessionError) {
            userAuthStatus = 'session_invalid';
            systemHealth = 'warning';
            logger.warn('Session validation failed in status check', {
              userId,
              error: sessionError.message
            });
          }
        }
      } else {
        firebaseConnectionStatus = 'disconnected';
        systemHealth = 'warning';
      }
    } catch (firebaseError) {
      firebaseConnectionStatus = 'error';
      systemHealth = 'unhealthy';
      logger.error('Firebase connection check failed', {
        userId,
        error: firebaseError.message
      });
    }

    // データベース接続状態をチェック
    let databaseStatus = 'healthy';
    try {
      // 簡単なクエリでデータベース接続を確認
      await User.findByPk(userId);
    } catch (dbError) {
      databaseStatus = 'unhealthy';
      systemHealth = 'unhealthy';
      logger.error('Database connection check failed', {
        userId,
        error: dbError.message
      });
    }

    // CSRF保護状態をチェック
    const csrfStatus = req.cookies.csrfToken ? 'enabled' : 'disabled';
    if (!req.cookies.csrfToken) {
      systemHealth = systemHealth === 'healthy' ? 'warning' : systemHealth;
    }

    const statusResponse = {
      success: true,
      timestamp: new Date().toISOString(),
      firebase: {
        connectionStatus: firebaseConnectionStatus,
        userAuthStatus,
        hasSessionCookie: !!sessionCookie,
        uid: firebaseUser?.firebaseUid || null,
        email: firebaseUser?.email || null,
        emailVerified: firebaseUser?.emailVerified || false,
        providerId: firebaseUser?.providerId || null,
        lastSignInTime: firebaseUser?.firebaseMetadata?.lastSignInTime || null
      },
      system: {
        health: systemHealth,
        database: databaseStatus,
        csrf: csrfStatus,
        environment: process.env.NODE_ENV || 'development'
      },
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        lastLoginAt: req.user.lastLoginAt
      },
      features: {
        registration: true,
        sessionManagement: true,
        profileUpdate: true,
        customClaims: req.user.role === 'admin'
      }
    };

    logger.info('Firebase status check completed', {
      userId,
      systemHealth,
      firebaseConnectionStatus,
      userAuthStatus
    });

    res.json(statusResponse);

  } catch (error) {
    logger.error('Firebase status check failed', {
      userId: req.user?.id,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Status check failed',
      message: 'システム状態の確認に失敗しました',
      timestamp: new Date().toISOString(),
      firebase: {
        connectionStatus: 'error',
        userAuthStatus: 'unknown'
      },
      system: {
        health: 'unhealthy',
        database: 'unknown',
        csrf: 'unknown',
        environment: process.env.NODE_ENV || 'development'
      }
    });
  }
});

// @route   POST /api/auth/firebase/set-custom-claims
// @desc    カスタムクレームの設定（管理者のみ）
// @access  Admin
router.post('/set-custom-claims', csrfProtection, authHybrid, async (req, res) => {
  // 管理者権限チェック
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden',
      message: '管理者権限が必要です'
    });
  }

  const { targetUserId, customClaims } = req.body;

  try {
    // 対象ユーザーのFirebase UIDを取得
    const targetFirebaseUser = await FirebaseUser.findOne({
      where: { userId: targetUserId }
    });

    if (!targetFirebaseUser) {
      return res.status(404).json({
        error: 'User not found',
        message: '対象ユーザーが見つかりません'
      });
    }

    // カスタムクレームの設定
    await setCustomUserClaims(targetFirebaseUser.firebaseUid, customClaims);

    // ローカルDBにも保存
    await targetFirebaseUser.update({ customClaims });

    logger.info('Custom claims set', {
      adminId: req.user.id,
      targetUserId,
      customClaims
    });

    res.json({
      success: true,
      message: 'カスタムクレームを設定しました'
    });

  } catch (error) {
    logger.error('Failed to set custom claims', {
      adminId: req.user.id,
      targetUserId,
      error: error.message
    });

    res.status(500).json({
      error: 'Operation failed',
      message: 'カスタムクレームの設定に失敗しました'
    });
  }
});

// エラーメッセージのマッピング
function getFirebaseErrorMessage(errorCode) {
  const errorMessages = {
    'auth/email-already-exists': 'このメールアドレスは既に使用されています',
    'auth/invalid-email': '無効なメールアドレスです',
    'auth/operation-not-allowed': 'この操作は許可されていません',
    'auth/weak-password': 'パスワードが弱すぎます',
    'auth/user-not-found': 'ユーザーが見つかりません',
    'auth/wrong-password': 'パスワードが正しくありません',
    'auth/invalid-id-token': '無効な認証トークンです',
    'auth/id-token-expired': '認証トークンが期限切れです',
    'auth/id-token-revoked': '認証トークンが無効化されています',
    'auth/session-cookie-expired': 'セッションが期限切れです',
    'auth/session-cookie-revoked': 'セッションが無効化されています',
    'auth/too-many-requests': 'リクエストが多すぎます。しばらくしてから再試行してください'
  };

  return errorMessages[errorCode] || '認証エラーが発生しました';
}

module.exports = router;