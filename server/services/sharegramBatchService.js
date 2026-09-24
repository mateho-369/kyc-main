/**
 * Sharegram Batch Processing Service
 * 定期同期、バッチ処理、差分更新の管理
 */

const cron = require('node-cron');
const { Performer, AuditLog, ApiLog, SharegramIntegration } = require('../models');
const { createSharegramClient } = require('./sharegram/sharegramClient');
const { Op } = require('sequelize');

class SharegramBatchService {
  constructor() {
    this.isRunning = false;
    this.syncJobs = new Map();
    this.retryQueue = [];
    this.metrics = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      lastSyncTime: null,
      lastFullSync: null,
      averageSyncTime: 0
    };
  }

  /**
   * バッチサービスを初期化
   */
  async initialize() {
    console.log('Initializing Sharegram Batch Service...');
    
    try {
      // アクティブな統合を確認
      const activeIntegrations = await SharegramIntegration.findAll({
        where: { 
          isActive: true,
          integrationType: 'api'
        }
      });

      if (activeIntegrations.length === 0) {
        console.log('No active Sharegram integrations found');
        return;
      }

      // 定期同期ジョブの設定
      this.scheduleSyncJobs();
      
      // リトライキューの処理開始
      this.startRetryQueue();
      
      console.log(`Batch service initialized with ${activeIntegrations.length} integrations`);
    } catch (error) {
      console.error('Failed to initialize Sharegram Batch Service:', error);
      throw error;
    }
  }

  /**
   * 定期同期ジョブのスケジュール設定
   */
  scheduleSyncJobs() {
    // 毎時0分に差分同期実行
    const hourlySync = cron.schedule('0 * * * *', async () => {
      await this.performDifferentialSync();
    }, {
      scheduled: false,
      timezone: 'Asia/Tokyo'
    });

    // 毎日午前3時に完全同期実行
    const dailyFullSync = cron.schedule('0 3 * * *', async () => {
      await this.performFullSync();
    }, {
      scheduled: false,
      timezone: 'Asia/Tokyo'
    });

    // 5分毎にリトライキュー処理
    const retryProcessor = cron.schedule('*/5 * * * *', async () => {
      await this.processRetryQueue();
    }, {
      scheduled: false,
      timezone: 'Asia/Tokyo'
    });

    // ジョブを開始
    hourlySync.start();
    dailyFullSync.start();
    retryProcessor.start();

    this.syncJobs.set('hourly', hourlySync);
    this.syncJobs.set('daily', dailyFullSync);
    this.syncJobs.set('retry', retryProcessor);

    console.log('Sync jobs scheduled:');
    console.log('- Differential sync: Every hour at 0 minutes');
    console.log('- Full sync: Daily at 3:00 AM');
    console.log('- Retry processing: Every 5 minutes');
  }

  /**
   * 差分同期の実行
   */
  async performDifferentialSync(options = {}) {
    if (this.isRunning) {
      console.log('Sync already in progress, skipping differential sync');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      console.log('Starting differential sync...');
      
      const { 
        sinceHours = 24,
        batchSize = 100,
        maxRetries = 3 
      } = options;

      // 最後の同期時刻から差分データを取得
      const sinceTime = new Date(Date.now() - (sinceHours * 60 * 60 * 1000));
      
      const performersToSync = await Performer.findAll({
        where: {
          [Op.or]: [
            { lastSyncTime: { [Op.gte]: sinceTime } },
            { lastSyncTime: null },
            { syncSource: { [Op.ne]: 'sharegram' } }
          ]
        },
        order: [['lastSyncTime', 'ASC']],
        limit: batchSize
      });

      const result = await this.syncPerformers(performersToSync, {
        type: 'differential',
        maxRetries,
        batchSize: Math.min(batchSize, 50) // 差分同期は小さなバッチサイズ
      });

      this.metrics.totalSyncs++;
      this.metrics.lastSyncTime = new Date();
      
      if (result.success) {
        this.metrics.successfulSyncs++;
      } else {
        this.metrics.failedSyncs++;
      }

      // 実行時間の更新
      const executionTime = Date.now() - startTime;
      this.metrics.averageSyncTime = 
        (this.metrics.averageSyncTime * (this.metrics.totalSyncs - 1) + executionTime) / this.metrics.totalSyncs;

      console.log(`Differential sync completed: ${result.processed} performers processed in ${executionTime}ms`);
      
      return result;
      
    } catch (error) {
      console.error('Differential sync failed:', error);
      this.metrics.failedSyncs++;
      
      // リトライキューに追加
      this.addToRetryQueue('differential', options);
      
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 完全同期の実行
   */
  async performFullSync(options = {}) {
    if (this.isRunning) {
      console.log('Sync already in progress, skipping full sync');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      console.log('Starting full sync...');
      
      const { 
        batchSize = 200,
        maxRetries = 5,
        includeInactive = false 
      } = options;

      const whereClause = includeInactive ? {} : { status: { [Op.ne]: 'inactive' } };
      
      const totalCount = await Performer.count({ where: whereClause });
      let processed = 0;
      let offset = 0;

      const results = {
        total: totalCount,
        processed: 0,
        successful: 0,
        failed: 0,
        errors: []
      };

      console.log(`Full sync: Processing ${totalCount} performers in batches of ${batchSize}`);

      while (offset < totalCount) {
        const batch = await Performer.findAll({
          where: whereClause,
          offset,
          limit: batchSize,
          order: [['id', 'ASC']]
        });

        if (batch.length === 0) break;

        const batchResult = await this.syncPerformers(batch, {
          type: 'full',
          maxRetries,
          batchSize: Math.min(batchSize, 100) // API制限を考慮
        });

        results.processed += batchResult.processed;
        results.successful += batchResult.successful;
        results.failed += batchResult.failed;
        results.errors.push(...batchResult.errors);

        offset += batchSize;
        processed += batch.length;

        console.log(`Full sync progress: ${processed}/${totalCount} (${Math.round(processed/totalCount*100)}%)`);

        // API制限を避けるため、バッチ間にディレイ
        await this.delay(1000);
      }

      this.metrics.totalSyncs++;
      this.metrics.lastSyncTime = new Date();
      this.metrics.lastFullSync = new Date();
      
      if (results.failed === 0) {
        this.metrics.successfulSyncs++;
      } else {
        this.metrics.failedSyncs++;
      }

      const executionTime = Date.now() - startTime;
      this.metrics.averageSyncTime = 
        (this.metrics.averageSyncTime * (this.metrics.totalSyncs - 1) + executionTime) / this.metrics.totalSyncs;

      console.log(`Full sync completed: ${results.processed} performers processed in ${executionTime}ms`);
      
      // 監査ログ記録
      await AuditLog.create({
        userId: 0,
        action: 'full_sync_completed',
        resourceType: 'performer',
        resourceId: 0,
        details: {
          results,
          executionTime,
          timestamp: new Date().toISOString()
        },
        ipAddress: '127.0.0.1',
        userAgent: 'SharegramBatchService'
      });

      return results;
      
    } catch (error) {
      console.error('Full sync failed:', error);
      this.metrics.failedSyncs++;
      
      // リトライキューに追加
      this.addToRetryQueue('full', options);
      
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * パフォーマーリストの同期実行
   */
  async syncPerformers(performers, options = {}) {
    const { 
      type = 'manual',
      maxRetries = 3,
      batchSize = 50 
    } = options;

    const startTime = Date.now();
    const results = {
      total: performers.length,
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [],
      type
    };

    try {
      // Sharegram APIクライアントの初期化
      const sharegramClient = await createSharegramClient(1);
      
      // バッチ処理
      for (let i = 0; i < performers.length; i += batchSize) {
        const batch = performers.slice(i, i + batchSize);
        
        const batchResults = await Promise.allSettled(
          batch.map(performer => this.syncSinglePerformer(performer, sharegramClient, maxRetries))
        );

        // 結果の集計
        batchResults.forEach((result, index) => {
          results.processed++;
          
          if (result.status === 'fulfilled') {
            results.successful++;
          } else {
            results.failed++;
            results.errors.push({
              performerId: batch[index].id,
              error: result.reason.message,
              timestamp: new Date().toISOString()
            });
          }
        });

        // プログレス表示
        if (type === 'full' && performers.length > 100) {
          const progress = Math.round((i + batch.length) / performers.length * 100);
          console.log(`Sync progress: ${progress}% (${results.processed}/${results.total})`);
        }

        // API制限を避けるため、バッチ間にディレイ
        if (i + batchSize < performers.length) {
          await this.delay(500);
        }
      }

      const executionTime = Date.now() - startTime;
      results.executionTime = executionTime;
      results.success = results.failed === 0;

      // API実行ログ記録
      await ApiLog.create({
        method: 'BATCH_SYNC',
        path: '/performers/sync',
        requestBody: { 
          type, 
          performerCount: performers.length,
          options 
        },
        responseStatus: results.success ? 200 : 500,
        responseBody: results,
        responseTime: executionTime,
        metadata: {
          service: 'sharegram_batch',
          syncType: type,
          batchSize
        }
      });

      return results;

    } catch (error) {
      console.error('Batch sync error:', error);
      results.errors.push({
        type: 'batch_error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      results.success = false;
      
      throw error;
    }
  }

  /**
   * 単一パフォーマーの同期実行
   */
  async syncSinglePerformer(performer, sharegramClient, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Sharegram APIから最新データを取得
        const sharegramData = await sharegramClient.getPerformerData(performer.external_id);
        
        // ローカルデータと比較・更新
        const hasChanges = this.detectChanges(performer, sharegramData);
        
        if (hasChanges) {
          await performer.update({
            lastName: sharegramData.lastName || performer.lastName,
            firstName: sharegramData.firstName || performer.firstName,
            kycStatus: sharegramData.kycStatus || performer.kycStatus,
            riskScore: sharegramData.riskScore || performer.riskScore,
            documents: {
              ...performer.documents,
              ...(sharegramData.documents || {})
            },
            lastSyncTime: new Date(),
            syncSource: 'sharegram',
            kycMetadata: {
              ...performer.kycMetadata,
              lastSharegramSync: new Date().toISOString(),
              syncAttempt: attempt
            }
          });
        }

        return { 
          success: true, 
          performer: performer.id, 
          hasChanges,
          attempt 
        };

      } catch (error) {
        lastError = error;
        console.warn(`Sync attempt ${attempt}/${maxRetries} failed for performer ${performer.id}: ${error.message}`);
        
        if (attempt < maxRetries) {
          await this.delay(Math.pow(2, attempt) * 1000); // Exponential backoff
        }
      }
    }

    throw new Error(`Failed to sync performer ${performer.id} after ${maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * データ変更の検出
   */
  detectChanges(localPerformer, remoteData) {
    const fields = ['lastName', 'firstName', 'kycStatus', 'riskScore'];
    
    for (const field of fields) {
      if (remoteData[field] && remoteData[field] !== localPerformer[field]) {
        return true;
      }
    }

    // ドキュメントの変更確認
    if (remoteData.documents) {
      const localDocs = localPerformer.documents || {};
      const remoteDocs = remoteData.documents || {};
      
      for (const docType in remoteDocs) {
        if (!localDocs[docType] || localDocs[docType].url !== remoteDocs[docType].url) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * リトライキューへの追加
   */
  addToRetryQueue(type, options, priority = 'normal') {
    const retryItem = {
      id: require('crypto').randomUUID(),
      type,
      options,
      priority,
      attempts: 0,
      maxAttempts: 3,
      nextAttempt: new Date(Date.now() + 5 * 60 * 1000), // 5分後
      createdAt: new Date()
    };

    this.retryQueue.push(retryItem);
    console.log(`Added ${type} sync to retry queue: ${retryItem.id}`);
  }

  /**
   * リトライキューの処理
   */
  async processRetryQueue() {
    if (this.retryQueue.length === 0) return;

    const now = new Date();
    const itemsToRetry = this.retryQueue.filter(item => item.nextAttempt <= now);

    for (const item of itemsToRetry) {
      try {
        console.log(`Retrying ${item.type} sync: ${item.id} (attempt ${item.attempts + 1}/${item.maxAttempts})`);
        
        let result;
        if (item.type === 'differential') {
          result = await this.performDifferentialSync(item.options);
        } else if (item.type === 'full') {
          result = await this.performFullSync(item.options);
        }

        if (result.success) {
          // 成功したらキューから削除
          this.retryQueue = this.retryQueue.filter(i => i.id !== item.id);
          console.log(`Retry successful for ${item.type} sync: ${item.id}`);
        } else {
          throw new Error('Sync completed but had failures');
        }

      } catch (error) {
        item.attempts++;
        
        if (item.attempts >= item.maxAttempts) {
          // 最大試行回数に達したらキューから削除
          this.retryQueue = this.retryQueue.filter(i => i.id !== item.id);
          console.error(`Max retry attempts reached for ${item.type} sync: ${item.id}`);
        } else {
          // 次回試行時刻を更新（指数バックオフ）
          const delayMinutes = Math.pow(2, item.attempts) * 5;
          item.nextAttempt = new Date(Date.now() + delayMinutes * 60 * 1000);
          console.log(`Retry failed for ${item.type} sync: ${item.id}, next attempt in ${delayMinutes} minutes`);
        }
      }
    }
  }

  /**
   * リトライキューの処理開始
   */
  startRetryQueue() {
    console.log('Retry queue processor started');
  }

  /**
   * バッチサービスの統計情報取得
   */
  getMetrics() {
    return {
      ...this.metrics,
      retryQueueSize: this.retryQueue.length,
      isRunning: this.isRunning,
      activeJobs: Array.from(this.syncJobs.keys())
    };
  }

  /**
   * 手動同期のトリガー
   */
  async triggerManualSync(type = 'differential', options = {}) {
    console.log(`Manual ${type} sync triggered`);
    
    if (type === 'differential') {
      return await this.performDifferentialSync(options);
    } else if (type === 'full') {
      return await this.performFullSync(options);
    } else {
      throw new Error(`Unknown sync type: ${type}`);
    }
  }

  /**
   * バッチサービスの停止
   */
  async shutdown() {
    console.log('Shutting down Sharegram Batch Service...');
    
    // 全てのジョブを停止
    for (const [name, job] of this.syncJobs) {
      job.stop();
      console.log(`Stopped ${name} job`);
    }

    // 進行中の同期の完了を待つ
    if (this.isRunning) {
      console.log('Waiting for running sync to complete...');
      while (this.isRunning) {
        await this.delay(1000);
      }
    }

    console.log('Sharegram Batch Service shut down complete');
  }

  /**
   * ディレイユーティリティ
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// シングルトンインスタンス
const sharegramBatchService = new SharegramBatchService();

module.exports = {
  SharegramBatchService,
  sharegramBatchService
};