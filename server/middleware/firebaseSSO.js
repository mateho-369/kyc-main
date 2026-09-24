const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { User, FirebaseUser, SharegramIntegration } = require('../models');
const { logger } = require('../utils/logger/logger');
const { auditLogger } = require('../utils/logger/auditLogger');

// AppError エラーハンドリング修正
let AppError, AuthenticationError, AuthorizationError, ValidationError, ExternalServiceError;
try {
  const errors = require('../utils/errors/AppError');
  AppError = errors.AppError;
  AuthenticationError = errors.AuthenticationError;
  AuthorizationError = errors.AuthorizationError;
  ValidationError = errors.ValidationError;
  ExternalServiceError = errors.ExternalServiceError;
} catch (err) {
  console.error('AppError import failed in firebaseSSO:', err.message);
  // Fallback classes
  AppError = class extends Error { constructor(message, statusCode = 500) { super(message); this.statusCode = statusCode; } };
  AuthenticationError = class extends AppError { constructor(message) { super(message, 401); } };
  AuthorizationError = class extends AppError { constructor(message) { super(message, 403); } };
  ValidationError = class extends AppError { constructor(message) { super(message, 400); } };
  ExternalServiceError = class extends AppError { constructor(message) { super(message, 503); } };
}

const crypto = require('crypto');

// Import SSO configuration
const { sharegramConfig, redisConfig } = require('../config/sso');

// JWKSクライアントの設定（Sharegram公開鍵取得用）
const sharegramJwksClient = jwksClient({
  jwksUri: sharegramConfig.jwksUri,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000, // 10分
  rateLimit: true,
  jwksRequestsPerMinute: 10
});

// Firebase Admin SDK（既存のFirebase認証用）
const admin = require('firebase-admin');

// セッションストア（Redis使用）- 修復済み設定
const Redis = require('ioredis');
const redis = new Redis({
  host: redisConfig.host,
  port: redisConfig.port,
  db: redisConfig.ssoDb,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: true,
  connectTimeout: 10000,
  commandTimeout: 5000,
  retryStrategy: (times) => {
    if (times > 3) return null;
    return Math.min(times * 50, 2000);
  }
});

// Redis接続エラーハンドリング
redis.on('error', (err) => {
  logger.error('Redis connection error:', err);
});

redis.on('connect', () => {
  logger.info('Redis connected successfully');
});

redis.on('ready', () => {
  logger.info('Redis ready for commands');
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

redis.on('reconnecting', () => {
  logger.info('Redis reconnecting...');
});

/**
 * Sharegram JWTトークン検証
 */
async function verifySharegramToken(token) {
  try {
    // JWTデコード（検証なし）
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) {
      throw new Error('Invalid token format');
    }

    // キーID取得
    const kid = decoded.header.kid;
    if (!kid) {
      throw new Error('No key ID found in token');
    }

    // 公開鍵取得
    const signingKey = await new Promise((resolve, reject) => {
      sharegramJwksClient.getSigningKey(kid, (err, key) => {
        if (err) {
          reject(err);
        } else {
          resolve(key.getPublicKey() || key.rsaPublicKey);
        }
      });
    });

    // トークン検証
    const verified = jwt.verify(token, signingKey, {
      algorithms: ['RS256'],
      issuer: sharegramConfig.issuer,
      audience: sharegramConfig.audience
    });

    return verified;
  } catch (error) {
    logger.error('Sharegram token verification failed:', error);
    throw new AppError('Invalid Sharegram token', 401);
  }
}

/**
 * Firebase SSO ミドルウェア（セキュリティ強化版）
 */
const firebaseSSO = async (req, res, next) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return next();
    }

    const [scheme, token] = authHeader.split(' ');
    
    if (scheme !== 'Bearer' || !token) {
      return next();
    }

    // トークンの基本検証
    if (token.length > 4096) {
      throw new AppError('Token too long', 400);
    }

    // レート制限チェック
    const rateLimitKey = `sso_rate_limit:${req.ip}`;
    const currentRequests = await redis.incr(rateLimitKey);
    if (currentRequests === 1) {
      await redis.expire(rateLimitKey, 60); // 1分間
    }
    
    if (currentRequests > 30) {
      throw new AppError('Rate limit exceeded', 429);
    }

    // トークンタイプ判定（Sharegram or Firebase）
    const isSharegramToken = token.includes('sg_') || req.headers['x-sso-provider'] === 'sharegram';
    
    let verifiedUser = null;
    let ssoProvider = null;

    if (isSharegramToken) {
      // Sharegramトークン処理
      logger.info('Processing Sharegram SSO token', { requestId });
      
      const sharegramClaims = await verifySharegramToken(token);
      ssoProvider = 'sharegram';

      // ユーザーマッピング
      verifiedUser = await mapSharegramUser(sharegramClaims);
      
      // セッション作成
      const sessionId = await createSSOSession(verifiedUser, sharegramClaims, 'sharegram');
      
      // 監査ログ
      await auditLogger.log('sso_login_sharegram', verifiedUser.id, 'authentication', {
        requestId,
        sharegramId: sharegramClaims.sub,
        sessionId,
        userAgent: req.get('user-agent'),
        processingTime: Date.now() - startTime,
        ip: req.ip
      });

    } else {
      // 既存のFirebaseトークン処理
      try {
        const firebaseToken = await admin.auth().verifyIdToken(token, true); // checkRevoked = true
        ssoProvider = 'firebase';

        // Firebase ユーザーマッピング
        verifiedUser = await mapFirebaseUser(firebaseToken);
        
        // セッション作成
        const sessionId = await createSSOSession(verifiedUser, firebaseToken, 'firebase');
        
        // 監査ログ
        await auditLogger.log('sso_login_firebase', verifiedUser.id, 'authentication', {
          requestId,
          firebaseUid: firebaseToken.uid,
          sessionId,
          userAgent: req.get('user-agent'),
          processingTime: Date.now() - startTime,
          ip: req.ip
        });

      } catch (firebaseError) {
        // Firebaseトークンでもない場合は通常の認証フローへ
        logger.debug('Firebase token verification failed, passing to next middleware', {
          requestId,
          error: firebaseError.message
        });
        return next();
      }
    }

    // リクエストにユーザー情報を追加
    req.user = verifiedUser;
    req.ssoProvider = ssoProvider;
    req.isSSO = true;
    req.requestId = requestId;

    next();

  } catch (error) {
    const errorId = crypto.randomUUID();
    
    logger.error('SSO authentication error', {
      requestId,
      errorId,
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      processingTime: Date.now() - startTime
    });

    // 監査ログ
    await auditLogger.log('sso_auth_error', null, 'authentication', {
      requestId,
      errorId,
      error: error.message,
      userAgent: req.get('user-agent'),
      ip: req.ip
    });
    
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        error: {
          code: 'SSO_AUTH_FAILED',
          message: error.message,
          requestId,
          errorId
        }
      });
    }

    return res.status(500).json({
      error: {
        code: 'SSO_ERROR',
        message: 'SSO authentication failed',
        requestId,
        errorId
      }
    });
  }
};

/**
 * Sharegramユーザーマッピング
 */
async function mapSharegramUser(sharegramClaims) {
  const { sub: sharegramId, email, name, picture, verified } = sharegramClaims;

  try {
    // 既存のマッピング確認
    let user = await User.findOne({
      where: { sharegramId },
      include: ['performer']
    });

    if (!user && email) {
      // メールアドレスで既存ユーザー検索
      user = await User.findOne({
        where: { email },
        include: ['performer']
      });

      if (user) {
        // SharegramIDを既存ユーザーに紐付け
        await user.update({ sharegramId });
        logger.info(`Linked existing user ${user.id} to Sharegram ID ${sharegramId}`);
      }
    }

    if (!user) {
      // 新規ユーザー作成
      user = await User.create({
        email: email || `sg_${sharegramId}@sharegram.local`,
        username: `sg_${sharegramId}`,
        sharegramId,
        displayName: name,
        profileImage: picture,
        role: 'performer',
        isActive: true,
        isEmailVerified: verified || false,
        authProvider: 'sharegram',
        lastLoginAt: new Date()
      });

      logger.info(`Created new user from Sharegram SSO: ${user.id}`);
    } else {
      // 最終ログイン更新
      await user.update({
        lastLoginAt: new Date(),
        profileImage: picture || user.profileImage,
        displayName: name || user.displayName
      });
    }

    return user.toJSON();

  } catch (error) {
    logger.error('Sharegram user mapping error:', error);
    throw new AppError('Failed to map Sharegram user', 500);
  }
}

/**
 * Firebaseユーザーマッピング（既存処理を拡張）
 */
async function mapFirebaseUser(firebaseToken) {
  const { uid, email, name, picture } = firebaseToken;

  try {
    // 既存のFirebaseユーザー確認
    let firebaseUser = await FirebaseUser.findOne({
      where: { firebaseUid: uid },
      include: ['user']
    });

    let user;

    if (firebaseUser && firebaseUser.user) {
      user = firebaseUser.user;
      // 最終ログイン更新
      await user.update({ lastLoginAt: new Date() });
    } else {
      // 新規ユーザー作成
      user = await User.create({
        email: email || `fb_${uid}@firebase.local`,
        username: `fb_${uid}`,
        displayName: name,
        profileImage: picture,
        role: 'user',
        isActive: true,
        isEmailVerified: firebaseToken.email_verified || false,
        authProvider: 'firebase',
        lastLoginAt: new Date()
      });

      // Firebase User記録作成
      await FirebaseUser.create({
        userId: user.id,
        firebaseUid: uid,
        email: email,
        emailVerified: firebaseToken.email_verified || false,
        provider: firebaseToken.firebase.sign_in_provider || 'password',
        metadata: {
          signInProvider: firebaseToken.firebase.sign_in_provider,
          creationTime: firebaseToken.auth_time
        }
      });
    }

    return user.toJSON();

  } catch (error) {
    logger.error('Firebase user mapping error:', error);
    throw new AppError('Failed to map Firebase user', 500);
  }
}

/**
 * SSOセッション作成
 */
async function createSSOSession(user, claims, provider) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const sessionKey = `sso:session:${sessionId}`;
  
  const sessionData = {
    userId: user.id,
    provider,
    claims,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24時間
  };

  // Redisにセッション保存
  await redis.setex(sessionKey, 86400, JSON.stringify(sessionData)); // 24時間TTL

  // ユーザーのアクティブセッション記録
  const userSessionsKey = `sso:user:${user.id}:sessions`;
  await redis.sadd(userSessionsKey, sessionId);
  await redis.expire(userSessionsKey, 86400);

  return sessionId;
}

/**
 * SSOセッション検証
 */
async function verifySSOSession(sessionId) {
  const sessionKey = `sso:session:${sessionId}`;
  const sessionData = await redis.get(sessionKey);

  if (!sessionData) {
    return null;
  }

  const session = JSON.parse(sessionData);
  
  // 有効期限確認
  if (new Date(session.expiresAt) < new Date()) {
    await redis.del(sessionKey);
    return null;
  }

  return session;
}

/**
 * SSOログアウト
 */
async function ssoLogout(userId) {
  const userSessionsKey = `sso:user:${userId}:sessions`;
  const sessions = await redis.smembers(userSessionsKey);

  // 全セッション削除
  const pipeline = redis.pipeline();
  for (const sessionId of sessions) {
    pipeline.del(`sso:session:${sessionId}`);
  }
  pipeline.del(userSessionsKey);
  
  await pipeline.exec();
  
  logger.info(`SSO logout completed for user ${userId}`);
}

/**
 * 統合設定確認
 */
async function checkSSOIntegration() {
  try {
    const integration = await SharegramIntegration.findOne({
      where: {
        integrationType: 'sso',
        isActive: true
      }
    });

    return {
      sharegram: {
        enabled: !!integration,
        jwksUri: process.env.SHAREGRAM_JWKS_URI || 'Not configured',
        issuer: process.env.SHAREGRAM_ISSUER || 'Not configured'
      },
      firebase: {
        enabled: !!admin.apps.length,
        projectId: process.env.FIREBASE_PROJECT_ID || 'Not configured'
      }
    };
  } catch (error) {
    logger.error('SSO integration check failed:', error);
    return {
      sharegram: { enabled: false },
      firebase: { enabled: false }
    };
  }
}

/**
 * SharegramのUSER_ACCESS_TOKENを検証してユーザー情報を取得
 */
async function verifySharegramAccessToken(userAccessToken) {
  try {
    // SharegramのAPIエンドポイントでトークンを検証
    const axios = require('axios');
    const sharegramApiUrl = process.env.SHAREGRAM_API_URL || 'https://api.sharegram.com';
    
    // timeout 必須: 無しだと Sharegram 側が無応答のときリクエストが返らず
    // nginx が 60 秒で 504 を返す（asyncHandler では pending な Promise は救えない）
    const response = await axios.get(`${sharegramApiUrl}/api/v1/user/me`, {
      timeout: parseInt(process.env.SHAREGRAM_API_TIMEOUT_MS, 10) || 10000,
      headers: {
        'Authorization': `Bearer ${userAccessToken}`,
        'Accept': 'application/json'
      }
    });
    
    if (response.data && response.data.userId) {
      return {
        userId: response.data.userId,
        email: response.data.email,
        name: response.data.name,
        picture: response.data.picture,
        verified: response.data.verified || false
      };
    }
    
    throw new Error('Invalid response from Sharegram API');
  } catch (error) {
    logger.error('Sharegram access token verification failed:', error);
    throw new AppError('Invalid Sharegram access token', 401);
  }
}

/**
 * SharegramユーザーをFirebase認証用に検索または作成
 */
async function findOrCreateSharegramUser({ sharegramUserId, email, verifiedData = {} }) {
  try {
    // 既存のユーザーを検索
    // 注意: 参照するカラム名・値は必ず models/User.js の定義に合わせること。
    // 以前は存在しない sharegramId / include:'performer' を参照しており、
    // このエンドポイントは常に失敗していた。
    let user = await User.findOne({
      where: { sharegramUserId }
    });

    if (!user && email) {
      // メールアドレスで既存ユーザー検索
      user = await User.findOne({
        where: { email }
      });

      if (user) {
        // Sharegram ID を既存ユーザーに紐付け
        await user.update({ sharegramUserId });
        logger.info(`Linked existing user ${user.id} to Sharegram ID ${sharegramUserId}`);
      }
    }

    const isNewUser = !user;

    if (!user) {
      // 新規ユーザー作成
      user = await User.create({
        email: email || `sg_${sharegramUserId}@sharegram.local`,
        name: verifiedData.name || 'Sharegram User',
        // password は allowNull: false。SSOユーザーはパスワード認証しないため
        // ランダム値を設定する（beforeCreate フックでハッシュ化される）
        password: crypto.randomBytes(32).toString('hex'),
        role: 'user',
        sharegramUserId,
        authProvider: 'firebase',
        isActive: true,
        emailVerified: verifiedData.verified || false,
        lastLoginAt: new Date()
      });

      logger.info(`Created new user from Sharegram SSO: ${user.id}`);
    } else {
      // 最終ログイン更新
      await user.update({
        lastLoginAt: new Date(),
        name: verifiedData.name || user.name
      });
    }

    return {
      user: user.toJSON(),
      sharegramUserId,
      isNewUser
    };
  } catch (error) {
    logger.error('Sharegram user creation/update error:', error);
    throw new AppError('Failed to process Sharegram user', 500);
  }
}

/**
 * Firebase Admin SDKでカスタムトークンを生成
 */
async function createFirebaseCustomToken(user) {
  try {
    // Firebase Admin SDKがない場合はエラー
    if (!admin.apps.length) {
      throw new Error('Firebase Admin SDK not initialized');
    }
    
    // カスタムクレームを設定
    // クレーム名は読み取り側（routes/auth-firebase.js の decodedToken.sharegram_user_id）
    // に合わせること。名前がずれると Sharegram ID が伝播せず、
    // 出演者レコードが external_id なしで作成される
    const customClaims = {
      sharegram_user_id: user.sharegramUserId,
      role: user.role,
      userId: user.id
    };
    
    // Firebase Custom Tokenを生成
    const customToken = await admin.auth().createCustomToken(user.id.toString(), customClaims);
    
    logger.info('Firebase custom token created for user:', user.id);
    return customToken;
  } catch (error) {
    logger.error('Firebase custom token creation error:', error);
    throw new AppError('Failed to create Firebase custom token', 500);
  }
}

/**
 * セッショントークンの生成（後方互換性のため残す）
 */
async function createSessionToken(user) {
  // 検証は jwt.sign より前に行う（後ろにあると到達せず、
  // JWT_SECRET 未設定時に分かりにくい例外になる）
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      // クレーム名は既存セッションとの互換のため sharegramId のまま。
      // 値は User モデルの実カラム sharegramUserId から取る
      sharegramId: user.sharegramUserId
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * Sharegram SSO用の認証ミドルウェア
 */
async function authenticateSharegramSSO(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Missing authorization header', 401);
    }

    const token = authHeader.substring(7);

    // セッショントークンを検証
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // ユーザー情報を取得
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      throw new AppError('User not found', 401);
    }
    
    req.user = user.toJSON();
    req.sharegramUser = { sharegramUserId: decoded.sharegramId };
    
    next();
  } catch (error) {
    logger.error('Sharegram SSO authentication error:', error);
    return res.status(401).json({
      error: 'Authentication failed'
    });
  }
}

/**
 * セッションの無効化
 */
async function invalidateSession(sessionToken) {
  // TODO: Implement session invalidation if needed
  logger.info('Session invalidation requested');
}

module.exports = {
  firebaseSSO,
  verifySharegramToken,
  verifySharegramAccessToken,
  mapSharegramUser,
  mapFirebaseUser,
  createSSOSession,
  verifySSOSession,
  ssoLogout,
  checkSSOIntegration,
  findOrCreateSharegramUser,
  createFirebaseCustomToken,
  createSessionToken,
  authenticateSharegramSSO,
  invalidateSession
};