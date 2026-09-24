const winston = require('winston');
const path = require('path');
const fs = require('fs');
const DailyRotateFile = require('winston-daily-rotate-file');

// ログディレクトリの作成
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// エラーレベル定義
const errorLevels = {
  levels: {
    fatal: 0,
    alert: 1,
    critical: 2,
    error: 3,
    warning: 4,
    notice: 5,
    info: 6,
    debug: 7
  },
  colors: {
    fatal: 'red bold',
    alert: 'red',
    critical: 'magenta',
    error: 'red',
    warning: 'yellow',
    notice: 'cyan',
    info: 'green',
    debug: 'gray'
  }
};

// エラー分類
const ErrorCategories = {
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  DATABASE: 'database',
  VALIDATION: 'validation',
  EXTERNAL_API: 'external_api',
  FILE_SYSTEM: 'file_system',
  NETWORK: 'network',
  CONFIGURATION: 'configuration',
  BUSINESS_LOGIC: 'business_logic',
  WEBHOOK: 'webhook',
  KYC: 'kyc',
  INTEGRATION: 'integration',
  UNKNOWN: 'unknown'
};

// エラータグ
const ErrorTags = {
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  DATA_INTEGRITY: 'data_integrity',
  USER_ACTION: 'user_action',
  SYSTEM: 'system',
  THIRD_PARTY: 'third_party',
  RETRY_ABLE: 'retry_able',
  CRITICAL_PATH: 'critical_path'
};

// カスタムフォーマット
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, category, tags, metadata, stack, ...rest }) => {
    let logMessage = `${timestamp} [${level.toUpperCase()}]`;
    
    if (category) {
      logMessage += ` [${category}]`;
    }
    
    if (tags && tags.length > 0) {
      logMessage += ` [${tags.join(',')}]`;
    }
    
    logMessage += ` ${message}`;
    
    if (metadata) {
      logMessage += ` | ${JSON.stringify(metadata)}`;
    }
    
    if (stack) {
      logMessage += `\n${stack}`;
    }
    
    if (Object.keys(rest).length > 0) {
      logMessage += ` | ${JSON.stringify(rest)}`;
    }
    
    return logMessage;
  })
);

// Winston Logger作成
const logger = winston.createLogger({
  levels: errorLevels.levels,
  format: customFormat,
  transports: [
    // コンソール出力
    new winston.transports.Console({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        customFormat
      )
    }),
    
    // エラーログファイル
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10
    }),
    
    // 全ログファイル
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 20
    }),
    
    // 日次ローテーションファイル
    new DailyRotateFile({
      filename: path.join(logDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '100m',
      maxFiles: '30d'
    })
  ],
  
  // 例外ハンドリング
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'exceptions.log')
    })
  ],
  
  // 拒否されたPromiseハンドリング
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'rejections.log')
    })
  ]
});

// エラー分類関数
function classifyError(error) {
  const errorMessage = error.message || '';
  const errorCode = error.code || '';
  const errorName = error.name || '';
  
  // 認証エラー
  if (errorCode === 'UNAUTHORIZED' || errorMessage.includes('authentication') || errorName === 'AuthenticationError') {
    return ErrorCategories.AUTHENTICATION;
  }
  
  // 認可エラー
  if (errorCode === 'FORBIDDEN' || errorMessage.includes('permission') || errorMessage.includes('authorization')) {
    return ErrorCategories.AUTHORIZATION;
  }
  
  // データベースエラー
  if (errorName.includes('Sequelize') || errorMessage.includes('database') || errorCode.startsWith('ER_')) {
    return ErrorCategories.DATABASE;
  }
  
  // バリデーションエラー
  if (errorName === 'ValidationError' || errorMessage.includes('validation') || errorCode === 'INVALID_INPUT') {
    return ErrorCategories.VALIDATION;
  }
  
  // 外部APIエラー
  if (errorMessage.includes('API') || errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT') {
    return ErrorCategories.EXTERNAL_API;
  }
  
  // ファイルシステムエラー
  if (errorCode === 'ENOENT' || errorCode === 'EACCES' || errorMessage.includes('file')) {
    return ErrorCategories.FILE_SYSTEM;
  }
  
  // ネットワークエラー
  if (errorCode.startsWith('E') && errorCode.includes('CONN')) {
    return ErrorCategories.NETWORK;
  }
  
  // Webhookエラー
  if (errorMessage.includes('webhook') || errorMessage.includes('signature')) {
    return ErrorCategories.WEBHOOK;
  }
  
  // KYCエラー
  if (errorMessage.includes('KYC') || errorMessage.includes('verification')) {
    return ErrorCategories.KYC;
  }
  
  return ErrorCategories.UNKNOWN;
}

// エラータグ付け関数
function tagError(error, category) {
  const tags = [];
  const errorMessage = error.message || '';
  const statusCode = error.statusCode || error.status;
  
  // セキュリティ関連
  if (category === ErrorCategories.AUTHENTICATION || 
      category === ErrorCategories.AUTHORIZATION ||
      errorMessage.includes('security') ||
      errorMessage.includes('unauthorized')) {
    tags.push(ErrorTags.SECURITY);
  }
  
  // パフォーマンス関連
  if (error.code === 'ETIMEDOUT' || 
      error.code === 'ESOCKETTIMEDOUT' ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('slow')) {
    tags.push(ErrorTags.PERFORMANCE);
  }
  
  // データ整合性
  if (category === ErrorCategories.DATABASE ||
      errorMessage.includes('constraint') ||
      errorMessage.includes('integrity')) {
    tags.push(ErrorTags.DATA_INTEGRITY);
  }
  
  // ユーザーアクション
  if (statusCode >= 400 && statusCode < 500) {
    tags.push(ErrorTags.USER_ACTION);
  }
  
  // システムエラー
  if (statusCode >= 500 || category === ErrorCategories.CONFIGURATION) {
    tags.push(ErrorTags.SYSTEM);
  }
  
  // サードパーティ
  if (category === ErrorCategories.EXTERNAL_API || 
      category === ErrorCategories.WEBHOOK ||
      errorMessage.includes('third-party')) {
    tags.push(ErrorTags.THIRD_PARTY);
  }
  
  // リトライ可能
  if (error.retryable || 
      errorCode === 'ECONNREFUSED' ||
      errorCode === 'ETIMEDOUT' ||
      statusCode === 503) {
    tags.push(ErrorTags.RETRY_ABLE);
  }
  
  // クリティカルパス
  if (category === ErrorCategories.KYC ||
      errorMessage.includes('payment') ||
      errorMessage.includes('critical')) {
    tags.push(ErrorTags.CRITICAL_PATH);
  }
  
  return tags;
}

// アラートマネージャー
class AlertManager {
  constructor() {
    this.alertThresholds = {
      [ErrorCategories.AUTHENTICATION]: { count: 10, timeWindow: 300000 }, // 5分間に10回
      [ErrorCategories.DATABASE]: { count: 5, timeWindow: 60000 }, // 1分間に5回
      [ErrorCategories.EXTERNAL_API]: { count: 20, timeWindow: 300000 }, // 5分間に20回
      [ErrorCategories.KYC]: { count: 3, timeWindow: 60000 }, // 1分間に3回
      [ErrorTags.CRITICAL_PATH]: { count: 1, timeWindow: 0 } // 即座にアラート
    };
    
    this.errorCounts = new Map();
    this.alertHandlers = new Map();
    
    // デフォルトアラートハンドラー
    this.registerAlertHandler('console', this.consoleAlert);
    this.registerAlertHandler('webhook', this.webhookAlert);
  }
  
  // エラーをトラック
  trackError(category, tags, error) {
    const now = Date.now();
    
    // カテゴリーベースのトラッキング
    this.trackByKey(category, now);
    
    // タグベースのトラッキング
    tags.forEach(tag => {
      this.trackByKey(tag, now);
    });
    
    // アラートチェック
    this.checkAlerts(category, tags, error);
  }
  
  trackByKey(key, timestamp) {
    if (!this.errorCounts.has(key)) {
      this.errorCounts.set(key, []);
    }
    
    const errors = this.errorCounts.get(key);
    errors.push(timestamp);
    
    // 古いエラーをクリーンアップ
    const threshold = this.alertThresholds[key];
    if (threshold) {
      const cutoff = timestamp - threshold.timeWindow;
      this.errorCounts.set(key, errors.filter(t => t > cutoff));
    }
  }
  
  checkAlerts(category, tags, error) {
    // カテゴリーアラートチェック
    this.checkAlertForKey(category, error);
    
    // タグアラートチェック
    tags.forEach(tag => {
      this.checkAlertForKey(tag, error);
    });
  }
  
  checkAlertForKey(key, error) {
    const threshold = this.alertThresholds[key];
    if (!threshold) return;
    
    const errors = this.errorCounts.get(key) || [];
    
    if (threshold.timeWindow === 0 || errors.length >= threshold.count) {
      this.triggerAlert(key, error, errors.length);
      
      // アラート後にカウントをリセット
      this.errorCounts.set(key, []);
    }
  }
  
  triggerAlert(key, error, count) {
    const alertData = {
      key,
      error: {
        message: error.message,
        stack: error.stack,
        category: error.category,
        tags: error.tags
      },
      count,
      timestamp: new Date(),
      environment: process.env.NODE_ENV || 'development'
    };
    
    // 全アラートハンドラーを実行
    this.alertHandlers.forEach((handler, name) => {
      try {
        handler(alertData);
      } catch (err) {
        console.error(`Alert handler ${name} failed:`, err);
      }
    });
  }
  
  registerAlertHandler(name, handler) {
    this.alertHandlers.set(name, handler);
  }
  
  // コンソールアラート
  consoleAlert(alertData) {
    console.error('\n🚨 ALERT 🚨');
    console.error(`Category/Tag: ${alertData.key}`);
    console.error(`Error Count: ${alertData.count}`);
    console.error(`Environment: ${alertData.environment}`);
    console.error(`Error: ${alertData.error.message}`);
    console.error('-------------------\n');
  }
  
  // Webhookアラート
  async webhookAlert(alertData) {
    if (!process.env.ALERT_WEBHOOK_URL) return;
    
    try {
      const axios = require('axios');
      await axios.post(process.env.ALERT_WEBHOOK_URL, {
        type: 'error_alert',
        severity: alertData.key === ErrorTags.CRITICAL_PATH ? 'critical' : 'high',
        data: alertData
      });
    } catch (err) {
      console.error('Failed to send webhook alert:', err);
    }
  }
}

// アラートマネージャーインスタンス
const alertManager = new AlertManager();

// エラーロギングクラス
class ErrorLogger {
  constructor() {
    this.logger = logger;
    this.alertManager = alertManager;
  }
  
  // エラーログ記録
  logError(error, context = {}) {
    // エラー分類
    const category = classifyError(error);
    const tags = tagError(error, category);
    
    // メタデータ構築
    const metadata = {
      ...context,
      errorCode: error.code,
      errorName: error.name,
      statusCode: error.statusCode || error.status,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version
    };
    
    // スタックトレース処理
    if (error.stack) {
      metadata.stackTrace = error.stack.split('\n').slice(0, 10); // 最初の10行
    }
    
    // リクエスト情報があれば追加
    if (context.req) {
      metadata.request = {
        method: context.req.method,
        url: context.req.url,
        ip: context.req.ip,
        userAgent: context.req.get('user-agent'),
        userId: context.req.user?.id
      };
    }
    
    // エラーレベル決定
    const level = this.determineLogLevel(error, category, tags);
    
    // ログ記録
    this.logger.log({
      level,
      message: error.message || 'Unknown error',
      category,
      tags,
      metadata,
      stack: error.stack
    });
    
    // アラートトラッキング
    this.alertManager.trackError(category, tags, error);
    
    return { category, tags, level };
  }
  
  // ログレベル決定
  determineLogLevel(error, category, tags) {
    // クリティカルパスエラー
    if (tags.includes(ErrorTags.CRITICAL_PATH)) {
      return 'critical';
    }
    
    // セキュリティエラー
    if (tags.includes(ErrorTags.SECURITY)) {
      return 'alert';
    }
    
    // データ整合性エラー
    if (tags.includes(ErrorTags.DATA_INTEGRITY)) {
      return 'critical';
    }
    
    // システムエラー
    if (tags.includes(ErrorTags.SYSTEM)) {
      return 'error';
    }
    
    // ユーザーアクションエラー
    if (tags.includes(ErrorTags.USER_ACTION)) {
      return 'warning';
    }
    
    // デフォルト
    return 'error';
  }
  
  // 便利メソッド
  fatal(message, metadata = {}) {
    this.logger.fatal(message, metadata);
  }
  
  alert(message, metadata = {}) {
    this.logger.alert(message, metadata);
  }
  
  critical(message, metadata = {}) {
    this.logger.critical(message, metadata);
  }
  
  error(message, metadata = {}) {
    this.logger.error(message, metadata);
  }
  
  warning(message, metadata = {}) {
    this.logger.warning(message, metadata);
  }
  
  info(message, metadata = {}) {
    this.logger.info(message, metadata);
  }
  
  debug(message, metadata = {}) {
    this.logger.debug(message, metadata);
  }
  
  // Expressエラーハンドラー
  expressErrorHandler() {
    return (err, req, res, next) => {
      const { category, tags, level } = this.logError(err, { req });
      
      // クライアントレスポンス
      const statusCode = err.statusCode || err.status || 500;
      const message = process.env.NODE_ENV === 'production' && statusCode === 500
        ? 'Internal Server Error'
        : err.message;
      
      res.status(statusCode).json({
        error: {
          message,
          category: process.env.NODE_ENV !== 'production' ? category : undefined,
          tags: process.env.NODE_ENV !== 'production' ? tags : undefined,
          requestId: req.id
        }
      });
    };
  }
  
  // アラート設定更新
  updateAlertThreshold(key, count, timeWindow) {
    this.alertManager.alertThresholds[key] = { count, timeWindow };
  }
  
  // カスタムアラートハンドラー登録
  registerAlertHandler(name, handler) {
    this.alertManager.registerAlertHandler(name, handler);
  }
  
  // エラー統計取得
  getErrorStats(timeRange = 3600000) { // デフォルト1時間
    const now = Date.now();
    const stats = {};
    
    this.alertManager.errorCounts.forEach((timestamps, key) => {
      const recentErrors = timestamps.filter(t => t > now - timeRange);
      if (recentErrors.length > 0) {
        stats[key] = recentErrors.length;
      }
    });
    
    return stats;
  }
}

// シングルトンインスタンス
const errorLogger = new ErrorLogger();

// エクスポート
module.exports = {
  errorLogger,
  ErrorCategories,
  ErrorTags,
  logError: errorLogger.logError.bind(errorLogger),
  expressErrorHandler: errorLogger.expressErrorHandler.bind(errorLogger),
  updateAlertThreshold: errorLogger.updateAlertThreshold.bind(errorLogger),
  registerAlertHandler: errorLogger.registerAlertHandler.bind(errorLogger),
  getErrorStats: errorLogger.getErrorStats.bind(errorLogger),
  
  // 便利メソッド
  fatal: errorLogger.fatal.bind(errorLogger),
  alert: errorLogger.alert.bind(errorLogger),
  critical: errorLogger.critical.bind(errorLogger),
  error: errorLogger.error.bind(errorLogger),
  warning: errorLogger.warning.bind(errorLogger),
  info: errorLogger.info.bind(errorLogger),
  debug: errorLogger.debug.bind(errorLogger)
};