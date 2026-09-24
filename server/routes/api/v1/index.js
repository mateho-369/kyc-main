const express = require('express');
const router = express.Router();

// ミドルウェア
const { authHybrid, checkRateLimit } = require('../../../middleware/auth-hybrid');
const { ApiLog } = require('../../../models');
const { defaultLimiter, batchLimiter, searchLimiter } = require('../../../middleware/rateLimiter');

// APIログ記録ミドルウェア
router.use(async (req, res, next) => {
  const startTime = Date.now();
  
  // レスポンス送信時にログを記録
  const originalSend = res.send;
  res.send = function(data) {
    res.send = originalSend;
    
    // APIログを非同期で記録
    setImmediate(async () => {
      try {
        await ApiLog.create({
          userId: req.user?.id || null,
          apiKey: req.header('X-API-Key') || null,
          method: req.method,
          endpoint: req.originalUrl,
          requestHeaders: req.headers,
          requestBody: req.body,
          responseStatus: res.statusCode,
          responseBody: res.statusCode < 400 ? null : data, // エラー時のみレスポンスボディを保存
          responseTime: Date.now() - startTime,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          errorMessage: res.statusCode >= 400 ? data?.error || data?.message : null,
          apiVersion: 'v1',
          rateLimitRemaining: res.get('X-RateLimit-Remaining')
        });
      } catch (error) {
        console.error('APIログ記録エラー:', error);
      }
    });
    
    return originalSend.apply(res, arguments);
  };
  
  next();
});

// デフォルトのレート制限
router.use(defaultLimiter);

// API v1 ルート（個別レート制限付き）
router.use('/batch', batchLimiter, require('./batch'));
router.use('/bulk', require('./bulk'));
router.use('/search', searchLimiter, require('./search'));
router.use('/analytics', require('./analytics'));
router.use('/webhooks', require('./webhooks'));
router.use('/integrations', require('./integrations'));
router.use('/kyc', require('./kyc'));

// API v1 ルートメタ情報
router.get('/', (req, res) => {
  res.json({
    version: '1.0.0',
    endpoints: {
      batch: {
        description: 'バッチ処理API',
        endpoints: [
          'POST /batch/performers',
          'GET /batch/jobs/:jobId',
          'DELETE /batch/jobs/:jobId'
        ]
      },
      bulk: {
        description: '一括操作API',
        endpoints: [
          'PUT /bulk/update',
          'DELETE /bulk/delete',
          'POST /bulk/validate'
        ]
      },
      search: {
        description: '高度検索API',
        endpoints: [
          'POST /search/advanced',
          'GET /search/suggestions',
          'POST /search/export'
        ]
      },
      analytics: {
        description: '統計・分析API',
        endpoints: [
          'GET /analytics/stats',
          'GET /analytics/performance',
          'GET /analytics/reports/generate'
        ]
      },
      webhooks: {
        description: 'Webhook管理API',
        endpoints: [
          'POST /webhooks/configure',
          'GET /webhooks',
          'GET /webhooks/:id',
          'PUT /webhooks/:id',
          'DELETE /webhooks/:id',
          'POST /webhooks/:id/test',
          'GET /webhooks/events/list',
          'POST /webhooks/validate'
        ]
      },
      kyc: {
        description: 'KYC（本人確認）API',
        endpoints: [
          'POST /kyc/requests',
          'POST /kyc/requests/:requestId/documents',
          'POST /kyc/requests/:requestId/submit',
          'GET /kyc/requests/:requestId',
          'GET /kyc/requests/:requestId/workflow',
          'GET /kyc/pending',
          'POST /kyc/requests/:requestId/approve',
          'POST /kyc/requests/:requestId/reject',
          'GET /kyc/performers/:performerId/status',
          'POST /kyc/sharegram/verification-result'
        ]
      }
    },
    authentication: {
      methods: ['JWT', 'Firebase'],
      headers: {
        jwt: 'Authorization: Bearer <token>',
        firebase: 'Firebase-Token: <token>'
      }
    },
    rateLimit: {
      default: '100 requests per 15 minutes',
      batch: '10 requests per 15 minutes'
    }
  });
});

// 404ハンドラー
router.use((req, res) => {
  res.status(404).json({
    error: 'エンドポイントが見つかりません',
    path: req.originalUrl,
    method: req.method
  });
});

module.exports = router;