// CEO直轄緊急実装 - Firebase セキュリティ検証ミドルウェア
const crypto = require('crypto');
const { verifyIdToken, logger } = require('../config/firebase-admin');

// Firebase トークン形式検証
const validateFirebaseTokenFormat = (token) => {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string');
  }

  // JWT形式チェック (header.payload.signature)
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: must have 3 parts separated by dots');
  }

  // Base64URL形式チェック
  const base64UrlRegex = /^[A-Za-z0-9_-]+$/;
  
  parts.forEach((part, index) => {
    if (!part.match(base64UrlRegex)) {
      throw new Error(`Invalid JWT part ${index + 1}: must be valid Base64URL`);
    }
  });

  try {
    // ヘッダーデコード検証
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (!header.alg || !header.typ) {
      throw new Error('Invalid JWT header: missing algorithm or type');
    }

    // ペイロードデコード検証（基本構造のみ）
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!payload.iss || !payload.aud || !payload.exp) {
      throw new Error('Invalid JWT payload: missing required claims');
    }

    return { header, payload };
  } catch (decodeError) {
    throw new Error(`JWT decode failed: ${decodeError.message}`);
  }
};

// Firebase プロジェクトID検証強化
const validateFirebaseProject = (decodedToken) => {
  const expectedProjectId = process.env.FIREBASE_PROJECT_ID;
  
  if (!expectedProjectId) {
    throw new Error('FIREBASE_PROJECT_ID environment variable not set');
  }

  // Audience検証 (aud claim)
  if (decodedToken.aud !== expectedProjectId) {
    logger.error('Firebase token audience mismatch', {
      expected: expectedProjectId,
      actual: decodedToken.aud,
      uid: decodedToken.uid
    });
    throw new Error('Firebase token audience mismatch');
  }

  // Issuer検証 (iss claim)
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  if (decodedToken.iss !== expectedIssuer) {
    logger.error('Firebase token issuer mismatch', {
      expected: expectedIssuer,
      actual: decodedToken.iss,
      uid: decodedToken.uid
    });
    throw new Error('Firebase token issuer mismatch');
  }

  return true;
};

// トークン時間検証強化
const validateTokenTiming = (decodedToken) => {
  const now = Math.floor(Date.now() / 1000);
  
  // 有効期限チェック
  if (decodedToken.exp <= now) {
    throw new Error('Firebase token has expired');
  }

  // 発行時刻チェック（未来のトークン防止）
  if (decodedToken.iat > now + 60) { // 1分の許容
    throw new Error('Firebase token issued in the future');
  }

  // 認証時刻チェック
  if (decodedToken.auth_time && decodedToken.auth_time > now + 60) {
    throw new Error('Firebase token auth_time in the future');
  }

  // トークン寿命チェック（異常に長いトークンを拒否）
  const tokenLifetime = decodedToken.exp - decodedToken.iat;
  if (tokenLifetime > 24 * 60 * 60) { // 24時間以上
    throw new Error('Firebase token lifetime too long');
  }

  return true;
};

// カスタムクレーム検証
const validateCustomClaims = (decodedToken, expectedClaims = {}) => {
  // 必須クレームの存在確認
  const requiredClaims = ['uid', 'email'];
  requiredClaims.forEach(claim => {
    if (!decodedToken[claim]) {
      throw new Error(`Missing required claim: ${claim}`);
    }
  });

  // Email形式検証
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(decodedToken.email)) {
    throw new Error('Invalid email format in token');
  }

  // UID形式検証（Firebase UID は28文字の英数字）
  const uidRegex = /^[a-zA-Z0-9]{28}$/;
  if (!uidRegex.test(decodedToken.uid)) {
    throw new Error('Invalid Firebase UID format');
  }

  // 期待されるカスタムクレームの検証
  Object.entries(expectedClaims).forEach(([claim, expectedValue]) => {
    if (decodedToken[claim] !== expectedValue) {
      throw new Error(`Custom claim mismatch: ${claim}`);
    }
  });

  return true;
};

// セキュリティイベントログ
const logSecurityEvent = (eventType, details, req = null) => {
  const logData = {
    eventType,
    timestamp: new Date().toISOString(),
    ...details
  };

  if (req) {
    logData.request = {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      method: req.method,
      url: req.originalUrl,
      headers: {
        authorization: req.headers.authorization ? '[REDACTED]' : undefined,
        origin: req.headers.origin,
        referer: req.headers.referer
      }
    };
  }

  logger.warn('SECURITY_EVENT', logData);
};

// メイン検証ミドルウェア
const verifyFirebaseTokenSecurity = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_AUTHORIZATION',
          message: 'Authorization header with Bearer token required'
        }
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // 1. トークン形式検証
    let tokenStructure;
    try {
      tokenStructure = validateFirebaseTokenFormat(token);
    } catch (formatError) {
      logSecurityEvent('INVALID_TOKEN_FORMAT', {
        error: formatError.message,
        tokenPrefix: token.substring(0, 20) + '...'
      }, req);
      
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN_FORMAT',
          message: formatError.message
        }
      });
    }

    // 2. Firebase検証
    let decodedToken;
    try {
      decodedToken = await verifyIdToken(token, true); // checkRevoked=true
    } catch (firebaseError) {
      logSecurityEvent('FIREBASE_VERIFICATION_FAILED', {
        error: firebaseError.message,
        code: firebaseError.code
      }, req);

      const errorCodeMap = {
        'auth/id-token-expired': 'Firebase ID Token has expired',
        'auth/id-token-revoked': 'Firebase ID Token has been revoked',
        'auth/invalid-id-token': 'Invalid Firebase ID Token',
        'auth/user-disabled': 'Firebase user account has been disabled',
        'auth/user-not-found': 'Firebase user not found'
      };

      const errorMessage = errorCodeMap[firebaseError.code] || 'Firebase token verification failed';
      
      return res.status(401).json({
        success: false,
        error: {
          code: firebaseError.code || 'FIREBASE_VERIFICATION_FAILED',
          message: errorMessage
        }
      });
    }

    // 3. プロジェクト検証
    try {
      validateFirebaseProject(decodedToken);
    } catch (projectError) {
      logSecurityEvent('PROJECT_VALIDATION_FAILED', {
        error: projectError.message,
        uid: decodedToken.uid,
        projectId: decodedToken.aud
      }, req);

      return res.status(403).json({
        success: false,
        error: {
          code: 'PROJECT_VALIDATION_FAILED',
          message: projectError.message
        }
      });
    }

    // 4. 時間検証
    try {
      validateTokenTiming(decodedToken);
    } catch (timingError) {
      logSecurityEvent('TOKEN_TIMING_VALIDATION_FAILED', {
        error: timingError.message,
        uid: decodedToken.uid,
        iat: decodedToken.iat,
        exp: decodedToken.exp,
        auth_time: decodedToken.auth_time
      }, req);

      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_TIMING_VALIDATION_FAILED',
          message: timingError.message
        }
      });
    }

    // 5. カスタムクレーム検証
    try {
      validateCustomClaims(decodedToken);
    } catch (claimsError) {
      logSecurityEvent('CUSTOM_CLAIMS_VALIDATION_FAILED', {
        error: claimsError.message,
        uid: decodedToken.uid
      }, req);

      return res.status(400).json({
        success: false,
        error: {
          code: 'CUSTOM_CLAIMS_VALIDATION_FAILED',
          message: claimsError.message
        }
      });
    }

    // 検証成功 - リクエストにトークン情報を追加
    req.firebaseToken = decodedToken;
    req.firebaseUid = decodedToken.uid;
    req.userEmail = decodedToken.email;

    // セキュリティログ（成功）
    logger.info('Firebase token validation successful', {
      uid: decodedToken.uid,
      email: decodedToken.email,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    next();

  } catch (error) {
    logSecurityEvent('SECURITY_MIDDLEWARE_ERROR', {
      error: error.message,
      stack: error.stack
    }, req);

    logger.error('Firebase security middleware error', {
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'SECURITY_VALIDATION_ERROR',
        message: 'Security validation failed'
      }
    });
  }
};

// レート制限による追加セキュリティ
const createSecurityRateLimit = (windowMs = 15 * 60 * 1000, max = 100, message = 'Too many requests') => {
  const rateLimit = require('express-rate-limit');
  
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Firebase UID があれば使用、なければ IP
      return req.firebaseUid || req.ip;
    },
    handler: (req, res) => {
      logSecurityEvent('RATE_LIMIT_EXCEEDED', {
        ip: req.ip,
        uid: req.firebaseUid,
        userAgent: req.headers['user-agent']
      }, req);

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message
        }
      });
    }
  });
};

module.exports = {
  verifyFirebaseTokenSecurity,
  validateFirebaseTokenFormat,
  validateFirebaseProject,
  validateTokenTiming,
  validateCustomClaims,
  logSecurityEvent,
  createSecurityRateLimit
};