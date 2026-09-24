// Firebase統合エラーハンドリングミドルウェア
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../config/firebase-admin');

// Firebase特有のエラー処理
class FirebaseError extends Error {
  constructor(message, code, statusCode = 400, details = {}) {
    super(message);
    this.name = 'FirebaseError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// エラーコード定義
const FIREBASE_ERROR_CODES = {
  // 認証エラー
  INVALID_ID_TOKEN: 'FIREBASE_AUTH_001',
  TOKEN_EXPIRED: 'FIREBASE_AUTH_002',
  TOKEN_REVOKED: 'FIREBASE_AUTH_003',
  SESSION_EXPIRED: 'FIREBASE_AUTH_004',
  USER_NOT_FOUND: 'FIREBASE_AUTH_005',
  EMAIL_ALREADY_EXISTS: 'FIREBASE_AUTH_006',
  WEAK_PASSWORD: 'FIREBASE_AUTH_007',
  INVALID_EMAIL: 'FIREBASE_AUTH_008',
  
  // 統合エラー
  SYNC_FAILED: 'FIREBASE_SYNC_001',
  MIGRATION_FAILED: 'FIREBASE_SYNC_002',
  DATA_INCONSISTENCY: 'FIREBASE_SYNC_003',
  
  // システムエラー
  FIREBASE_UNAVAILABLE: 'FIREBASE_SYS_001',
  QUOTA_EXCEEDED: 'FIREBASE_SYS_002',
  CONFIGURATION_ERROR: 'FIREBASE_SYS_003'
};

// Firebase統合エラーハンドラー
const firebaseErrorHandler = (err, req, res, next) => {
  const traceId = uuidv4();
  
  // Firebase関連のエラーかチェック
  if (!isFirebaseRelatedError(err) && err.name !== 'FirebaseError') {
    return next(err);
  }

  // エラーの分類と変換
  const processedError = processFirebaseError(err, traceId);
  
  // エラーログの記録
  logFirebaseError(processedError, req, traceId);
  
  // セキュリティ監査ログ
  if (isSecurityRelatedError(processedError)) {
    logSecurityEvent(processedError, req, traceId);
  }
  
  // クライアントレスポンス
  const response = createErrorResponse(processedError, traceId);
  res.status(processedError.statusCode).json(response);
};

// Firebase関連エラーの判定
function isFirebaseRelatedError(error) {
  const firebaseIndicators = [
    'auth/',
    'firebase',
    'id-token',
    'session-cookie',
    'custom-token'
  ];
  
  return firebaseIndicators.some(indicator => 
    error.message.toLowerCase().includes(indicator) ||
    error.code?.includes(indicator)
  );
}

// Firebaseエラーの処理
function processFirebaseError(error, traceId) {
  // 既に処理済みのFirebaseErrorの場合
  if (error.name === 'FirebaseError') {
    return {
      ...error,
      traceId
    };
  }

  // Firebase Admin SDKエラーのマッピング
  if (error.code?.startsWith('auth/')) {
    return mapFirebaseAuthError(error, traceId);
  }

  // その他のFirebase関連エラー
  return {
    message: sanitizeErrorMessage(error.message),
    code: FIREBASE_ERROR_CODES.FIREBASE_UNAVAILABLE,
    statusCode: 503,
    details: {},
    traceId,
    originalCode: error.code
  };
}

// Firebase Auth エラーのマッピング
function mapFirebaseAuthError(error, traceId) {
  const errorMappings = {
    'auth/id-token-expired': {
      message: '認証トークンが期限切れです',
      code: FIREBASE_ERROR_CODES.TOKEN_EXPIRED,
      statusCode: 401
    },
    'auth/id-token-revoked': {
      message: '認証トークンが無効化されています',
      code: FIREBASE_ERROR_CODES.TOKEN_REVOKED,
      statusCode: 401
    },
    'auth/invalid-id-token': {
      message: '無効な認証トークンです',
      code: FIREBASE_ERROR_CODES.INVALID_ID_TOKEN,
      statusCode: 401
    },
    'auth/session-cookie-expired': {
      message: 'セッションが期限切れです',
      code: FIREBASE_ERROR_CODES.SESSION_EXPIRED,
      statusCode: 401
    },
    'auth/session-cookie-revoked': {
      message: 'セッションが無効化されています',
      code: FIREBASE_ERROR_CODES.SESSION_EXPIRED,
      statusCode: 401
    },
    'auth/user-not-found': {
      message: 'ユーザーが見つかりません',
      code: FIREBASE_ERROR_CODES.USER_NOT_FOUND,
      statusCode: 404
    },
    'auth/email-already-exists': {
      message: 'このメールアドレスは既に使用されています',
      code: FIREBASE_ERROR_CODES.EMAIL_ALREADY_EXISTS,
      statusCode: 409
    },
    'auth/weak-password': {
      message: 'パスワードが弱すぎます',
      code: FIREBASE_ERROR_CODES.WEAK_PASSWORD,
      statusCode: 400
    },
    'auth/invalid-email': {
      message: '無効なメールアドレスです',
      code: FIREBASE_ERROR_CODES.INVALID_EMAIL,
      statusCode: 400
    },
    'auth/too-many-requests': {
      message: 'リクエストが多すぎます。しばらくしてから再試行してください',
      code: FIREBASE_ERROR_CODES.QUOTA_EXCEEDED,
      statusCode: 429
    },
    'auth/network-request-failed': {
      message: 'ネットワークエラーが発生しました',
      code: FIREBASE_ERROR_CODES.FIREBASE_UNAVAILABLE,
      statusCode: 503
    }
  };

  const mapping = errorMappings[error.code] || {
    message: '認証エラーが発生しました',
    code: FIREBASE_ERROR_CODES.FIREBASE_UNAVAILABLE,
    statusCode: 500
  };

  return {
    ...mapping,
    traceId,
    originalCode: error.code,
    details: {
      timestamp: new Date().toISOString()
    }
  };
}

// エラーメッセージのサニタイズ
function sanitizeErrorMessage(message) {
  if (!message) return '不明なエラーが発生しました';
  
  // センシティブな情報を除去
  return message
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]')
    .replace(/Bearer [A-Za-z0-9\-._~+\/]+=*/g, 'Bearer [token]')
    .replace(/uid=[\w-]+/g, 'uid=[uid]')
    .replace(/"[^"]*token[^"]*":\s*"[^"]+"/gi, '"[token-field]": "[redacted]"');
}

// Firebaseエラーログの記録
function logFirebaseError(error, req, traceId) {
  const logData = {
    traceId,
    error: {
      message: error.message,
      code: error.code,
      originalCode: error.originalCode,
      statusCode: error.statusCode
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      referer: req.get('referer')
    },
    user: req.user ? {
      id: req.user.id,
      email: req.user.email
    } : null,
    firebase: {
      uid: req.firebaseUid,
      authMethod: req.authMethod
    },
    timestamp: new Date().toISOString()
  };

  logger.error('Firebase integration error', logData);
}

// セキュリティ関連エラーの判定
function isSecurityRelatedError(error) {
  const securityCodes = [
    FIREBASE_ERROR_CODES.INVALID_ID_TOKEN,
    FIREBASE_ERROR_CODES.TOKEN_REVOKED,
    FIREBASE_ERROR_CODES.SESSION_EXPIRED
  ];
  
  return securityCodes.includes(error.code) || error.statusCode === 401;
}

// セキュリティイベントログ
function logSecurityEvent(error, req, traceId) {
  const securityEvent = {
    event: 'FIREBASE_SECURITY_ERROR',
    severity: determineSeverity(error),
    traceId,
    details: {
      errorCode: error.code,
      statusCode: error.statusCode,
      userAgent: req.get('user-agent'),
      ip: req.ip,
      path: req.originalUrl,
      method: req.method
    },
    user: req.user ? {
      id: req.user.id,
      email: req.user.email
    } : null,
    timestamp: new Date().toISOString()
  };

  logger.warn('Firebase security event', securityEvent);
}

// エラーの重要度判定
function determineSeverity(error) {
  if (error.statusCode >= 500) return 'HIGH';
  if (error.statusCode === 401 || error.statusCode === 403) return 'MEDIUM';
  return 'LOW';
}

// エラーレスポンスの作成
function createErrorResponse(error, traceId) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const response = {
    error: {
      message: error.message,
      code: error.code,
      traceId,
      timestamp: new Date().toISOString()
    }
  };

  // 開発環境では詳細情報を含める
  if (isDevelopment) {
    response.error.details = error.details;
    response.error.originalCode = error.originalCode;
  }

  return response;
}

// Firebase統合での成功ログ
function logFirebaseSuccess(operation, data, req) {
  const logData = {
    operation,
    success: true,
    data: sanitizeLogData(data),
    user: req.user ? {
      id: req.user.id,
      email: req.user.email
    } : null,
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip
    },
    timestamp: new Date().toISOString()
  };

  logger.info(`Firebase ${operation} successful`, logData);
}

// ログデータのサニタイズ
function sanitizeLogData(data) {
  if (!data || typeof data !== 'object') return data;
  
  const sanitized = { ...data };
  
  // センシティブなフィールドを除去
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'privateKey'];
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });
  
  return sanitized;
}

// パフォーマンス監視
function logPerformanceMetrics(operation, startTime, additionalData = {}) {
  const duration = Date.now() - startTime;
  
  logger.info('Firebase operation performance', {
    operation,
    duration,
    ...additionalData,
    timestamp: new Date().toISOString()
  });
  
  // 遅い操作の警告
  if (duration > 5000) { // 5秒以上
    logger.warn('Slow Firebase operation detected', {
      operation,
      duration,
      threshold: 5000
    });
  }
}

module.exports = {
  FirebaseError,
  FIREBASE_ERROR_CODES,
  firebaseErrorHandler,
  logFirebaseSuccess,
  logPerformanceMetrics,
  sanitizeErrorMessage,
  sanitizeLogData
};