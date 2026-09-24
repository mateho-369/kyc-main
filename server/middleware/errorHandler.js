const { AppError } = require('../utils/errors/AppError');
const { structuredLogger } = require('../utils/logger/logger');

/**
 * Sharegramエラーコード定義
 */
const SHAREGRAM_ERROR_CODES = {
  // 認証・認可関連 (SHARE001-SHARE099)
  SHARE001: { message: 'APIキーが無効です', statusCode: 401 },
  SHARE002: { message: 'APIキーの有効期限が切れています', statusCode: 401 },
  SHARE003: { message: '署名が無効です', statusCode: 401 },
  SHARE004: { message: 'タイムスタンプが無効です', statusCode: 401 },
  SHARE005: { message: '必須ヘッダーが不足しています', statusCode: 400 },
  SHARE006: { message: 'APIクライアントが無効です', statusCode: 401 },
  SHARE007: { message: 'アクセス権限がありません', statusCode: 403 },
  SHARE008: { message: 'レート制限を超えました', statusCode: 429 },
  SHARE009: { message: '統合設定が無効です', statusCode: 401 },
  SHARE010: { message: 'セッションの有効期限が切れています', statusCode: 401 },
  
  // データ検証関連 (SHARE100-SHARE199)
  SHARE101: { message: 'リクエストデータが不正です', statusCode: 400 },
  SHARE102: { message: '必須フィールドが不足しています', statusCode: 400 },
  SHARE103: { message: 'データ形式が無効です', statusCode: 400 },
  SHARE104: { message: 'ファイルサイズが制限を超えています', statusCode: 400 },
  SHARE105: { message: '許可されていないファイル形式です', statusCode: 400 },
  SHARE106: { message: 'external_idが重複しています', statusCode: 409 },
  SHARE107: { message: 'データの整合性エラーです', statusCode: 422 },
  
  // パフォーマー関連 (SHARE200-SHARE299)
  SHARE201: { message: 'パフォーマーが見つかりません', statusCode: 404 },
  SHARE202: { message: 'パフォーマー情報が不完全です', statusCode: 422 },
  SHARE203: { message: 'KYC検証が未完了です', statusCode: 422 },
  SHARE204: { message: 'KYC検証の有効期限が切れています', statusCode: 422 },
  SHARE205: { message: 'ドキュメントが見つかりません', statusCode: 404 },
  SHARE206: { message: 'ドキュメントの検証に失敗しました', statusCode: 422 },
  SHARE207: { message: 'パフォーマーのステータスが無効です', statusCode: 422 },
  
  // 同期処理関連 (SHARE300-SHARE399)
  SHARE301: { message: '同期処理が失敗しました', statusCode: 500 },
  SHARE302: { message: '同期データが不正です', statusCode: 400 },
  SHARE303: { message: 'バッチ処理が部分的に失敗しました', statusCode: 207 },
  SHARE304: { message: '同期がタイムアウトしました', statusCode: 504 },
  SHARE305: { message: '同期レート制限に達しました', statusCode: 429 },
  
  // Webhook関連 (SHARE400-SHARE499)
  SHARE401: { message: 'Webhook配信に失敗しました', statusCode: 500 },
  SHARE402: { message: 'Webhook署名が無効です', statusCode: 401 },
  SHARE403: { message: 'Webhookエンドポイントが無効です', statusCode: 400 },
  SHARE404: { message: 'Webhookイベントタイプが無効です', statusCode: 400 },
  SHARE405: { message: 'Webhookペイロードが大きすぎます', statusCode: 413 },
  
  // キャッシュ関連 (SHARE500-SHARE599)
  SHARE501: { message: 'キャッシュエラーが発生しました', statusCode: 500 },
  SHARE502: { message: 'キャッシュが利用できません', statusCode: 503 },
  SHARE503: { message: 'キャッシュキーが無効です', statusCode: 400 },
  
  // 外部サービス関連 (SHARE600-SHARE699)
  SHARE601: { message: '外部APIの呼び出しに失敗しました', statusCode: 502 },
  SHARE602: { message: '外部サービスがタイムアウトしました', statusCode: 504 },
  SHARE603: { message: '外部サービスが利用できません', statusCode: 503 },
  
  // システムエラー (SHARE900-SHARE999)
  SHARE901: { message: 'データベースエラーが発生しました', statusCode: 500 },
  SHARE902: { message: 'ファイルシステムエラーが発生しました', statusCode: 500 },
  SHARE903: { message: 'メモリ不足エラーが発生しました', statusCode: 500 },
  SHARE904: { message: '設定エラーが発生しました', statusCode: 500 },
  SHARE999: { message: '予期しないエラーが発生しました', statusCode: 500 }
};

/**
 * Sharegramエラーコードからエラーを生成
 */
function createSharegramError(code, details = {}) {
  const errorDef = SHAREGRAM_ERROR_CODES[code];
  if (!errorDef) {
    return new AppError('Unknown error', 500, 'SHARE999', details);
  }
  return new AppError(errorDef.message, errorDef.statusCode, code, details);
}

/**
 * 統一エラーハンドラーミドルウェア
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Sharegramエラーコードの処理
  if (err.code && err.code.startsWith('SHARE')) {
    const sharegramError = createSharegramError(err.code, err.details || {});
    error = sharegramError;
  }

  // エラーログ記録
  structuredLogger.logError(error, req);

  // Sequelize検証エラー
  if (err.name === 'SequelizeValidationError') {
    const message = 'データ検証エラー';
    const errors = err.errors.map(e => ({
      field: e.path,
      message: e.message,
      value: e.value
    }));
    error = new AppError(message, 400, 'VALIDATION_ERROR', { errors });
  }

  // Sequelize一意制約エラー
  if (err.name === 'SequelizeUniqueConstraintError') {
    const message = '重複するデータが存在します';
    const fields = err.errors.map(e => e.path);
    error = new AppError(message, 409, 'DUPLICATE_ERROR', { fields });
  }

  // Sequelize外部キー制約エラー
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    const message = '関連するデータが存在しません';
    error = new AppError(message, 400, 'FOREIGN_KEY_ERROR', {
      table: err.table,
      field: err.fields
    });
  }

  // JWT エラー
  if (err.name === 'JsonWebTokenError') {
    const message = '無効なトークンです';
    error = new AppError(message, 401, 'INVALID_TOKEN');
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'トークンの有効期限が切れています';
    error = new AppError(message, 401, 'TOKEN_EXPIRED');
  }

  // Multer ファイルアップロードエラー
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'ファイルサイズが上限を超えています';
    error = new AppError(message, 400, 'FILE_TOO_LARGE', {
      limit: err.limit,
      field: err.field
    });
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    const message = 'ファイル数が上限を超えています';
    error = new AppError(message, 400, 'TOO_MANY_FILES', {
      limit: err.limit,
      field: err.field
    });
  }

  // Firebase エラー
  if (err.code && err.code.startsWith('auth/')) {
    const message = 'Firebase認証エラー';
    error = new AppError(message, 401, 'FIREBASE_AUTH_ERROR', {
      firebaseCode: err.code,
      firebaseMessage: err.message
    });
  }

  // 予期しないエラーの場合はAppErrorに変換
  if (!(error instanceof AppError)) {
    const message = process.env.NODE_ENV === 'production' 
      ? 'サーバーエラーが発生しました' 
      : err.message;
    error = new AppError(message, 500, 'INTERNAL_ERROR', {
      originalError: err.name,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  }

  // レート制限エラーの場合、ヘッダーを設定
  if (error instanceof AppError && error.headers) {
    Object.entries(error.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
  }

  // Sharegramエラーの場合は特別なフォーマット
  if (error.errorCode && error.errorCode.startsWith('SHARE')) {
    const response = {
      error: {
        code: error.errorCode,
        message: error.message,
        statusCode: error.statusCode,
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
        method: req.method,
        ...(error.details && { details: error.details })
      }
    };
    
    // 開発環境ではスタックトレースを含める
    if (process.env.NODE_ENV === 'development') {
      response.error.stack = error.stack;
    }
    
    return res.status(error.statusCode || 500).json(response);
  }

  // レスポンス送信
  res.status(error.statusCode || 500).json(error.toJSON());
};

/**
 * 404エラーハンドラー
 */
const notFoundHandler = (req, res, next) => {
  const error = new AppError(
    `エンドポイント ${req.originalUrl} が見つかりません`,
    404,
    'NOT_FOUND',
    {
      method: req.method,
      path: req.originalUrl
    }
  );
  next(error);
};

/**
 * 非同期エラーキャッチャー
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * グローバル例外ハンドラー
 */
const globalExceptionHandler = () => {
  // キャッチされていない例外
  process.on('uncaughtException', (err) => {
    console.error('キャッチされていない例外:', err);
    structuredLogger.logError(err, null, { type: 'uncaughtException' });
    
    // グレースフルシャットダウン
    process.exit(1);
  });

  // キャッチされていないPromise拒否
  process.on('unhandledRejection', (reason, promise) => {
    console.error('キャッチされていないPromise拒否:', reason);
    structuredLogger.logError(
      new Error(`Unhandled Promise Rejection: ${reason}`),
      null,
      { 
        type: 'unhandledRejection',
        promise: promise.toString()
      }
    );
  });
};

/**
 * 運用エラーと開発エラーの分類
 */
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    status: 'error',
    error: err,
    message: err.message,
    stack: err.stack
  });
};

const sendErrorProd = (err, res) => {
  // 運用エラー：信頼できるメッセージをクライアントに送信
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message
    });
  } else {
    // プログラミングエラー：詳細をログに記録し、一般的なメッセージを送信
    console.error('ERROR 💥', err);
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong!'
    });
  }
};

/**
 * エラー統計情報
 */
class ErrorStats {
  constructor() {
    this.stats = new Map();
    this.resetInterval = setInterval(() => {
      this.reset();
    }, 60 * 60 * 1000); // 1時間ごとにリセット
  }

  increment(errorCode) {
    const current = this.stats.get(errorCode) || 0;
    this.stats.set(errorCode, current + 1);
  }

  getStats() {
    return Object.fromEntries(this.stats);
  }

  reset() {
    this.stats.clear();
  }

  destroy() {
    if (this.resetInterval) {
      clearInterval(this.resetInterval);
    }
  }
}

const errorStats = new ErrorStats();

/**
 * エラー統計ミドルウェア
 */
const errorStatsMiddleware = (err, req, res, next) => {
  if (err instanceof AppError) {
    errorStats.increment(err.errorCode);
  } else {
    errorStats.increment('UNKNOWN_ERROR');
  }
  next(err);
};

/**
 * メンテナンスモードチェック
 */
const maintenanceCheck = (req, res, next) => {
  if (process.env.MAINTENANCE_MODE === 'true') {
    const error = new AppError(
      'システムメンテナンス中です',
      503,
      'MAINTENANCE_MODE',
      {
        estimatedTime: process.env.MAINTENANCE_ESTIMATED_TIME,
        retryAfter: 300
      }
    );
    return next(error);
  }
  next();
};

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  globalExceptionHandler,
  errorStatsMiddleware,
  errorStats,
  maintenanceCheck,
  sendErrorDev,
  sendErrorProd,
  SHAREGRAM_ERROR_CODES,
  createSharegramError
};