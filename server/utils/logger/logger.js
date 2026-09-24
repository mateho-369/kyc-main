const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

/**
 * ログレベル定義
 */
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6
};

/**
 * ログカラー定義
 */
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'gray'
};

winston.addColors(logColors);

/**
 * ログフォーマット
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

/**
 * コンソール用フォーマット（開発環境）
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length) {
      msg += ` ${JSON.stringify(meta, null, 2)}`;
    }
    return msg;
  })
);

/**
 * ログディレクトリ
 */
const logDir = process.env.LOG_DIR || path.join(__dirname, '../../../logs');

/**
 * トランスポート設定
 */
const transports = [];

// コンソール出力（開発環境）
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.LOG_LEVEL || 'debug'
    })
  );
}

// エラーログファイル
transports.push(
  new DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '20m',
    maxFiles: '30d',
    format: logFormat
  })
);

// 統合ログファイル
transports.push(
  new DailyRotateFile({
    filename: path.join(logDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    format: logFormat
  })
);

// HTTPアクセスログ
transports.push(
  new DailyRotateFile({
    filename: path.join(logDir, 'http-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'http',
    maxSize: '20m',
    maxFiles: '7d',
    format: logFormat
  })
);

/**
 * ロガーインスタンス作成
 */
const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || 'info',
  transports,
  exitOnError: false
});

/**
 * 構造化ログユーティリティ
 */
class StructuredLogger {
  constructor(baseLogger) {
    this.logger = baseLogger;
  }

  /**
   * APIリクエストログ
   */
  logApiRequest(req, additionalData = {}) {
    this.logger.http('API Request', {
      type: 'api_request',
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
      headers: this.sanitizeHeaders(req.headers),
      query: req.query,
      body: this.sanitizeBody(req.body),
      ...additionalData
    });
  }

  /**
   * APIレスポンスログ
   */
  logApiResponse(req, res, responseTime, additionalData = {}) {
    const level = res.statusCode >= 400 ? 'warn' : 'http';
    
    this.logger[level]('API Response', {
      type: 'api_response',
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userId: req.user?.id,
      ...additionalData
    });
  }

  /**
   * エラーログ
   */
  logError(error, req = null, additionalData = {}) {
    const errorData = {
      type: 'error',
      errorType: error.constructor.name,
      message: error.message,
      stack: error.stack,
      statusCode: error.statusCode,
      errorCode: error.errorCode,
      details: error.details,
      ...additionalData
    };

    if (req) {
      errorData.request = {
        method: req.method,
        url: req.originalUrl,
        userId: req.user?.id,
        ip: req.ip
      };
    }

    this.logger.error('Application Error', errorData);
  }

  /**
   * 監査ログ
   */
  logAudit(action, userId, resource, details = {}) {
    this.logger.info('Audit Log', {
      type: 'audit',
      action,
      userId,
      resource,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  /**
   * パフォーマンスログ
   */
  logPerformance(operation, duration, metadata = {}) {
    const level = duration > 1000 ? 'warn' : 'verbose';
    
    this.logger[level]('Performance Log', {
      type: 'performance',
      operation,
      duration: `${duration}ms`,
      slow: duration > 1000,
      ...metadata
    });
  }

  /**
   * 統合ログ
   */
  logIntegration(integration, action, status, details = {}) {
    const level = status === 'error' ? 'error' : 'info';
    
    this.logger[level]('Integration Log', {
      type: 'integration',
      integration,
      action,
      status,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  /**
   * セキュリティイベントログ
   */
  logSecurity(event, severity, details = {}) {
    const levelMap = {
      critical: 'error',
      high: 'warn',
      medium: 'info',
      low: 'verbose'
    };
    
    const level = levelMap[severity] || 'warn';
    
    this.logger[level]('Security Event', {
      type: 'security',
      event,
      severity,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  /**
   * ヘッダーのサニタイズ
   */
  sanitizeHeaders(headers) {
    const sensitiveHeaders = ['authorization', 'firebase-token', 'x-api-key', 'cookie'];
    const sanitized = { ...headers };
    
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  /**
   * ボディのサニタイズ
   */
  sanitizeBody(body) {
    if (!body) return body;
    
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'creditCard'];
    const sanitized = { ...body };
    
    const sanitizeObject = (obj) => {
      for (const key in obj) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitizeObject(obj[key]);
        }
      }
    };
    
    sanitizeObject(sanitized);
    return sanitized;
  }

  /**
   * カスタムログ
   */
  log(level, message, metadata = {}) {
    this.logger[level](message, {
      timestamp: new Date().toISOString(),
      ...metadata
    });
  }
}

// 構造化ロガーインスタンス
const structuredLogger = new StructuredLogger(logger);

/**
 * Expressミドルウェア
 */
const expressLogger = (req, res, next) => {
  const startTime = Date.now();

  // リクエストログ
  structuredLogger.logApiRequest(req);

  // レスポンス完了時の処理
  const originalSend = res.send;
  res.send = function(data) {
    res.send = originalSend;
    
    const responseTime = Date.now() - startTime;
    structuredLogger.logApiResponse(req, res, responseTime);
    
    return originalSend.apply(res, arguments);
  };

  next();
};

/**
 * エラーログミドルウェア
 */
const errorLogger = (err, req, res, next) => {
  structuredLogger.logError(err, req);
  next(err);
};

module.exports = {
  logger,
  structuredLogger,
  expressLogger,
  errorLogger,
  logLevels,
  logColors
};