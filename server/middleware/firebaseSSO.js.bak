const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { User, FirebaseUser, SharegramIntegration } = require('../models');
const logger = require('../utils/logger/logger');
const { auditLog } = require('../utils/logger/auditLogger');
const AppError = require('../utils/errors/AppError');
const crypto = require('crypto');

// JWKSクライアントの設定（Sharegram公開鍵取得用）
const sharegramJwksClient = jwksClient({
  jwksUri: process.env.SHAREGRAM_JWKS_URI || 'https://api.sharegram.com/.well-known/jwks.json',
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000, // 10分
  rateLimit: true,
  jwksRequestsPerMinute: 10
});

// Firebase Admin SDK（既存のFirebase認証用）
const admin = require('firebase-admin');

// セッションストア（Redis使用）
const Redis = require('ioredis');
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  db: process.env.REDIS_SSO_DB || 2
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
      issuer: process.env.SHAREGRAM_ISSUER || 'https://api.sharegram.com',
      audience: process.env.SHAREGRAM_AUDIENCE || process.env.APP_CLIENT_ID
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
      await auditLog('sso_login_sharegram', verifiedUser.id, req.ip, {
        requestId,
        sharegramId: sharegramClaims.sub,
        sessionId,
        userAgent: req.get('user-agent'),
        processingTime: Date.now() - startTime
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
        await auditLog('sso_login_firebase', verifiedUser.id, req.ip, {
          requestId,
          firebaseUid: firebaseToken.uid,
          sessionId,
          userAgent: req.get('user-agent'),
          processingTime: Date.now() - startTime
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
    await auditLog('sso_auth_error', null, req.ip, {
      requestId,
      errorId,
      error: error.message,
      userAgent: req.get('user-agent')
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

module.exports = {
  firebaseSSO,
  verifySharegramToken,
  mapSharegramUser,
  mapFirebaseUser,
  createSSOSession,
  verifySSOSession,
  ssoLogout,
  checkSSOIntegration
};