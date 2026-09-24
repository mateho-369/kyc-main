/**
 * 統一認証ミドルウェア
 * 
 * 特徴:
 * - 単一エントリポイントでの認証処理
 * - JWT・Firebase認証の統合
 * - 確実な権限チェック機能
 * - フェイルセーフ機能の実装
 * - 認証バイパス防止機能
 */

const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { User, FirebaseUser, AuditLog } = require('../models');
const { logger } = require('../utils/logger/logger');
const { auditLogger } = require('../utils/logger/auditLogger');

// Firebase Admin SDK初期化チェック
const initializeFirebaseAdmin = () => {
  if (!admin.apps.length) {
    const config = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    };
    
    // 必須設定の検証
    if (!config.projectId || !config.clientEmail || !config.privateKey) {
      throw new Error('Firebase Admin SDK configuration is incomplete');
    }
    
    admin.initializeApp({
      credential: admin.credential.cert(config)
    });
  }
};

// 安全な初期化実行
try {
  initializeFirebaseAdmin();
} catch (error) {
  logger.error('Firebase Admin SDK initialization failed:', error);
}

/**
 * 認証結果の標準化
 */
class AuthResult {
  constructor(success, user = null, method = null, error = null) {
    this.success = success;
    this.user = user;
    this.method = method;
    this.error = error;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * JWT認証処理
 */
const authenticateJWT = async (token) => {
  try {
    if (!token) {
      return new AuthResult(false, null, 'jwt', 'No JWT token provided');
    }

    // JWTトークンの検証
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (!decoded || !decoded.user || !decoded.user.id) {
      return new AuthResult(false, null, 'jwt', 'Invalid JWT token structure');
    }

    // データベースからユーザーを取得
    const user = await User.findByPk(decoded.user.id);
    
    if (!user) {
      return new AuthResult(false, null, 'jwt', 'User not found');
    }

    // ユーザーの有効性チェック
    if (!user.isActive) {
      return new AuthResult(false, null, 'jwt', 'User account is deactivated');
    }

    return new AuthResult(true, user, 'jwt', null);
    
  } catch (error) {
    logger.error('JWT authentication error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return new AuthResult(false, null, 'jwt', 'Invalid JWT token');
    }
    
    if (error.name === 'TokenExpiredError') {
      return new AuthResult(false, null, 'jwt', 'JWT token expired');
    }
    
    return new AuthResult(false, null, 'jwt', 'JWT authentication failed');
  }
};

/**
 * Firebase認証処理
 */
const authenticateFirebase = async (token) => {
  try {
    if (!token) {
      return new AuthResult(false, null, 'firebase', 'No Firebase token provided');
    }

    // Firebase IDトークンの検証
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    if (!decodedToken || !decodedToken.uid) {
      return new AuthResult(false, null, 'firebase', 'Invalid Firebase token');
    }

    // カスタムクレームでブロックされているかチェック
    if (decodedToken.customClaims?.blocked) {
      return new AuthResult(false, null, 'firebase', 'User account is blocked');
    }

    // FirebaseユーザーをDBから取得
    let firebaseUser = await FirebaseUser.findOne({
      where: { firebaseUid: decodedToken.uid },
      include: [{ model: User }]
    });

    let user = null;

    if (firebaseUser?.User) {
      user = firebaseUser.User;
      
      // 最終ログイン時刻を更新
      await firebaseUser.update({
        lastLoginAt: new Date(),
        emailVerified: decodedToken.email_verified
      });
    } else {
      // 新規ユーザーの作成
      user = await createFirebaseUser(decodedToken);
    }

    // ユーザーの有効性チェック
    if (!user.isActive) {
      return new AuthResult(false, null, 'firebase', 'User account is deactivated');
    }

    return new AuthResult(true, user, 'firebase', null);
    
  } catch (error) {
    logger.error('Firebase authentication error:', error);
    
    if (error.code === 'auth/id-token-expired') {
      return new AuthResult(false, null, 'firebase', 'Firebase token expired');
    }
    
    if (error.code === 'auth/id-token-revoked') {
      return new AuthResult(false, null, 'firebase', 'Firebase token revoked');
    }
    
    return new AuthResult(false, null, 'firebase', 'Firebase authentication failed');
  }
};

/**
 * 新規Firebaseユーザーの作成
 */
const createFirebaseUser = async (decodedToken) => {
  const transaction = await User.sequelize.transaction();
  
  try {
    const { uid, email, name, picture, email_verified } = decodedToken;
    
    // 既存のローカルユーザーをチェック
    let user = await User.findOne({
      where: { email: email || `${uid}@firebase.local` },
      transaction
    });

    if (!user) {
      // 新規ユーザー作成
      user = await User.create({
        email: email || `${uid}@firebase.local`,
        name: name || email?.split('@')[0] || `User_${uid.slice(0, 8)}`,
        role: 'user',
        isActive: true,
        password: 'firebase-auth-user', // Firebase認証のため実際のパスワードは不要
        createdAt: new Date(),
        updatedAt: new Date()
      }, { transaction });
    }

    // FirebaseUserレコードの作成
    await FirebaseUser.create({
      firebaseUid: uid,
      userId: user.id,
      email: email || `${uid}@firebase.local`,
      displayName: name || '',
      photoURL: picture || null,
      emailVerified: email_verified || false,
      provider: decodedToken.firebase?.sign_in_provider || 'unknown',
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    }, { transaction });

    await transaction.commit();
    return user;
    
  } catch (error) {
    await transaction.rollback();
    logger.error('Error creating Firebase user:', error);
    throw error;
  }
};

/**
 * 統一認証ミドルウェア
 * 
 * 処理順序:
 * 1. トークンの抽出と検証
 * 2. Firebase認証を優先して実行
 * 3. Firebase認証失敗時はJWT認証を実行
 * 4. 両方失敗時はエラーレスポンス
 * 5. 成功時はユーザー情報をリクエストに設定
 */
const unifiedAuth = (options = {}) => {
  const {
    required = true,
    allowedRoles = [],
    allowedPermissions = [],
    skipAuditLog = false
  } = options;

  return async (req, res, next) => {
    const requestId = req.headers['x-request-id'] || require('crypto').randomUUID();
    const clientIP = req.ip || req.connection.remoteAddress;
    
    try {
      // トークンの抽出
      const authHeader = req.headers.authorization;
      const firebaseToken = req.headers['firebase-token'];
      
      let jwtToken = null;
      let firebaseIdToken = null;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        
        // トークンの形式でFirebaseかJWTかを判断
        if (token.includes('.') && token.split('.').length === 3) {
          // JWTの可能性が高い場合、両方試す
          firebaseIdToken = token;
          jwtToken = token;
        } else {
          jwtToken = token;
        }
      }
      
      if (firebaseToken) {
        firebaseIdToken = firebaseToken;
      }

      // 認証が必須でトークンが存在しない場合
      if (required && !jwtToken && !firebaseIdToken) {
        await logAuthEvent(req, 'AUTH_FAILED', 'No authentication token provided', requestId);
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          message: 'No authentication token provided',
          requestId
        });
      }

      // 認証が必須でない場合、トークンがなければそのまま続行
      if (!required && !jwtToken && !firebaseIdToken) {
        req.user = null;
        req.authMethod = null;
        return next();
      }

      let authResult = null;

      // Firebase認証を優先
      if (firebaseIdToken) {
        authResult = await authenticateFirebase(firebaseIdToken);
        
        // Firebase認証失敗時、JWTも試す
        if (!authResult.success && jwtToken && firebaseIdToken === jwtToken) {
          authResult = await authenticateJWT(jwtToken);
        }
      } else if (jwtToken) {
        authResult = await authenticateJWT(jwtToken);
      }

      // 認証失敗
      if (!authResult || !authResult.success) {
        await logAuthEvent(req, 'AUTH_FAILED', authResult?.error || 'Authentication failed', requestId);
        return res.status(401).json({
          success: false,
          error: 'Authentication failed',
          message: authResult?.error || 'Invalid or expired token',
          requestId
        });
      }

      // 役割ベースのアクセス制御
      if (allowedRoles.length > 0 && !allowedRoles.includes(authResult.user.role)) {
        await logAuthEvent(req, 'ACCESS_DENIED', `Insufficient role: ${authResult.user.role}`, requestId);
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'Insufficient permissions',
          required: allowedRoles,
          current: authResult.user.role,
          requestId
        });
      }

      // 権限ベースのアクセス制御（後で実装）
      if (allowedPermissions.length > 0) {
        // TODO: パーミッションチェック実装
      }

      // 認証成功 - リクエストにユーザー情報を設定
      req.user = {
        id: authResult.user.id,
        email: authResult.user.email,
        name: authResult.user.name,
        role: authResult.user.role,
        isActive: authResult.user.isActive
      };
      
      req.authMethod = authResult.method;
      req.requestId = requestId;

      // 監査ログの記録
      if (!skipAuditLog) {
        await logAuthEvent(req, 'AUTH_SUCCESS', `User authenticated via ${authResult.method}`, requestId);
      }

      // 最終ログイン時刻の更新
      await authResult.user.update({ lastLoginAt: new Date() });

      next();
      
    } catch (error) {
      logger.error('Unified authentication error:', error);
      
      await logAuthEvent(req, 'AUTH_ERROR', error.message, requestId);
      
      return res.status(500).json({
        success: false,
        error: 'Authentication system error',
        message: 'Internal server error during authentication',
        requestId
      });
    }
  };
};

/**
 * 監査ログの記録
 */
const logAuthEvent = async (req, event, message, requestId) => {
  try {
    const logData = {
      event,
      message,
      requestId,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id || null,
      timestamp: new Date()
    };

    // 監査ログへの記録
    await auditLogger.log(logData);
    
  } catch (error) {
    logger.error('Failed to log auth event:', error);
  }
};

/**
 * 管理者権限チェック
 */
const requireAdmin = unifiedAuth({
  required: true,
  allowedRoles: ['admin'],
  skipAuditLog: false
});

/**
 * オプショナル認証
 */
const optionalAuth = unifiedAuth({
  required: false,
  skipAuditLog: true
});

/**
 * 認証必須（デフォルト）
 */
const requireAuth = unifiedAuth({
  required: true,
  skipAuditLog: false
});

module.exports = {
  unifiedAuth,
  requireAuth,
  requireAdmin,
  optionalAuth,
  authenticateJWT,
  authenticateFirebase
};