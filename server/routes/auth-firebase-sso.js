const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

// Firebase SSO専用のCORS設定
const { firebaseSSO_CORS } = require('../middleware/security');

// Firebase Admin SDK
const { 
  auth, 
  createCustomToken, 
  verifyIdToken, 
  getUserByEmail, 
  logger 
} = require('../config/firebase-admin');

// Models
const { User } = require('../models');

// Utils
const { auditLogger } = require('../utils/logger/auditLogger');
const asyncHandler = require('../utils/asyncHandler');

// Error classes
let AppError, AuthenticationError, ValidationError;
try {
  const errors = require('../utils/errors/AppError');
  AppError = errors.AppError;
  AuthenticationError = errors.AuthenticationError;
  ValidationError = errors.ValidationError;
} catch (err) {
  console.error('AppError import failed:', err.message);
  AppError = class extends Error { constructor(message, statusCode = 500) { super(message); this.statusCode = statusCode; } };
  AuthenticationError = class extends AppError { constructor(message) { super(message, 401); } };
  ValidationError = class extends AppError { constructor(message) { super(message, 400); } };
}

// Rate limiting for Firebase SSO
const firebaseSSOLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many Firebase SSO attempts, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Firebase to Firebase SSO認証エンドポイント
 * POST /api/auth/firebase-sso
 * 
 * Firebase公式ドキュメント準拠:
 * 1. Sharegramで firebase.auth().currentUser.getIdToken(true) で ID Token取得
 * 2. KYCサイトで verifyIdToken(idToken, true) で検証
 * 3. createCustomToken(uid, customClaims) でCustom Token生成
 * 4. クライアントで signInWithCustomToken(customToken) 実行
 */
router.post('/firebase-sso', firebaseSSO_CORS(), firebaseSSOLimit, asyncHandler(async (req, res, next) => {
  try {
    const { idToken, action, performerId, returnUrl } = req.body;

    // パラメータ検証
    if (!idToken || typeof idToken !== 'string') {
      throw new ValidationError('Firebase ID Token is required and must be a string');
    }

    // ID Token の基本フォーマット確認（JWT形式）
    const tokenParts = idToken.split('.');
    if (tokenParts.length !== 3) {
      throw new ValidationError('Invalid Firebase ID Token format');
    }

    logger.info('Firebase SSO login attempt', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      action: action,
      performerId: performerId,
      returnUrl: returnUrl
    });

    // Firebase ID Tokenを検証（失効チェック有効）
    let decodedToken;
    try {
      decodedToken = await verifyIdToken(idToken, true); // checkRevoked=true
      logger.info('Firebase ID Token verification successful', {
        uid: decodedToken.uid,
        email: decodedToken.email
      });
    } catch (error) {
      logger.error('Firebase ID Token verification failed', {
        error: error.message,
        code: error.code,
        ip: req.ip
      });
      
      if (error.code === 'auth/id-token-expired') {
        throw new AuthenticationError('Firebase ID Token has expired');
      }
      
      if (error.code === 'auth/id-token-revoked') {
        throw new AuthenticationError('Firebase ID Token has been revoked');
      }
      
      if (error.code === 'auth/invalid-id-token') {
        throw new AuthenticationError('Invalid Firebase ID Token');
      }
      
      throw new AuthenticationError('Firebase ID Token verification failed');
    }

    // Firebase プロジェクトIDの検証（aud claim）
    if (decodedToken.aud !== process.env.FIREBASE_PROJECT_ID) {
      logger.error('Firebase token audience mismatch', {
        expected: process.env.FIREBASE_PROJECT_ID,
        actual: decodedToken.aud,
        uid: decodedToken.uid
      });
      throw new AuthenticationError('Firebase token audience mismatch');
    }

    // Issuer検証（iss claim）
    const expectedIssuer = `https://securetoken.google.com/${process.env.FIREBASE_PROJECT_ID}`;
    if (decodedToken.iss !== expectedIssuer) {
      logger.error('Firebase token issuer mismatch', {
        expected: expectedIssuer,
        actual: decodedToken.iss,
        uid: decodedToken.uid
      });
      throw new AuthenticationError('Firebase token issuer mismatch');
    }

    // Firebaseユーザー情報取得
    let firebaseUser;
    try {
      firebaseUser = await auth.getUser(decodedToken.uid);
    } catch (error) {
      logger.error('Failed to get Firebase user', {
        uid: decodedToken.uid,
        error: error.message
      });
      throw new AuthenticationError('Firebase user not found');
    }

    // メール認証確認（オプション）
    if (!firebaseUser.emailVerified && process.env.REQUIRE_EMAIL_VERIFICATION === 'true') {
      throw new AuthenticationError('Email not verified in Firebase');
    }

    // ローカルユーザーを作成または更新
    let user = await User.findOne({ 
      where: { firebaseUid: decodedToken.uid } 
    });

    let isNewUser = false;
    if (!user) {
      // 新規ユーザー作成
      isNewUser = true;
      user = await User.create({
        email: firebaseUser.email,
        name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Firebase User',
        password: require('crypto').randomBytes(32).toString('hex'), // ランダムパスワード
        role: 'user',
        firebaseUid: decodedToken.uid,
        emailVerified: firebaseUser.emailVerified,
        disabled: firebaseUser.disabled,
        metadata: {
          creationTime: firebaseUser.metadata.creationTime,
          lastSignInTime: firebaseUser.metadata.lastSignInTime,
          source: 'firebase_sso'
        }
      });
      
      logger.info('New user created via Firebase SSO', {
        userId: user.id,
        firebaseUid: decodedToken.uid,
        email: firebaseUser.email
      });
    } else {
      // 既存ユーザー更新
      await user.update({
        email: firebaseUser.email,
        name: firebaseUser.displayName || user.name,
        emailVerified: firebaseUser.emailVerified,
        disabled: firebaseUser.disabled,
        lastLogin: new Date(),
        metadata: {
          ...user.metadata,
          lastSignInTime: firebaseUser.metadata.lastSignInTime,
          lastSSOLogin: new Date().toISOString()
        }
      });
      
      logger.info('Existing user updated via Firebase SSO', {
        userId: user.id,
        firebaseUid: decodedToken.uid,
        email: firebaseUser.email
      });
    }

    // Custom claims for KYC site (ShareGram仕様対応)
    const customClaims = {
      kycSiteUser: true,
      role: user.role,
      userId: user.id,
      email: user.email,
      isNewUser,
      loginMethod: 'firebase_sso',
      loginTimestamp: Math.floor(Date.now() / 1000),
      // ShareGram仕様対応
      sharegramAction: action,           // create|edit
      sharegramPerformerId: performerId, // KYC出演者ID  
      sharegramReturnUrl: returnUrl      // ShareGram復帰URL
    };

    // Firebase Custom Token生成
    let customToken;
    try {
      customToken = await createCustomToken(decodedToken.uid, customClaims);
      logger.info('Firebase Custom Token created successfully', {
        uid: decodedToken.uid,
        userId: user.id
      });
    } catch (error) {
      logger.error('Failed to create Firebase Custom Token', {
        uid: decodedToken.uid,
        error: error.message
      });
      throw new Error('Failed to create custom token for KYC site authentication');
    }

    // 監査ログ
    auditLogger.logAuth({
      action: 'FIREBASE_SSO_LOGIN',
      userId: user.id,
      firebaseUid: decodedToken.uid,
      email: firebaseUser.email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      isNewUser,
      metadata: {
        tokenExp: decodedToken.exp,
        tokenIat: decodedToken.iat,
        authTime: decodedToken.auth_time
      }
    });

    // レスポンス (ShareGram仕様対応)
    res.json({
      success: true,
      customToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.name,
        firebaseUid: user.firebaseUid,
        role: user.role,
        emailVerified: user.emailVerified
      },
      isNewUser,
      sessionInfo: {
        loginMethod: 'firebase_sso',
        loginTimestamp: new Date().toISOString()
      },
      // ShareGram仕様対応情報
      sharegram: {
        action: action,
        performerId: performerId,  
        returnUrl: returnUrl
      }
    });

  } catch (error) {
    logger.error('Firebase SSO authentication error', {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    // 監査ログ（失敗）
    auditLogger.logAuth({
      action: 'FIREBASE_SSO_LOGIN',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      success: false,
      error: error.message,
      errorCode: error.code
    });

    // エラーレスポンス
    if (error instanceof ValidationError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message
        }
      });
    }

    if (error instanceof AuthenticationError) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: error.message
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'FIREBASE_SSO_ERROR',
        message: 'Firebase SSO authentication failed'
      }
    });
  }
}));

/**
 * Firebase SSO状態確認エンドポイント
 * GET /api/auth/firebase-sso/status
 */
router.get('/firebase-sso/status', asyncHandler(async (req, res) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.json({ 
        success: true,
        data: { 
          authenticated: false,
          firebaseEnabled: !!auth
        }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // ここでFirebase ID Tokenまたはカスタムトークンを検証
    let decodedToken;
    try {
      decodedToken = await verifyIdToken(token);
    } catch (error) {
      return res.json({ 
        success: true,
        data: { 
          authenticated: false,
          error: 'Invalid token'
        }
      });
    }
    
    const user = await User.findOne({
      where: { firebaseUid: decodedToken.uid }
    });
    
    res.json({
      success: true,
      data: {
        authenticated: true,
        firebaseUid: decodedToken.uid,
        user: user ? {
          id: user.id,
          email: user.email,
          displayName: user.name,
          role: user.role
        } : null
      }
    });

  } catch (error) {
    logger.error('Firebase SSO status check error:', error);
    res.json({
      success: true,
      data: {
        authenticated: false,
        error: 'Status check failed'
      }
    });
  }
}));

module.exports = router;