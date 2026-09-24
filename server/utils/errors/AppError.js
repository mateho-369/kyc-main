/**
 * カスタムエラー基底クラス
 */
class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR', details = {}) {
    super(message);
    
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.errorCode,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details,
        timestamp: this.timestamp,
        ...(process.env.NODE_ENV === 'development' && { stack: this.stack })
      }
    };
  }
}

/**
 * 認証エラー
 */
class AuthenticationError extends AppError {
  constructor(message = '認証が必要です', details = {}) {
    super(message, 401, 'AUTHENTICATION_ERROR', details);
  }
}

/**
 * 認可エラー
 */
class AuthorizationError extends AppError {
  constructor(message = 'アクセス権限がありません', details = {}) {
    super(message, 403, 'AUTHORIZATION_ERROR', details);
  }
}

/**
 * 検証エラー
 */
class ValidationError extends AppError {
  constructor(message = '入力データが無効です', errors = []) {
    super(message, 400, 'VALIDATION_ERROR', { errors });
  }
}

/**
 * リソースが見つからないエラー
 */
class NotFoundError extends AppError {
  constructor(resource = 'リソース', id = '') {
    const message = id ? `${resource} (ID: ${id}) が見つかりません` : `${resource}が見つかりません`;
    super(message, 404, 'NOT_FOUND', { resource, id });
  }
}

/**
 * 競合エラー
 */
class ConflictError extends AppError {
  constructor(message = 'リソースの競合が発生しました', details = {}) {
    super(message, 409, 'CONFLICT_ERROR', details);
  }
}

/**
 * レート制限エラー
 */
class RateLimitError extends AppError {
  constructor(retryAfter = 60, details = {}) {
    super('リクエスト数が制限を超えました', 429, 'RATE_LIMIT_EXCEEDED', {
      retryAfter,
      ...details
    });
    this.headers = {
      'Retry-After': retryAfter,
      'X-RateLimit-Limit': details.limit || 100,
      'X-RateLimit-Remaining': details.remaining || 0,
      'X-RateLimit-Reset': details.reset || new Date(Date.now() + retryAfter * 1000).toISOString()
    };
  }
}

/**
 * 外部サービスエラー
 */
class ExternalServiceError extends AppError {
  constructor(service, originalError, details = {}) {
    super(`外部サービスエラー: ${service}`, 503, 'EXTERNAL_SERVICE_ERROR', {
      service,
      originalError: originalError.message,
      ...details
    });
  }
}

/**
 * ファイルアップロードエラー
 */
class FileUploadError extends AppError {
  constructor(message = 'ファイルアップロードに失敗しました', details = {}) {
    super(message, 400, 'FILE_UPLOAD_ERROR', details);
  }
}

/**
 * データベースエラー
 */
class DatabaseError extends AppError {
  constructor(message = 'データベースエラーが発生しました', details = {}) {
    super(message, 500, 'DATABASE_ERROR', details);
    this.isOperational = false; // システムエラーとして扱う
  }
}

/**
 * ビジネスロジックエラー
 */
class BusinessLogicError extends AppError {
  constructor(message, errorCode = 'BUSINESS_LOGIC_ERROR', details = {}) {
    super(message, 422, errorCode, details);
  }
}

/**
 * Firebase関連エラー
 */
class FirebaseError extends AppError {
  constructor(message = 'Firebase認証エラー', firebaseError = null) {
    const errorCode = firebaseError?.code || 'FIREBASE_ERROR';
    const statusCode = firebaseError?.code === 'auth/id-token-expired' ? 401 : 500;
    
    super(message, statusCode, errorCode, {
      firebaseCode: firebaseError?.code,
      firebaseMessage: firebaseError?.message
    });
  }
}

/**
 * 統合エラー
 */
class IntegrationError extends AppError {
  constructor(integration, message, details = {}) {
    super(`統合エラー (${integration}): ${message}`, 500, 'INTEGRATION_ERROR', {
      integration,
      ...details
    });
  }
}

/**
 * メンテナンスエラー
 */
class MaintenanceError extends AppError {
  constructor(estimatedTime = null) {
    super('システムメンテナンス中です', 503, 'MAINTENANCE_MODE', {
      estimatedTime,
      retryAfter: 300 // 5分後に再試行
    });
  }
}

module.exports = {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
  FileUploadError,
  DatabaseError,
  BusinessLogicError,
  FirebaseError,
  IntegrationError,
  MaintenanceError
};