const { structuredLogger } = require('./logger');

/**
 * パフォーマンス監視クラス
 */
class PerformanceLogger {
  constructor() {
    this.metrics = new Map();
    this.thresholds = {
      slow: 1000,      // 1秒
      critical: 5000   // 5秒
    };
  }

  /**
   * パフォーマンス計測開始
   */
  start(operation, context = {}) {
    const startTime = process.hrtime.bigint();
    const key = `${operation}_${Date.now()}_${Math.random()}`;
    
    this.metrics.set(key, {
      operation,
      startTime,
      context
    });
    
    return key;
  }

  /**
   * パフォーマンス計測終了
   */
  end(key, additionalContext = {}) {
    const metric = this.metrics.get(key);
    if (!metric) return;

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - metric.startTime) / 1_000_000; // ナノ秒をミリ秒に変換

    const logData = {
      operation: metric.operation,
      duration,
      slow: duration > this.thresholds.slow,
      critical: duration > this.thresholds.critical,
      ...metric.context,
      ...additionalContext
    };

    structuredLogger.logPerformance(metric.operation, duration, logData);
    this.metrics.delete(key);

    return duration;
  }

  /**
   * データベースクエリ監視
   */
  wrapDatabaseQuery(queryFn, queryName, context = {}) {
    return async (...args) => {
      const key = this.start(`db_query_${queryName}`, {
        queryType: 'database',
        queryName,
        ...context
      });

      try {
        const result = await queryFn(...args);
        const duration = this.end(key, {
          success: true,
          recordCount: Array.isArray(result) ? result.length : (result?.count || 1)
        });

        return result;
      } catch (error) {
        this.end(key, {
          success: false,
          error: error.message
        });
        throw error;
      }
    };
  }

  /**
   * 外部API呼び出し監視
   */
  wrapExternalApiCall(apiFn, apiName, context = {}) {
    return async (...args) => {
      const key = this.start(`external_api_${apiName}`, {
        apiType: 'external',
        apiName,
        ...context
      });

      try {
        const result = await apiFn(...args);
        const duration = this.end(key, {
          success: true,
          statusCode: result?.status || result?.statusCode
        });

        return result;
      } catch (error) {
        this.end(key, {
          success: false,
          error: error.message,
          statusCode: error?.response?.status
        });
        throw error;
      }
    };
  }

  /**
   * Express ミドルウェア
   */
  middleware() {
    return (req, res, next) => {
      const key = this.start(`http_${req.method}_${req.route?.path || req.path}`, {
        method: req.method,
        path: req.originalUrl,
        userId: req.user?.id
      });

      const originalSend = res.send;
      res.send = function(data) {
        res.send = originalSend;
        
        performanceLogger.end(key, {
          statusCode: res.statusCode,
          contentLength: res.get('content-length')
        });
        
        return originalSend.apply(res, arguments);
      };

      next();
    };
  }

  /**
   * メモリ使用量監視
   */
  logMemoryUsage(operation = 'memory_check') {
    const memoryUsage = process.memoryUsage();
    const formatBytes = (bytes) => Math.round(bytes / 1024 / 1024 * 100) / 100;

    structuredLogger.log('verbose', 'Memory Usage', {
      operation,
      rss: `${formatBytes(memoryUsage.rss)}MB`,
      heapTotal: `${formatBytes(memoryUsage.heapTotal)}MB`,
      heapUsed: `${formatBytes(memoryUsage.heapUsed)}MB`,
      external: `${formatBytes(memoryUsage.external)}MB`,
      arrayBuffers: `${formatBytes(memoryUsage.arrayBuffers)}MB`
    });

    // メモリ使用量が高い場合は警告
    if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
      structuredLogger.log('warn', 'High Memory Usage Detected', {
        heapUsed: `${formatBytes(memoryUsage.heapUsed)}MB`,
        heapTotal: `${formatBytes(memoryUsage.heapTotal)}MB`
      });
    }
  }

  /**
   * CPU使用率監視
   */
  logCpuUsage() {
    const usage = process.cpuUsage();
    const formatMicroseconds = (microseconds) => Math.round(microseconds / 1000);

    structuredLogger.log('verbose', 'CPU Usage', {
      user: `${formatMicroseconds(usage.user)}ms`,
      system: `${formatMicroseconds(usage.system)}ms`
    });
  }

  /**
   * システムヘルスチェック
   */
  async healthCheck() {
    const startTime = Date.now();
    
    try {
      // メモリ使用量チェック
      this.logMemoryUsage('health_check');
      this.logCpuUsage();

      // アップタイム
      const uptime = process.uptime();
      
      const health = {
        status: 'healthy',
        uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      };

      const checkDuration = Date.now() - startTime;
      structuredLogger.logPerformance('health_check', checkDuration, health);

      return health;
    } catch (error) {
      structuredLogger.logError(error, null, { operation: 'health_check' });
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * パフォーマンス統計取得
   */
  getPerformanceStats() {
    return {
      activeMetrics: this.metrics.size,
      thresholds: this.thresholds,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      uptime: process.uptime()
    };
  }

  /**
   * クリーンアップ
   */
  cleanup() {
    this.metrics.clear();
  }
}

// シングルトンインスタンス
const performanceLogger = new PerformanceLogger();

/**
 * デコレータ関数：パフォーマンス監視
 */
const withPerformanceLogging = (operationName) => {
  return (target, propertyName, descriptor) => {
    const method = descriptor.value;

    descriptor.value = async function(...args) {
      const key = performanceLogger.start(operationName, {
        className: target.constructor.name,
        methodName: propertyName
      });

      try {
        const result = await method.apply(this, args);
        performanceLogger.end(key, { success: true });
        return result;
      } catch (error) {
        performanceLogger.end(key, { success: false, error: error.message });
        throw error;
      }
    };

    return descriptor;
  };
};

/**
 * 高階関数：関数のパフォーマンス監視
 */
const withPerformanceTracking = (fn, operationName) => {
  return async (...args) => {
    const key = performanceLogger.start(operationName);
    
    try {
      const result = await fn(...args);
      performanceLogger.end(key, { success: true });
      return result;
    } catch (error) {
      performanceLogger.end(key, { success: false, error: error.message });
      throw error;
    }
  };
};

module.exports = {
  performanceLogger,
  withPerformanceLogging,
  withPerformanceTracking
};