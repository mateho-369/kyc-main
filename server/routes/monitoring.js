/**
 * Monitoring & Analytics Routes
 * システム監視、ログ分析、パフォーマンス監視のエンドポイント
 */

const express = require('express');
const { Op } = require('sequelize');
const { 
  Performer, 
  AuditLog, 
  ApiLog, 
  SharegramIntegration,
  Webhook 
} = require('../models');
const { sharegramBatchService } = require('../services/sharegramBatchService');
const { authenticateToken } = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

const router = express.Router();

// @route   GET /api/monitoring/dashboard
// @desc    監視ダッシュボードの総合データ取得
// @access  Private (Admin only)
router.get('/dashboard', 
  authenticateToken, 
  checkRole(['admin']),
  async (req, res) => {
    try {
      const { timeRange = '24h' } = req.query;
      
      // 時間範囲の計算
      const timeRangeHours = timeRange === '1h' ? 1 : 
                           timeRange === '6h' ? 6 :
                           timeRange === '24h' ? 24 :
                           timeRange === '7d' ? 168 : 24;
      
      const sinceTime = new Date(Date.now() - (timeRangeHours * 60 * 60 * 1000));

      // 並列でデータ取得
      const [
        performerStats,
        syncStats,
        webhookStats,
        apiStats,
        errorStats,
        systemHealth
      ] = await Promise.all([
        getPerformerStats(sinceTime),
        getSyncStats(sinceTime),
        getWebhookStats(sinceTime),
        getApiStats(sinceTime),
        getErrorStats(sinceTime),
        getSystemHealth()
      ]);

      res.json({
        success: true,
        data: {
          timeRange,
          generatedAt: new Date().toISOString(),
          performers: performerStats,
          sync: syncStats,
          webhooks: webhookStats,
          api: apiStats,
          errors: errorStats,
          system: systemHealth
        }
      });

    } catch (error) {
      console.error('Dashboard data error:', error);
      res.status(500).json({
        success: false,
        message: 'ダッシュボードデータの取得に失敗しました',
        error: error.message
      });
    }
  }
);

// @route   GET /api/monitoring/performers
// @desc    パフォーマー関連の統計取得
// @access  Private (Admin only)
router.get('/performers',
  authenticateToken,
  checkRole(['admin']),
  async (req, res) => {
    try {
      const { 
        groupBy = 'status',
        timeRange = '7d',
        includeDetails = false 
      } = req.query;

      const timeRangeHours = timeRange === '1d' ? 24 : 
                           timeRange === '7d' ? 168 :
                           timeRange === '30d' ? 720 : 168;
      
      const sinceTime = new Date(Date.now() - (timeRangeHours * 60 * 60 * 1000));

      let groupByField = 'status';
      if (groupBy === 'kyc') groupByField = 'kycStatus';
      if (groupBy === 'source') groupByField = 'syncSource';

      const stats = await Performer.findAll({
        attributes: [
          groupByField,
          [Performer.sequelize.fn('COUNT', Performer.sequelize.col('id')), 'count']
        ],
        where: {
          createdAt: { [Op.gte]: sinceTime }
        },
        group: [groupByField]
      });

      const totalCount = await Performer.count();
      const recentCount = await Performer.count({
        where: { createdAt: { [Op.gte]: sinceTime } }
      });

      const response = {
        success: true,
        data: {
          groupBy,
          timeRange,
          total: totalCount,
          recent: recentCount,
          breakdown: stats
        }
      };

      if (includeDetails === 'true') {
        const kycBreakdown = await Performer.findAll({
          attributes: [
            'kycStatus',
            [Performer.sequelize.fn('COUNT', Performer.sequelize.col('id')), 'count'],
            [Performer.sequelize.fn('AVG', Performer.sequelize.col('riskScore')), 'avgRiskScore']
          ],
          group: ['kycStatus']
        });

        response.data.kycBreakdown = kycBreakdown;
      }

      res.json(response);

    } catch (error) {
      console.error('Performer stats error:', error);
      res.status(500).json({
        success: false,
        message: 'パフォーマー統計の取得に失敗しました',
        error: error.message
      });
    }
  }
);

// @route   GET /api/monitoring/sync
// @desc    同期処理の監視データ取得
// @access  Private (Admin only)
router.get('/sync',
  authenticateToken,
  checkRole(['admin']),
  async (req, res) => {
    try {
      const batchMetrics = sharegramBatchService.getMetrics();
      
      const recentSyncs = await AuditLog.findAll({
        where: {
          action: { [Op.in]: ['sync', 'full_sync_completed', 'webhook_received'] },
          createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        order: [['createdAt', 'DESC']],
        limit: 50
      });

      const integrationStatus = await SharegramIntegration.findAll({
        where: { isActive: true },
        attributes: ['id', 'name', 'lastSyncAt', 'syncStatus', 'errorCount']
      });

      res.json({
        success: true,
        data: {
          batchService: batchMetrics,
          recentSyncs: recentSyncs.map(sync => ({
            id: sync.id,
            action: sync.action,
            details: sync.details,
            createdAt: sync.createdAt,
            success: !sync.details?.error
          })),
          integrations: integrationStatus
        }
      });

    } catch (error) {
      console.error('Sync monitoring error:', error);
      res.status(500).json({
        success: false,
        message: '同期監視データの取得に失敗しました',
        error: error.message
      });
    }
  }
);

// @route   GET /api/monitoring/api-logs
// @desc    API実行ログの取得
// @access  Private (Admin only)
router.get('/api-logs',
  authenticateToken,
  checkRole(['admin']),
  async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 50, 
        service,
        status,
        timeRange = '24h'
      } = req.query;

      const offset = (page - 1) * limit;
      const timeRangeHours = timeRange === '1h' ? 1 : 
                           timeRange === '6h' ? 6 :
                           timeRange === '24h' ? 24 : 24;
      
      const sinceTime = new Date(Date.now() - (timeRangeHours * 60 * 60 * 1000));

      const whereClause = {
        createdAt: { [Op.gte]: sinceTime }
      };

      if (service) {
        whereClause['metadata.service'] = service;
      }

      if (status) {
        whereClause.responseStatus = status;
      }

      const { count, rows } = await ApiLog.findAndCountAll({
        where: whereClause,
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['createdAt', 'DESC']]
      });

      // 統計データ
      const stats = await ApiLog.findAll({
        attributes: [
          'responseStatus',
          [ApiLog.sequelize.fn('COUNT', ApiLog.sequelize.col('id')), 'count'],
          [ApiLog.sequelize.fn('AVG', ApiLog.sequelize.col('responseTime')), 'avgResponseTime']
        ],
        where: { createdAt: { [Op.gte]: sinceTime } },
        group: ['responseStatus']
      });

      res.json({
        success: true,
        data: {
          logs: rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit)
          },
          stats: stats,
          timeRange
        }
      });

    } catch (error) {
      console.error('API logs error:', error);
      res.status(500).json({
        success: false,
        message: 'APIログの取得に失敗しました',
        error: error.message
      });
    }
  }
);

// @route   GET /api/monitoring/errors
// @desc    エラー分析データ取得
// @access  Private (Admin only)
router.get('/errors',
  authenticateToken,
  checkRole(['admin']),
  async (req, res) => {
    try {
      const { timeRange = '24h' } = req.query;
      
      const timeRangeHours = timeRange === '1h' ? 1 : 
                           timeRange === '6h' ? 6 :
                           timeRange === '24h' ? 24 :
                           timeRange === '7d' ? 168 : 24;
      
      const sinceTime = new Date(Date.now() - (timeRangeHours * 60 * 60 * 1000));

      // API エラー統計
      const apiErrors = await ApiLog.findAll({
        attributes: [
          'responseStatus',
          'errorMessage',
          [ApiLog.sequelize.fn('COUNT', ApiLog.sequelize.col('id')), 'count']
        ],
        where: {
          createdAt: { [Op.gte]: sinceTime },
          responseStatus: { [Op.gte]: 400 }
        },
        group: ['responseStatus', 'errorMessage'],
        order: [[ApiLog.sequelize.fn('COUNT', ApiLog.sequelize.col('id')), 'DESC']]
      });

      // Webhook エラー統計
      const webhookErrors = await Webhook.findAll({
        attributes: [
          'source',
          'errorMessage',
          [Webhook.sequelize.fn('COUNT', Webhook.sequelize.col('id')), 'count']
        ],
        where: {
          receivedAt: { [Op.gte]: sinceTime },
          status: 'failed'
        },
        group: ['source', 'errorMessage'],
        order: [[Webhook.sequelize.fn('COUNT', Webhook.sequelize.col('id')), 'DESC']]
      });

      // 同期エラー統計
      const syncErrors = await AuditLog.findAll({
        attributes: [
          'action',
          [AuditLog.sequelize.fn('COUNT', AuditLog.sequelize.col('id')), 'count']
        ],
        where: {
          createdAt: { [Op.gte]: sinceTime },
          action: { [Op.like]: '%_failed' }
        },
        group: ['action'],
        order: [[AuditLog.sequelize.fn('COUNT', AuditLog.sequelize.col('id')), 'DESC']]
      });

      res.json({
        success: true,
        data: {
          timeRange,
          api: {
            errors: apiErrors,
            total: apiErrors.reduce((sum, err) => sum + parseInt(err.dataValues.count), 0)
          },
          webhooks: {
            errors: webhookErrors,
            total: webhookErrors.reduce((sum, err) => sum + parseInt(err.dataValues.count), 0)
          },
          sync: {
            errors: syncErrors,
            total: syncErrors.reduce((sum, err) => sum + parseInt(err.dataValues.count), 0)
          }
        }
      });

    } catch (error) {
      console.error('Error analysis error:', error);
      res.status(500).json({
        success: false,
        message: 'エラー分析データの取得に失敗しました',
        error: error.message
      });
    }
  }
);

// @route   POST /api/monitoring/sync/trigger
// @desc    手動同期の実行
// @access  Private (Admin only)
router.post('/sync/trigger',
  authenticateToken,
  checkRole(['admin']),
  async (req, res) => {
    try {
      const { 
        type = 'differential',
        options = {} 
      } = req.body;

      const result = await sharegramBatchService.triggerManualSync(type, options);
      
      // 監査ログ記録
      await AuditLog.create({
        userId: req.user.id,
        action: 'manual_sync_triggered',
        resourceType: 'sync',
        resourceId: 0,
        details: {
          type,
          options,
          result
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });

      res.json({
        success: true,
        message: `${type}同期が開始されました`,
        data: result
      });

    } catch (error) {
      console.error('Manual sync trigger error:', error);
      res.status(500).json({
        success: false,
        message: '手動同期の開始に失敗しました',
        error: error.message
      });
    }
  }
);

// @route   GET /api/monitoring/health
// @desc    システムヘルスチェック
// @access  Public
router.get('/health', async (req, res) => {
  try {
    const health = await getSystemHealth();
    
    res.json({
      success: true,
      data: health,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      success: false,
      message: 'ヘルスチェックに失敗しました',
      error: error.message
    });
  }
});

/**
 * ヘルパー関数群
 */

async function getPerformerStats(sinceTime) {
  const [total, recent, kycBreakdown] = await Promise.all([
    Performer.count(),
    Performer.count({ where: { createdAt: { [Op.gte]: sinceTime } } }),
    Performer.findAll({
      attributes: [
        'kycStatus',
        [Performer.sequelize.fn('COUNT', Performer.sequelize.col('id')), 'count']
      ],
      group: ['kycStatus']
    })
  ]);

  return {
    total,
    recent,
    kycBreakdown
  };
}

async function getSyncStats(sinceTime) {
  const syncLogs = await AuditLog.findAll({
    where: {
      action: { [Op.in]: ['sync', 'full_sync_completed'] },
      createdAt: { [Op.gte]: sinceTime }
    }
  });

  const successful = syncLogs.filter(log => !log.details?.error).length;
  const failed = syncLogs.length - successful;

  return {
    total: syncLogs.length,
    successful,
    failed,
    successRate: syncLogs.length > 0 ? (successful / syncLogs.length * 100).toFixed(2) : 0
  };
}

async function getWebhookStats(sinceTime) {
  const webhooks = await Webhook.findAll({
    attributes: [
      'status',
      [Webhook.sequelize.fn('COUNT', Webhook.sequelize.col('id')), 'count']
    ],
    where: { receivedAt: { [Op.gte]: sinceTime } },
    group: ['status']
  });

  return webhooks;
}

async function getApiStats(sinceTime) {
  const [total, errorCount, avgResponseTime] = await Promise.all([
    ApiLog.count({ where: { createdAt: { [Op.gte]: sinceTime } } }),
    ApiLog.count({ 
      where: { 
        createdAt: { [Op.gte]: sinceTime },
        responseStatus: { [Op.gte]: 400 }
      } 
    }),
    ApiLog.findOne({
      attributes: [[ApiLog.sequelize.fn('AVG', ApiLog.sequelize.col('responseTime')), 'avg']],
      where: { createdAt: { [Op.gte]: sinceTime } }
    })
  ]);

  return {
    total,
    errorCount,
    successRate: total > 0 ? ((total - errorCount) / total * 100).toFixed(2) : 100,
    avgResponseTime: avgResponseTime?.dataValues?.avg || 0
  };
}

async function getErrorStats(sinceTime) {
  const [apiErrors, webhookErrors] = await Promise.all([
    ApiLog.count({ 
      where: { 
        createdAt: { [Op.gte]: sinceTime },
        responseStatus: { [Op.gte]: 400 }
      } 
    }),
    Webhook.count({ 
      where: { 
        receivedAt: { [Op.gte]: sinceTime },
        status: 'failed'
      } 
    })
  ]);

  return {
    api: apiErrors,
    webhooks: webhookErrors,
    total: apiErrors + webhookErrors
  };
}

async function getSystemHealth() {
  try {
    const [dbHealth, batchServiceHealth] = await Promise.all([
      checkDatabaseHealth(),
      sharegramBatchService.getMetrics()
    ]);

    return {
      database: dbHealth,
      batchService: batchServiceHealth,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function checkDatabaseHealth() {
  try {
    await Performer.findOne({ limit: 1 });
    return { status: 'healthy', message: 'Database connection OK' };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
}

module.exports = router;