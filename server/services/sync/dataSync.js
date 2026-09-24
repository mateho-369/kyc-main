const { Performer, User, SharegramIntegration, Webhook, sequelize } = require('../../models');
const { Op } = require('sequelize');
const EventEmitter = require('events');
const Queue = require('bull');
const Redis = require('ioredis');

/**
 * データ同期サービス
 * 各種統合システムとのデータ同期を管理
 */
class DataSyncService extends EventEmitter {
  constructor() {
    super();
    this.syncQueues = {};
    this.redis = null;
    this.isInitialized = false;
  }

  /**
   * サービスの初期化
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // Redis接続（Queueシステム用）
      this.redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        retryStrategy: (times) => Math.min(times * 50, 2000)
      });

      // 同期キューの初期化
      this.syncQueues = {
        performer: new Queue('performer-sync', { redis: this.redis }),
        user: new Queue('user-sync', { redis: this.redis }),
        document: new Queue('document-sync', { redis: this.redis })
      };

      // キューイベントの設定
      this.setupQueueEvents();

      this.isInitialized = true;
      this.emit('initialized');
      console.log('データ同期サービスが初期化されました');
    } catch (error) {
      console.error('データ同期サービスの初期化エラー:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * キューイベントの設定
   */
  setupQueueEvents() {
    Object.entries(this.syncQueues).forEach(([name, queue]) => {
      queue.on('completed', (job, result) => {
        this.emit('jobCompleted', { queue: name, jobId: job.id, result });
      });

      queue.on('failed', (job, err) => {
        this.emit('jobFailed', { queue: name, jobId: job.id, error: err });
      });

      // ジョブプロセッサの設定
      queue.process(async (job) => {
        return await this.processSync(name, job.data);
      });
    });
  }

  /**
   * 同期ジョブの処理
   */
  async processSync(type, data) {
    const { action, resourceId, integration, options = {} } = data;

    try {
      switch (type) {
        case 'performer':
          return await this.syncPerformer(action, resourceId, integration, options);
        case 'user':
          return await this.syncUser(action, resourceId, integration, options);
        case 'document':
          return await this.syncDocument(action, resourceId, integration, options);
        default:
          throw new Error(`未対応の同期タイプ: ${type}`);
      }
    } catch (error) {
      console.error(`同期エラー (${type}):`, error);
      throw error;
    }
  }

  /**
   * Performer同期
   */
  async syncPerformer(action, performerId, integration, options) {
    const performer = await Performer.findByPk(performerId);
    if (!performer) {
      throw new Error(`Performer not found: ${performerId}`);
    }

    const syncData = {
      id: performer.id,
      lastName: performer.lastName,
      firstName: performer.firstName,
      lastNameRoman: performer.lastNameRoman,
      firstNameRoman: performer.firstNameRoman,
      status: performer.status,
      documents: performer.documents,
      createdAt: performer.createdAt,
      updatedAt: performer.updatedAt
    };

    // 統合タイプに応じた処理
    switch (integration.integrationType) {
      case 'webhook':
        // Webhook通知
        const webhooks = await Webhook.findAll({
          where: {
            userId: integration.userId,
            isActive: true,
            events: { [Op.contains]: [`performer.${action}`] }
          }
        });

        const results = await Promise.all(
          webhooks.map(webhook => webhook.trigger(`performer.${action}`, syncData))
        );

        return { webhooksTriggered: results.length, results };

      case 'api':
        // 外部API連携
        const apiConfig = integration.configuration;
        const response = await this.callExternalAPI(apiConfig, syncData, action);
        return { apiResponse: response };

      default:
        throw new Error(`未対応の統合タイプ: ${integration.integrationType}`);
    }
  }

  /**
   * User同期
   */
  async syncUser(action, userId, integration, options) {
    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password'] }
    });
    
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const syncData = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      authProvider: user.authProvider,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt
    };

    // 統合処理（Performer同様の実装）
    return await this.processIntegration(integration, 'user', action, syncData);
  }

  /**
   * Document同期
   */
  async syncDocument(action, documentData, integration, options) {
    const { performerId, documentType, verified } = documentData;

    const syncData = {
      performerId,
      documentType,
      verified,
      timestamp: new Date().toISOString(),
      action
    };

    return await this.processIntegration(integration, 'document', action, syncData);
  }

  /**
   * 統合処理の共通ロジック
   */
  async processIntegration(integration, resourceType, action, data) {
    // 統合設定を更新
    await integration.update({
      lastSyncAt: new Date(),
      syncStatus: 'syncing'
    });

    try {
      let result;

      switch (integration.integrationType) {
        case 'webhook':
          result = await this.processWebhookIntegration(integration, resourceType, action, data);
          break;
        case 'api':
          result = await this.processAPIIntegration(integration, resourceType, action, data);
          break;
        default:
          throw new Error(`未対応の統合タイプ: ${integration.integrationType}`);
      }

      await integration.updateSyncStatus('success');
      return result;

    } catch (error) {
      await integration.updateSyncStatus('failed', error);
      throw error;
    }
  }

  /**
   * 外部APIコール
   */
  async callExternalAPI(config, data, action) {
    const axios = require('axios');
    
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
      ...config.headers
    };

    const endpoint = `${config.endpoint}/${action}`;

    try {
      const response = await axios({
        method: config.method || 'POST',
        url: endpoint,
        headers,
        data,
        timeout: 30000
      });

      return {
        success: true,
        statusCode: response.status,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        statusCode: error.response?.status,
        error: error.message
      };
    }
  }

  /**
   * 同期ジョブのスケジュール
   */
  async scheduleSync(type, data, options = {}) {
    if (!this.isInitialized) await this.initialize();

    const queue = this.syncQueues[type];
    if (!queue) {
      throw new Error(`無効な同期タイプ: ${type}`);
    }

    const jobOptions = {
      delay: options.delay || 0,
      attempts: options.attempts || 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: true,
      removeOnFail: false
    };

    const job = await queue.add(data, jobOptions);
    
    this.emit('jobScheduled', {
      type,
      jobId: job.id,
      data
    });

    return job;
  }

  /**
   * バルク同期
   */
  async bulkSync(type, resources, integration, options = {}) {
    const jobs = await Promise.all(
      resources.map(resource => 
        this.scheduleSync(type, {
          action: options.action || 'sync',
          resourceId: resource.id,
          integration,
          options
        })
      )
    );

    this.emit('bulkSyncScheduled', {
      type,
      count: jobs.length,
      jobIds: jobs.map(j => j.id)
    });

    return {
      scheduled: jobs.length,
      jobIds: jobs.map(j => j.id)
    };
  }

  /**
   * 同期状態の取得
   */
  async getSyncStatus() {
    const queues = await Promise.all(
      Object.entries(this.syncQueues).map(async ([name, queue]) => {
        const [waiting, active, completed, failed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount()
        ]);

        return {
          name,
          waiting,
          active,
          completed,
          failed
        };
      })
    );

    const integrations = await SharegramIntegration.findAll({
      where: { isActive: true },
      attributes: ['id', 'integrationType', 'syncStatus', 'lastSyncAt']
    });

    return {
      queues,
      integrations,
      isActive: this.isInitialized,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 同期履歴の取得
   */
  async getSyncHistory(filters = {}) {
    const { type, startDate, endDate, status } = filters;
    
    const where = {};
    if (startDate && endDate) {
      where.lastSyncAt = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }
    if (status) {
      where.syncStatus = status;
    }

    const history = await SharegramIntegration.findAll({
      where,
      order: [['lastSyncAt', 'DESC']],
      limit: 100
    });

    return history;
  }

  /**
   * クリーンアップ
   */
  async cleanup() {
    if (this.redis) {
      await this.redis.quit();
    }

    Object.values(this.syncQueues).forEach(queue => {
      queue.close();
    });

    this.isInitialized = false;
    this.emit('cleanup');
  }
}

// シングルトンインスタンス
const dataSyncService = new DataSyncService();

module.exports = dataSyncService;