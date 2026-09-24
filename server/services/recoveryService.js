const logger = require('../utils/logger/logger');
const { auditLog } = require('../utils/logger/auditLogger');
const Redis = require('ioredis');
const { BatchJob, SharegramIntegration } = require('../models');
const EventEmitter = require('events');

// Redis接続（リカバリー状態管理用）
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  db: process.env.REDIS_RECOVERY_DB || 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

/**
 * リカバリーサービス - 自動リトライとフォールバック処理
 */
class RecoveryService extends EventEmitter {
  constructor() {
    super();
    this.retryQueues = new Map();
    this.circuitBreakers = new Map();
    this.fallbackHandlers = new Map();
    
    // デフォルト設定
    this.defaultConfig = {
      maxRetries: 5,
      initialDelay: 1000, // 1秒
      maxDelay: 60000, // 60秒
      backoffMultiplier: 2,
      jitterEnabled: true,
      timeoutMs: 30000, // 30秒
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 300000 // 5分
    };
  }

  /**
   * リトライ可能な操作を実行
   * @param {string} operationName - 操作名
   * @param {Function} operation - 実行する操作
   * @param {Object} options - リトライオプション
   */
  async executeWithRetry(operationName, operation, options = {}) {
    const config = { ...this.defaultConfig, ...options };
    const startTime = Date.now();
    
    // サーキットブレーカーチェック
    if (this.isCircuitOpen(operationName)) {
      logger.warn(`Circuit breaker is open for operation: ${operationName}`);
      return this.executeFallback(operationName, options.context);
    }

    let lastError;
    let attempt = 0;

    while (attempt < config.maxRetries) {
      attempt++;
      
      try {
        // タイムアウト処理
        const result = await this.withTimeout(
          operation(),
          config.timeoutMs,
          `Operation ${operationName} timed out after ${config.timeoutMs}ms`
        );

        // 成功時の処理
        this.recordSuccess(operationName);
        logger.info(`Operation ${operationName} succeeded on attempt ${attempt}`);
        
        return result;

      } catch (error) {
        lastError = error;
        logger.error(`Operation ${operationName} failed on attempt ${attempt}:`, error);
        
        // エラーをサーキットブレーカーに記録
        this.recordFailure(operationName);

        // リトライ可能なエラーかチェック
        if (!this.isRetryableError(error) || attempt >= config.maxRetries) {
          break;
        }

        // Exponential Backoff with Jitter
        const delay = this.calculateBackoff(attempt, config);
        logger.info(`Retrying ${operationName} after ${delay}ms (attempt ${attempt}/${config.maxRetries})`);
        
        // リトライ情報を保存
        await this.saveRetryInfo(operationName, {
          attempt,
          error: error.message,
          nextRetryAt: new Date(Date.now() + delay),
          context: options.context
        });

        await this.sleep(delay);
      }
    }

    // 全リトライ失敗
    logger.error(`All retry attempts failed for ${operationName}`, {
      attempts: attempt,
      duration: Date.now() - startTime,
      lastError: lastError.message
    });

    // フォールバック実行
    return this.executeFallback(operationName, options.context, lastError);
  }

  /**
   * Exponential Backoffの計算（Jitter付き）
   */
  calculateBackoff(attempt, config) {
    const exponentialDelay = Math.min(
      config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1),
      config.maxDelay
    );

    if (config.jitterEnabled) {
      // Full Jitter
      return Math.random() * exponentialDelay;
    }

    return exponentialDelay;
  }

  /**
   * リトライ可能なエラーかチェック
   */
  isRetryableError(error) {
    // ネットワークエラー
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }

    // HTTP 5xx エラー
    if (error.response && error.response.status >= 500) {
      return true;
    }

    // 一時的なエラー
    if (error.response && error.response.status === 429) { // Rate Limit
      return true;
    }

    // データベース接続エラー
    if (error.message && error.message.includes('SequelizeConnectionError')) {
      return true;
    }

    // Redis接続エラー
    if (error.message && error.message.includes('Redis connection')) {
      return true;
    }

    return false;
  }

  /**
   * サーキットブレーカー - エラー記録
   */
  recordFailure(operationName) {
    const breaker = this.getCircuitBreaker(operationName);
    breaker.failures++;
    breaker.lastFailureTime = Date.now();

    if (breaker.failures >= this.defaultConfig.circuitBreakerThreshold) {
      breaker.state = 'open';
      breaker.openedAt = Date.now();
      logger.warn(`Circuit breaker opened for ${operationName} after ${breaker.failures} failures`);
    }
  }

  /**
   * サーキットブレーカー - 成功記録
   */
  recordSuccess(operationName) {
    const breaker = this.getCircuitBreaker(operationName);
    breaker.failures = 0;
    breaker.state = 'closed';
  }

  /**
   * サーキットブレーカー状態取得
   */
  getCircuitBreaker(operationName) {
    if (!this.circuitBreakers.has(operationName)) {
      this.circuitBreakers.set(operationName, {
        state: 'closed',
        failures: 0,
        lastFailureTime: null,
        openedAt: null
      });
    }
    return this.circuitBreakers.get(operationName);
  }

  /**
   * サーキットが開いているかチェック
   */
  isCircuitOpen(operationName) {
    const breaker = this.getCircuitBreaker(operationName);
    
    if (breaker.state === 'open') {
      // タイムアウト経過チェック
      if (Date.now() - breaker.openedAt > this.defaultConfig.circuitBreakerTimeout) {
        breaker.state = 'half-open';
        logger.info(`Circuit breaker half-opened for ${operationName}`);
      }
    }

    return breaker.state === 'open';
  }

  /**
   * フォールバック処理実行
   */
  async executeFallback(operationName, context, error) {
    logger.info(`Executing fallback for ${operationName}`);

    // カスタムフォールバックハンドラーがある場合
    if (this.fallbackHandlers.has(operationName)) {
      const handler = this.fallbackHandlers.get(operationName);
      try {
        return await handler(context, error);
      } catch (fallbackError) {
        logger.error(`Fallback handler failed for ${operationName}:`, fallbackError);
      }
    }

    // デフォルトフォールバック処理
    return this.defaultFallback(operationName, context, error);
  }

  /**
   * デフォルトフォールバック処理
   */
  async defaultFallback(operationName, context, error) {
    // キャッシュからの読み取り試行
    const cacheKey = `fallback:${operationName}:${JSON.stringify(context)}`;
    const cachedResult = await redis.get(cacheKey);
    
    if (cachedResult) {
      logger.info(`Returning cached result for ${operationName}`);
      return JSON.parse(cachedResult);
    }

    // エラー情報を返す
    return {
      success: false,
      fallback: true,
      operationName,
      error: error ? error.message : 'Circuit breaker open',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * フォールバックハンドラー登録
   */
  registerFallback(operationName, handler) {
    this.fallbackHandlers.set(operationName, handler);
    logger.info(`Fallback handler registered for ${operationName}`);
  }

  /**
   * バッチリトライ処理
   */
  async processBatchRetries() {
    const retryPattern = 'retry:*';
    const keys = await redis.keys(retryPattern);

    for (const key of keys) {
      const retryInfo = await redis.get(key);
      if (!retryInfo) continue;

      const info = JSON.parse(retryInfo);
      const operationName = key.split(':')[1];

      // リトライ時刻チェック
      if (new Date(info.nextRetryAt) <= new Date()) {
        logger.info(`Processing batch retry for ${operationName}`);
        
        // リトライキューに追加
        this.emit('retry', {
          operationName,
          context: info.context,
          attempt: info.attempt
        });

        // リトライ情報削除
        await redis.del(key);
      }
    }
  }

  /**
   * 失敗したバッチジョブのリカバリー
   */
  async recoverFailedBatchJobs() {
    try {
      const failedJobs = await BatchJob.findAll({
        where: {
          status: 'failed',
          createdAt: {
            [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24時間以内
          }
        },
        order: [['createdAt', 'DESC']],
        limit: 10
      });

      for (const job of failedJobs) {
        logger.info(`Attempting to recover failed batch job: ${job.id}`);
        
        await this.executeWithRetry(
          `batch_job_${job.jobType}`,
          async () => {
            // ジョブタイプに応じた処理
            switch (job.jobType) {
              case 'performer_sync':
                return await this.recoverPerformerSync(job);
              case 'kyc_verification':
                return await this.recoverKYCVerification(job);
              default:
                logger.warn(`Unknown job type for recovery: ${job.jobType}`);
            }
          },
          {
            context: { jobId: job.id },
            maxRetries: 3
          }
        );
      }
    } catch (error) {
      logger.error('Batch job recovery failed:', error);
    }
  }

  /**
   * パフォーマー同期のリカバリー
   */
  async recoverPerformerSync(job) {
    const dataSync = require('./sync/dataSync');
    
    // ジョブ状態を更新
    await job.update({ 
      status: 'processing',
      error: null,
      retryCount: (job.retryCount || 0) + 1
    });

    const result = await dataSync.syncPerformers(job.parameters);
    
    await job.update({
      status: 'completed',
      completedAt: new Date(),
      result
    });

    return result;
  }

  /**
   * KYC検証のリカバリー
   */
  async recoverKYCVerification(job) {
    const kycService = require('./kyc/kycService');
    
    await job.update({ 
      status: 'processing',
      error: null,
      retryCount: (job.retryCount || 0) + 1
    });

    const result = await kycService.processVerification(job.parameters.kycRequestId);
    
    await job.update({
      status: 'completed',
      completedAt: new Date(),
      result
    });

    return result;
  }

  /**
   * 統合接続のヘルスチェックとリカバリー
   */
  async checkAndRecoverIntegrations() {
    try {
      const integrations = await SharegramIntegration.findAll({
        where: { isActive: true }
      });

      for (const integration of integrations) {
        const healthCheck = await this.executeWithRetry(
          `integration_health_${integration.id}`,
          async () => {
            const sharegramClient = require('./sharegram/sharegramClient');
            const client = await sharegramClient.createSharegramClient(integration.id);
            return await client.checkHealth();
          },
          {
            maxRetries: 3,
            initialDelay: 2000
          }
        );

        if (!healthCheck.success) {
          logger.warn(`Integration ${integration.id} is unhealthy, attempting recovery`);
          await this.recoverIntegration(integration);
        }
      }
    } catch (error) {
      logger.error('Integration health check failed:', error);
    }
  }

  /**
   * 統合接続のリカバリー
   */
  async recoverIntegration(integration) {
    // 設定の再検証
    if (!integration.isConfigValid()) {
      logger.error(`Integration ${integration.id} has invalid configuration`);
      await integration.update({ 
        isActive: false,
        lastError: 'Invalid configuration detected during recovery'
      });
      return;
    }

    // 接続リセット試行
    try {
      await integration.update({
        lastError: null,
        lastSyncStatus: 'recovering'
      });

      // 認証情報の更新が必要な場合の処理
      await auditLog('integration_recovery_attempted', null, integration.id, {
        integrationType: integration.integrationType
      });

      logger.info(`Integration ${integration.id} recovery initiated`);
    } catch (error) {
      logger.error(`Integration ${integration.id} recovery failed:`, error);
    }
  }

  /**
   * リトライ情報の保存
   */
  async saveRetryInfo(operationName, info) {
    const key = `retry:${operationName}:${Date.now()}`;
    await redis.setex(key, 3600, JSON.stringify(info)); // 1時間TTL
  }

  /**
   * タイムアウト付き実行
   */
  async withTimeout(promise, timeoutMs, timeoutMessage) {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return Promise.race([promise, timeout]);
  }

  /**
   * スリープ関数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * リカバリーサービスの開始
   */
  async start() {
    logger.info('Recovery service started');

    // バッチリトライ処理（5分ごと）
    setInterval(() => {
      this.processBatchRetries();
    }, 5 * 60 * 1000);

    // 失敗ジョブリカバリー（30分ごと）
    setInterval(() => {
      this.recoverFailedBatchJobs();
    }, 30 * 60 * 1000);

    // 統合ヘルスチェック（10分ごと）
    setInterval(() => {
      this.checkAndRecoverIntegrations();
    }, 10 * 60 * 1000);

    // イベントリスナー設定
    this.on('retry', async (data) => {
      logger.info(`Retry event received for ${data.operationName}`);
    });
  }

  /**
   * リカバリーサービスの停止
   */
  async stop() {
    await redis.quit();
    this.removeAllListeners();
    logger.info('Recovery service stopped');
  }
}

// シングルトンインスタンス
const recoveryService = new RecoveryService();

module.exports = recoveryService;