const client = require('prom-client');
const express = require('express');

// Prometheusレジストリ
const register = new client.Registry();

// デフォルトメトリクスを収集
client.collectDefaultMetrics({ 
  register,
  labels: { 
    app: 'safevideo',
    environment: process.env.NODE_ENV || 'development'
  }
});

// ========================================
// Sharegram統合メトリクス
// ========================================

// Sharegram API呼び出し数
const sharegramApiCalls = new client.Counter({
  name: 'sharegram_api_calls_total',
  help: 'Total number of Sharegram API calls',
  labelNames: ['method', 'endpoint', 'status'],
  registers: [register]
});

// Sharegram API応答時間
const sharegramApiDuration = new client.Histogram({
  name: 'sharegram_api_duration_seconds',
  help: 'Duration of Sharegram API calls in seconds',
  labelNames: ['method', 'endpoint'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register]
});

// Sharegram同期状態
const sharegramSyncStatus = new client.Gauge({
  name: 'sharegram_sync_status',
  help: 'Current sync status with Sharegram (1=active, 0=inactive)',
  labelNames: ['integration_id'],
  registers: [register]
});

// Sharegram Webhook受信数
const sharegramWebhooksReceived = new client.Counter({
  name: 'sharegram_webhooks_received_total',
  help: 'Total number of webhooks received from Sharegram',
  labelNames: ['event_type', 'status'],
  registers: [register]
});

// Sharegram統合エラー
const sharegramIntegrationErrors = new client.Counter({
  name: 'sharegram_integration_errors_total',
  help: 'Total number of Sharegram integration errors',
  labelNames: ['error_type', 'integration_type'],
  registers: [register]
});

// ========================================
// KYCメトリクス
// ========================================

// KYC検証数
const kycVerifications = new client.Counter({
  name: 'kyc_verifications_total',
  help: 'Total number of KYC verifications',
  labelNames: ['status', 'verification_level', 'provider'],
  registers: [register]
});

// KYC検証時間
const kycVerificationDuration = new client.Histogram({
  name: 'kyc_verification_duration_seconds',
  help: 'Duration of KYC verification process',
  labelNames: ['verification_level', 'provider'],
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register]
});

// KYCステータス別Performer数
const kycPerformersByStatus = new client.Gauge({
  name: 'kyc_performers_by_status',
  help: 'Number of performers by KYC status',
  labelNames: ['status'],
  registers: [register]
});

// KYC期限切れ警告
const kycExpirationWarnings = new client.Gauge({
  name: 'kyc_expiration_warnings',
  help: 'Number of performers with KYC expiring soon',
  labelNames: ['days_until_expiry'],
  registers: [register]
});

// ========================================
// Performerメトリクス
// ========================================

// Performer登録数
const performerRegistrations = new client.Counter({
  name: 'performer_registrations_total',
  help: 'Total number of performer registrations',
  labelNames: ['status', 'source'],
  registers: [register]
});

// アクティブPerformer数
const activePerformers = new client.Gauge({
  name: 'active_performers_total',
  help: 'Total number of active performers',
  labelNames: ['kyc_status'],
  registers: [register]
});

// Performer書類アップロード
const documentUploads = new client.Counter({
  name: 'performer_document_uploads_total',
  help: 'Total number of document uploads',
  labelNames: ['document_type', 'status'],
  registers: [register]
});

// ========================================
// Webhookメトリクス
// ========================================

// Webhook送信数
const webhooksSent = new client.Counter({
  name: 'webhooks_sent_total',
  help: 'Total number of webhooks sent',
  labelNames: ['event_type', 'destination', 'status'],
  registers: [register]
});

// Webhook送信遅延
const webhookDeliveryDelay = new client.Histogram({
  name: 'webhook_delivery_delay_seconds',
  help: 'Delay in webhook delivery',
  labelNames: ['event_type'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [register]
});

// Webhookリトライ数
const webhookRetries = new client.Counter({
  name: 'webhook_retries_total',
  help: 'Total number of webhook retries',
  labelNames: ['event_type', 'attempt_number'],
  registers: [register]
});

// ========================================
// APIメトリクス
// ========================================

// API呼び出し数
const apiRequests = new client.Counter({
  name: 'api_requests_total',
  help: 'Total number of API requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

// API応答時間
const apiRequestDuration = new client.Histogram({
  name: 'api_request_duration_seconds',
  help: 'Duration of API requests',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register]
});

// API同時接続数
const apiConcurrentRequests = new client.Gauge({
  name: 'api_concurrent_requests',
  help: 'Number of concurrent API requests',
  registers: [register]
});

// ========================================
// エラーメトリクス
// ========================================

// エラー発生数
const errorCount = new client.Counter({
  name: 'errors_total',
  help: 'Total number of errors',
  labelNames: ['category', 'severity', 'source'],
  registers: [register]
});

// エラー率
const errorRate = new client.Gauge({
  name: 'error_rate_per_minute',
  help: 'Error rate per minute',
  labelNames: ['category'],
  registers: [register]
});

// ========================================
// システムメトリクス
// ========================================

// データベース接続プール
const dbConnectionPool = new client.Gauge({
  name: 'database_connection_pool_size',
  help: 'Database connection pool metrics',
  labelNames: ['state'], // active, idle, waiting
  registers: [register]
});

// ジョブキュー
const jobQueueSize = new client.Gauge({
  name: 'job_queue_size',
  help: 'Number of jobs in queue',
  labelNames: ['queue_name', 'status'],
  registers: [register]
});

// キャッシュヒット率
const cacheHitRate = new client.Gauge({
  name: 'cache_hit_rate',
  help: 'Cache hit rate percentage',
  labelNames: ['cache_name'],
  registers: [register]
});

// ========================================
// ビジネスメトリクス
// ========================================

// 収益関連
const revenueMetrics = new client.Gauge({
  name: 'business_revenue_metrics',
  help: 'Revenue related metrics',
  labelNames: ['metric_type', 'currency'],
  registers: [register]
});

// コンテンツ承認率
const contentApprovalRate = new client.Gauge({
  name: 'content_approval_rate',
  help: 'Content approval rate percentage',
  labelNames: ['content_type', 'time_period'],
  registers: [register]
});

// ========================================
// カスタムメトリクスヘルパー関数
// ========================================

class MetricsCollector {
  // Sharegram API呼び出しを記録
  recordSharegramApiCall(method, endpoint, status, duration) {
    sharegramApiCalls.inc({ method, endpoint, status });
    sharegramApiDuration.observe({ method, endpoint }, duration);
  }

  // KYC検証を記録
  recordKycVerification(status, verificationLevel, provider, duration) {
    kycVerifications.inc({ status, verification_level: verificationLevel, provider });
    kycVerificationDuration.observe({ verification_level: verificationLevel, provider }, duration);
  }

  // Webhook送信を記録
  recordWebhookSent(eventType, destination, status, delay = 0) {
    webhooksSent.inc({ event_type: eventType, destination, status });
    if (delay > 0) {
      webhookDeliveryDelay.observe({ event_type: eventType }, delay);
    }
  }

  // API呼び出しを記録
  recordApiRequest(method, route, statusCode, duration) {
    apiRequests.inc({ method, route, status_code: statusCode });
    apiRequestDuration.observe({ method, route, status_code: statusCode }, duration);
  }

  // エラーを記録
  recordError(category, severity, source) {
    errorCount.inc({ category, severity, source });
  }

  // Performer統計を更新
  async updatePerformerStats() {
    try {
      const { Performer } = require('../models');
      const { Op } = require('sequelize');

      // KYCステータス別カウント
      const kycStatusCounts = await Performer.count({
        group: ['kycStatus']
      });

      kycStatusCounts.forEach(({ kycStatus, count }) => {
        kycPerformersByStatus.set({ status: kycStatus }, count);
      });

      // アクティブPerformer数
      const activeCounts = await Performer.count({
        where: { status: 'active' },
        group: ['kycStatus']
      });

      activeCounts.forEach(({ kycStatus, count }) => {
        activePerformers.set({ kyc_status: kycStatus }, count);
      });

      // KYC期限切れ警告
      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const expiringIn30Days = await Performer.count({
        where: {
          kycExpiresAt: {
            [Op.between]: [now, thirtyDaysFromNow]
          }
        }
      });

      const expiringIn7Days = await Performer.count({
        where: {
          kycExpiresAt: {
            [Op.between]: [now, sevenDaysFromNow]
          }
        }
      });

      kycExpirationWarnings.set({ days_until_expiry: '30' }, expiringIn30Days);
      kycExpirationWarnings.set({ days_until_expiry: '7' }, expiringIn7Days);

    } catch (error) {
      console.error('Error updating performer stats:', error);
    }
  }

  // Sharegram統合ステータスを更新
  async updateSharegramIntegrationStatus() {
    try {
      const { SharegramIntegration } = require('../models');
      
      const integrations = await SharegramIntegration.findAll({
        where: { isActive: true }
      });

      integrations.forEach(integration => {
        const isActive = integration.syncStatus === 'success' && 
                        integration.lastSyncAt && 
                        (Date.now() - new Date(integration.lastSyncAt).getTime() < 3600000); // 1時間以内
        
        sharegramSyncStatus.set({ integration_id: integration.id.toString() }, isActive ? 1 : 0);
      });

    } catch (error) {
      console.error('Error updating Sharegram integration status:', error);
    }
  }

  // データベース接続プール統計
  updateDatabasePoolStats(poolStats) {
    dbConnectionPool.set({ state: 'active' }, poolStats.active || 0);
    dbConnectionPool.set({ state: 'idle' }, poolStats.idle || 0);
    dbConnectionPool.set({ state: 'waiting' }, poolStats.waiting || 0);
  }

  // エラー率を計算
  calculateErrorRate() {
    // 過去1分間のエラー率を計算（実装は簡略化）
    // 実際の実装では、時系列データストアを使用
    const categories = ['authentication', 'database', 'external_api', 'validation'];
    categories.forEach(category => {
      // ダミー値（実際は計算する）
      errorRate.set({ category }, Math.random() * 10);
    });
  }
}

// ========================================
// Express Middlewareメトリクス
// ========================================

function prometheusMiddleware() {
  return (req, res, next) => {
    const start = Date.now();
    
    // 同時接続数を増加
    apiConcurrentRequests.inc();
    
    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const route = req.route ? req.route.path : req.path;
      
      // リクエストメトリクスを記録
      apiRequests.inc({ 
        method: req.method, 
        route: route, 
        status_code: res.statusCode 
      });
      
      apiRequestDuration.observe({ 
        method: req.method, 
        route: route, 
        status_code: res.statusCode 
      }, duration);
      
      // 同時接続数を減少
      apiConcurrentRequests.dec();
    });
    
    next();
  };
}

// ========================================
// メトリクスエクスポートエンドポイント
// ========================================

function createMetricsEndpoint() {
  const router = express.Router();
  
  router.get('/metrics', async (req, res) => {
    try {
      // 最新の統計を更新
      const collector = new MetricsCollector();
      await collector.updatePerformerStats();
      await collector.updateSharegramIntegrationStatus();
      collector.calculateErrorRate();
      
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (error) {
      res.status(500).end(error);
    }
  });
  
  return router;
}

// ========================================
// 定期的なメトリクス更新
// ========================================

function startMetricsCollection() {
  const collector = new MetricsCollector();
  
  // 1分ごとに統計を更新
  setInterval(async () => {
    await collector.updatePerformerStats();
    await collector.updateSharegramIntegrationStatus();
    collector.calculateErrorRate();
  }, 60000);
  
  console.log('Prometheus metrics collection started');
}

// エクスポート
module.exports = {
  register,
  MetricsCollector,
  prometheusMiddleware,
  createMetricsEndpoint,
  startMetricsCollection,
  
  // 個別メトリクス
  sharegramApiCalls,
  sharegramApiDuration,
  sharegramSyncStatus,
  sharegramWebhooksReceived,
  sharegramIntegrationErrors,
  kycVerifications,
  kycVerificationDuration,
  kycPerformersByStatus,
  performerRegistrations,
  activePerformers,
  documentUploads,
  webhooksSent,
  webhookDeliveryDelay,
  webhookRetries,
  apiRequests,
  apiRequestDuration,
  apiConcurrentRequests,
  errorCount,
  errorRate,
  dbConnectionPool,
  jobQueueSize,
  cacheHitRate,
  revenueMetrics,
  contentApprovalRate
};