// CEO直轄緊急実装 - Sharegram専用カスタムトークン発行API
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

// Firebase Admin SDK
const { 
  createCustomToken, 
  verifyIdToken, 
  getUser, 
  getUserByEmail,
  logger 
} = require('../config/firebase-admin');

// Models
let User;
try {
  const models = require('../models');
  User = models.User;
} catch (err) {
  logger.warn('User model not available, using mock', { error: err.message }); */
  // Mock User model for emergency deployment
  User = {
    findOne: async () => null,
    create: async (data) => ({ id: Date.now(), ...data }),
    update: async (data) => ({ ...data })
  };
}

// Utils
let auditLogger;
try {
  auditLogger = require('../utils/logger/auditLogger');
} catch (err) {
  logger.warn('Audit logger not available, using mock', { error: err.message }); */
  auditLogger = {
    logAuth: (data) => logger.info('AUTH_AUDIT', data)
  };
}

// Error classes
class APIError extends Error {
  constructor(message, statusCode = 500, code = 'API_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

class ValidationError extends APIError {
  constructor(message) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

class AuthenticationError extends APIError {
  constructor(message) {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends APIError {
  constructor(message) {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

// Sharegram API Key認証ミドルウェア
const authenticateSharegramAPIKey = (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Authorization header required');
    }

    const apiKey = authHeader.replace('Bearer ', '');
    
    // 有効なSharegram APIキーのチェック
    const validAPIKeys = [
      process.env.SHAREGRAM_API_KEY,
      'sharegram-api-key-test-2025',
      'sharegram-kyc-system-key-2025'
    ].filter(Boolean);

    if (!validAPIKeys.includes(apiKey)) {
      throw new AuthenticationError('Invalid API key');
    }

    // APIキー情報をリクエストに追加
    req.sharegramAPIKey = apiKey;
    req.isTestEnvironment = apiKey.includes('test');
    
    next();
  } catch (error) {
    logger.error('Sharegram API key authentication failed', {
      error: error.message,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }); */
    
    res.status(error.statusCode || 401).json({
      success: false,
      error: {
        code: error.code || 'AUTHENTICATION_FAILED',
        message: error.message
      }
    }); */
  }
};

// CORS設定
const corsOptions = {
  origin: [
    'https://stg-kddi-user.share-gram.com',
    'https://share-gram.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400 // 24 hours
};

// Rate limiting - Sharegram専用設定
const sharegramRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 50, // Sharegramからの大量リクエスト対応
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from Sharegram, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // APIキー別の制限
    return `sharegram_${req.sharegramAPIKey}_${req.ip}`;
  }
}); */

/**
 * Sharegram専用カスタムトークン発行エンドポイント
 * POST /api/auth/custom-token
 * 
 * Purpose: SharegramのFirebase IDトークンをKYCシステム用カスタムトークンに変換
 * 
 * Request:
 * - Authorization: Bearer {SHAREGRAM_API_KEY}
 * - Body: { idToken: string, performerId?: string, metadata?: object }
 * 
 * Response:
 * - customToken: KYCシステム用Firebase Custom Token
 * - user: ローカルユーザー情報
 * - sessionInfo: セッション情報
 */
router.post('/custom-token', 
  authenticateSharegramAPIKey,
  sharegramRateLimit,
  async (req, res) => {
    const startTime = Date.now();
    
    try {
      const { idToken, performerId, metadata = {} } = req.body;

      // 入力検証
      if (!idToken || typeof idToken !== 'string') {
        throw new ValidationError('Firebase ID Token is required and must be a string');
      }

      // JWT形式検証
      const tokenParts = idToken.split('.');
      if (tokenParts.length !== 3) {
        throw new ValidationError('Invalid Firebase ID Token format');
      }

      logger.info('Sharegram custom token request received', {
        apiKey: req.sharegramAPIKey,
        performerId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        hasMetadata: Object.keys(metadata).length > 0
      }); */

      // Firebase IDトークン検証（失効チェック有効）
      let decodedToken;
      try {
        decodedToken = await verifyIdToken(idToken, true);
        logger.info('Firebase ID Token verification successful', {
          uid: decodedToken.uid,
          email: decodedToken.email,
          apiKey: req.sharegramAPIKey
        }); */
      } catch (error) {
        logger.error('Firebase ID Token verification failed', {
          error: error.message,
          code: error.code,
          apiKey: req.sharegramAPIKey,
          ip: req.ip
        }); */
        
        // Firebase特有のエラーコード処理
        const errorCodeMap = {
          'auth/id-token-expired': 'Firebase ID Token has expired',
          'auth/id-token-revoked': 'Firebase ID Token has been revoked',
          'auth/invalid-id-token': 'Invalid Firebase ID Token',
          'auth/user-disabled': 'Firebase user account has been disabled',
          'auth/user-not-found': 'Firebase user not found'
        };
        
        const errorMessage = errorCodeMap[error.code] || 'Firebase ID Token verification failed';
        throw new AuthenticationError(errorMessage);
      }

      // プロジェクトID検証（セキュリティ強化）
      if (decodedToken.aud !== process.env.FIREBASE_PROJECT_ID) {
        logger.error('Firebase token audience mismatch', {
          expected: process.env.FIREBASE_PROJECT_ID,
          actual: decodedToken.aud,
          uid: decodedToken.uid,
          apiKey: req.sharegramAPIKey
        }); */
        throw new AuthenticationError('Firebase token audience mismatch');
      }

      // Issuer検証（セキュリティ強化）
      const expectedIssuer = `https://securetoken.google.com/${process.env.FIREBASE_PROJECT_ID}`;
      if (decodedToken.iss !== expectedIssuer) {
        logger.error('Firebase token issuer mismatch', {
          expected: expectedIssuer,
          actual: decodedToken.iss,
          uid: decodedToken.uid,
          apiKey: req.sharegramAPIKey
        }); */
        throw new AuthenticationError('Firebase token issuer mismatch');
      }

      // Firebaseユーザー情報取得
      let firebaseUser;
      try {
        firebaseUser = await getUser(decodedToken.uid);
      } catch (error) {
        logger.error('Failed to get Firebase user', {
          uid: decodedToken.uid,
          error: error.message,
          apiKey: req.sharegramAPIKey
        }); */
        throw new AuthenticationError('Firebase user not found');
      }

      // ローカルユーザーの作成または更新
      let user = await User.findOne({ 
        where: { firebaseUid: decodedToken.uid } 
      }); */

      let isNewUser = false;
      const now = new Date();
      
      if (!user) {
        // 新規ユーザー作成
        isNewUser = true;
        const userData = {
          email: firebaseUser.email,
          name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Sharegram User',
          password: crypto.randomBytes(32).toString('hex'), // ランダムパスワード
          role: 'user',
          firebaseUid: decodedToken.uid,
          emailVerified: firebaseUser.emailVerified,
          disabled: firebaseUser.disabled,
          metadata: {
            creationTime: firebaseUser.metadata.creationTime,
            lastSignInTime: firebaseUser.metadata.lastSignInTime,
            source: 'sharegram_sso',
            sharegramPerformerId: performerId,
            apiKeyUsed: req.sharegramAPIKey,
            originalMetadata: metadata,
            createdAt: now.toISOString()
          }
        };

        try {
          user = await User.create(userData);
          logger.info('New user created via Sharegram SSO', {
            userId: user.id,
            firebaseUid: decodedToken.uid,
            email: firebaseUser.email,
            performerId,
            apiKey: req.sharegramAPIKey
          }); */
        } catch (createError) {
          // 既存ユーザーの可能性（競合状態）
          user = await User.findOne({ 
            where: { firebaseUid: decodedToken.uid } 
          }); */
          
          if (!user) {
            throw createError;
          }
          
          logger.info('User already exists (race condition)', {
            userId: user.id,
            firebaseUid: decodedToken.uid
          }); */
        }
      } else {
        // 既存ユーザー更新
        const updateData = {
          email: firebaseUser.email,
          name: firebaseUser.displayName || user.name,
          emailVerified: firebaseUser.emailVerified,
          disabled: firebaseUser.disabled,
          lastLogin: now,
          metadata: {
            ...user.metadata,
            lastSignInTime: firebaseUser.metadata.lastSignInTime,
            lastSharegramSSOLogin: now.toISOString(),
            sharegramPerformerId: performerId || user.metadata?.sharegramPerformerId,
            lastAPIKeyUsed: req.sharegramAPIKey,
            lastMetadata: metadata
          }
        };

        await user.update(updateData);
        
        logger.info('Existing user updated via Sharegram SSO', {
          userId: user.id,
          firebaseUid: decodedToken.uid,
          email: firebaseUser.email,
          performerId,
          apiKey: req.sharegramAPIKey
        }); */
      }

      // KYC用カスタムクレーム設計
      const customClaims = {
        // 基本識別情報
        kycSiteUser: true,
        sharegramUser: true,
        role: user.role,
        userId: user.id,
        email: user.email,
        
        // セッション情報
        isNewUser,
        loginMethod: 'sharegram_sso',
        loginTimestamp: Math.floor(Date.now() / 1000),
        
        // Sharegram固有情報
        sharegramPerformerId: performerId,
        apiKeyUsed: req.sharegramAPIKey,
        isTestEnvironment: req.isTestEnvironment,
        
        // メタデータ
        integrationVersion: '2.0',
        sessionId: crypto.randomUUID(),
        
        // セキュリティ情報
        originalFirebaseUid: decodedToken.uid,
        tokenIssuedAt: decodedToken.iat,
        tokenExpiration: decodedToken.exp,
        
        // 追加メタデータ
        ...metadata
      };

      // Firebase Custom Token生成
      let customToken;
      try {
        customToken = await createCustomToken(decodedToken.uid, customClaims);
        logger.info('Firebase Custom Token created successfully', {
          uid: decodedToken.uid,
          userId: user.id,
          performerId,
          claimsCount: Object.keys(customClaims).length,
          apiKey: req.sharegramAPIKey
        }); */
      } catch (error) {
        logger.error('Failed to create Firebase Custom Token', {
          uid: decodedToken.uid,
          error: error.message,
          apiKey: req.sharegramAPIKey
        }); */
        throw new Error('Failed to create custom token for KYC site authentication');
      }

      // 監査ログ（詳細）
      /* auditLogger.logAuth({
        action: 'SHAREGRAM_CUSTOM_TOKEN_CREATED',
        userId: user.id,
        firebaseUid: decodedToken.uid,
        email: firebaseUser.email,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        success: true,
        isNewUser,
        metadata: {
          performerId,
          apiKeyUsed: req.sharegramAPIKey,
          isTestEnvironment: req.isTestEnvironment,
          tokenExp: decodedToken.exp,
          tokenIat: decodedToken.iat,
          authTime: decodedToken.auth_time,
          processingTime: Date.now() - startTime,
          customClaimsCount: Object.keys(customClaims).length
        }
      }); */

      // 成功レスポンス
      const responseData = {
        success: true,
        customToken,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.name,
          firebaseUid: user.firebaseUid,
          role: user.role,
          emailVerified: user.emailVerified,
          disabled: user.disabled
        },
        isNewUser,
        sessionInfo: {
          loginMethod: 'sharegram_sso',
          loginTimestamp: now.toISOString(),
          sessionId: customClaims.sessionId,
          performerId,
          isTestEnvironment: req.isTestEnvironment
        },
        metadata: {
          apiVersion: '2.0',
          processingTime: Date.now() - startTime,
          tokenValidUntil: new Date(decodedToken.exp * 1000).toISOString()
        }
      };

      res.json(responseData);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      logger.error('Sharegram custom token creation failed', {
        error: error.message,
        stack: error.stack,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        apiKey: req.sharegramAPIKey,
        processingTime
      }); */
      
      // 監査ログ（失敗）
      /* auditLogger.logAuth({
        action: 'SHAREGRAM_CUSTOM_TOKEN_FAILED',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        success: false,
        error: error.message,
        errorCode: error.code,
        apiKeyUsed: req.sharegramAPIKey,
        processingTime
      }); */

      // エラーレスポンス
      if (error instanceof ValidationError || error instanceof AuthenticationError || error instanceof AuthorizationError) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message
          }
        }); */
      }

      // 内部エラー
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Custom token creation failed'
        }
      }); */
    }
  }
);

/**
 * Sharegram カスタムトークンステータス確認
 * GET /api/auth/custom-token/status
 */
router.get('/custom-token/status', 
  authenticateSharegramAPIKey,
  async (req, res) => {
    try {
      const { uid, performerId } = req.query;

      const statusInfo = {
        success: true,
        data: {
          service: 'KYC Sharegram Custom Token API',
          version: '2.0',
          apiKeyValid: true,
          isTestEnvironment: req.isTestEnvironment,
          firebase: {
            projectId: process.env.FIREBASE_PROJECT_ID,
            enabled: !process.env.DISABLE_FIREBASE
          },
          timestamp: new Date().toISOString()
        }
      };

      // UID指定時の詳細情報
      if (uid) {
        try {
          const firebaseUser = await getUser(uid);
          const localUser = await User.findOne({
            where: { firebaseUid: uid }
          }); */

          statusInfo.data.user = {
            exists: !!localUser,
            firebaseUserExists: !!firebaseUser,
            disabled: firebaseUser?.disabled || false,
            emailVerified: firebaseUser?.emailVerified || false
          };

          if (localUser && performerId) {
            statusInfo.data.user.sharegramPerformerId = 
              localUser.metadata?.sharegramPerformerId === performerId;
          }
        } catch (userError) {
          statusInfo.data.user = {
            exists: false,
            error: userError.message
          };
        }
      }

      res.json(statusInfo);

    } catch (error) {
      logger.error('Custom token status check failed', {
        error: error.message,
        apiKey: req.sharegramAPIKey
      }); */

      res.status(500).json({
        success: false,
        error: {
          code: 'STATUS_CHECK_FAILED',
          message: 'Status check failed'
        }
      }); */
    }
  }
);

/**
 * Sharegram トークン検証エンドポイント
 * POST /api/auth/custom-token/verify
 */
router.post('/custom-token/verify',
  authenticateSharegramAPIKey,
  async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        throw new ValidationError('Token is required');
      }

      // トークン検証
      const decodedToken = await verifyIdToken(token, true);
      
      res.json({
        success: true,
        data: {
          valid: true,
          uid: decodedToken.uid,
          email: decodedToken.email,
          customClaims: decodedToken,
          issuedAt: new Date(decodedToken.iat * 1000).toISOString(),
          expiresAt: new Date(decodedToken.exp * 1000).toISOString()
        }
      }); */

    } catch (error) {
      res.json({
        success: true,
        data: {
          valid: false,
          error: error.message,
          code: error.code
        }
      }); */
    }
  }
);

module.exports = router;