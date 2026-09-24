const express = require('express');
const router = express.Router();
const { query, validationResult } = require('express-validator');
const { authHybrid, requireAdmin } = require('../../../middleware/auth-hybrid');
const { Performer, User, AuditLog, ApiLog, BatchJob, sequelize } = require('../../../models');
const { Op } = require('sequelize');
const moment = require('moment');

/**
 * @route   GET /api/v1/analytics/stats
 * @desc    システム全体の統計情報を取得
 * @access  Private (Admin only)
 */
router.get('/stats',
  authHybrid,
  requireAdmin,
  [
    query('period').optional().isIn(['day', 'week', 'month', 'year']).withMessage('無効な期間です'),
    query('startDate').optional().isISO8601().withMessage('有効な日付形式ではありません'),
    query('endDate').optional().isISO8601().withMessage('有効な日付形式ではありません'),
    query('metrics').optional().isArray()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      period = 'month', 
      startDate = moment().subtract(1, period).toISOString(),
      endDate = moment().toISOString(),
      metrics = ['all']
    } = req.query;

    try {
      const stats = {};
      const dateRange = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };

      // 基本統計
      if (metrics.includes('all') || metrics.includes('overview')) {
        stats.overview = {
          performers: {
            total: await Performer.count(),
            active: await Performer.count({ where: { status: 'active' } }),
            pending: await Performer.count({ where: { status: 'pending' } }),
            rejected: await Performer.count({ where: { status: 'rejected' } }),
            inactive: await Performer.count({ where: { status: 'inactive' } })
          },
          users: {
            total: await User.count(),
            admins: await User.count({ where: { role: 'admin' } }),
            regular: await User.count({ where: { role: 'user' } }),
            verified: await User.count({ where: { emailVerified: true } }),
            firebase: await User.count({ where: { authProvider: 'firebase' } })
          }
        };
      }

      // KYC処理統計
      if (metrics.includes('all') || metrics.includes('kyc')) {
        const kycStats = await sequelize.query(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
            AVG(CASE 
              WHEN status IN ('active', 'rejected') 
              THEN TIMESTAMPDIFF(HOUR, createdAt, updatedAt) 
              ELSE NULL 
            END) as avgProcessingHours
          FROM Performers
          WHERE createdAt BETWEEN :startDate AND :endDate
        `, {
          replacements: { startDate, endDate },
          type: sequelize.QueryTypes.SELECT
        });

        stats.kyc = {
          ...kycStats[0],
          avgProcessingTime: kycStats[0].avgProcessingHours 
            ? `${Math.round(kycStats[0].avgProcessingHours)} hours` 
            : 'N/A',
          approvalRate: kycStats[0].total > 0 
            ? ((kycStats[0].approved / kycStats[0].total) * 100).toFixed(2) + '%'
            : '0%'
        };
      }

      // API使用統計
      if (metrics.includes('all') || metrics.includes('api')) {
        const apiStats = await ApiLog.findAll({
          where: { createdAt: dateRange },
          attributes: [
            'method',
            'endpoint',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            [sequelize.fn('AVG', sequelize.col('responseTime')), 'avgResponseTime'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN responseStatus >= 400 THEN 1 END')), 'errors']
          ],
          group: ['method', 'endpoint'],
          order: [[sequelize.literal('count'), 'DESC']],
          limit: 10
        });

        stats.api = {
          totalRequests: await ApiLog.count({ where: { createdAt: dateRange } }),
          uniqueUsers: await ApiLog.count({ 
            where: { createdAt: dateRange },
            distinct: true,
            col: 'userId'
          }),
          avgResponseTime: await ApiLog.aggregate('responseTime', 'avg', { 
            where: { createdAt: dateRange } 
          }),
          errorRate: await calculateErrorRate(dateRange),
          topEndpoints: apiStats.map(stat => ({
            endpoint: `${stat.method} ${stat.endpoint}`,
            count: stat.get('count'),
            avgResponseTime: Math.round(stat.get('avgResponseTime')) + 'ms',
            errorCount: stat.get('errors')
          }))
        };
      }

      // バッチジョブ統計
      if (metrics.includes('all') || metrics.includes('batch')) {
        const batchStats = await BatchJob.findAll({
          where: { createdAt: dateRange },
          attributes: [
            'jobType',
            'status',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            [sequelize.fn('SUM', sequelize.col('processedItems')), 'totalProcessed'],
            [sequelize.fn('SUM', sequelize.col('successItems')), 'totalSuccess'],
            [sequelize.fn('SUM', sequelize.col('failedItems')), 'totalFailed']
          ],
          group: ['jobType', 'status']
        });

        stats.batch = {
          totalJobs: await BatchJob.count({ where: { createdAt: dateRange } }),
          completed: await BatchJob.count({ 
            where: { createdAt: dateRange, status: 'completed' } 
          }),
          failed: await BatchJob.count({ 
            where: { createdAt: dateRange, status: 'failed' } 
          }),
          processing: await BatchJob.count({ 
            where: { status: 'processing' } 
          }),
          byType: batchStats.reduce((acc, stat) => {
            const type = stat.jobType;
            if (!acc[type]) acc[type] = {};
            acc[type][stat.status] = {
              count: stat.get('count'),
              processed: stat.get('totalProcessed'),
              success: stat.get('totalSuccess'),
              failed: stat.get('totalFailed')
            };
            return acc;
          }, {})
        };
      }

      // 時系列データ
      if (metrics.includes('all') || metrics.includes('trends')) {
        stats.trends = await generateTrends(period, startDate, endDate);
      }

      // アクティビティログ統計
      if (metrics.includes('all') || metrics.includes('activity')) {
        const activityStats = await AuditLog.findAll({
          where: { createdAt: dateRange },
          attributes: [
            'action',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            [sequelize.fn('COUNT', sequelize.literal('DISTINCT userId')), 'uniqueUsers']
          ],
          group: ['action'],
          order: [[sequelize.literal('count'), 'DESC']]
        });

        const topUsers = await AuditLog.findAll({
          where: { createdAt: dateRange },
          attributes: [
            'userId',
            'userEmail',
            [sequelize.fn('COUNT', sequelize.col('id')), 'actionCount']
          ],
          group: ['userId', 'userEmail'],
          order: [[sequelize.literal('actionCount'), 'DESC']],
          limit: 5
        });

        stats.activity = {
          totalActions: await AuditLog.count({ where: { createdAt: dateRange } }),
          uniqueUsers: await AuditLog.count({ 
            where: { createdAt: dateRange },
            distinct: true,
            col: 'userId'
          }),
          byAction: activityStats.map(stat => ({
            action: stat.action,
            count: stat.get('count'),
            uniqueUsers: stat.get('uniqueUsers')
          })),
          topUsers: topUsers.map(user => ({
            userId: user.userId,
            email: user.userEmail,
            actionCount: user.get('actionCount')
          }))
        };
      }

      // レスポンス構築
      res.json({
        success: true,
        period: {
          type: period,
          startDate,
          endDate
        },
        stats,
        generatedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('統計取得エラー:', error);
      res.status(500).json({ 
        error: '統計情報の取得に失敗しました',
        message: error.message 
      });
    }
  }
);

/**
 * @route   GET /api/v1/analytics/performance
 * @desc    パフォーマンス分析データを取得
 * @access  Private (Admin only)
 */
router.get('/performance',
  authHybrid,
  requireAdmin,
  [
    query('metric').isIn(['response_time', 'throughput', 'error_rate']).withMessage('無効なメトリクスです'),
    query('interval').optional().isIn(['minute', 'hour', 'day']).withMessage('無効な間隔です'),
    query('duration').optional().isInt({ min: 1, max: 168 }).withMessage('無効な期間です')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      metric, 
      interval = 'hour', 
      duration = 24 
    } = req.query;

    try {
      const endTime = new Date();
      const startTime = new Date(endTime - duration * 60 * 60 * 1000);

      let data;

      switch (metric) {
        case 'response_time':
          data = await getResponseTimeMetrics(startTime, endTime, interval);
          break;
        case 'throughput':
          data = await getThroughputMetrics(startTime, endTime, interval);
          break;
        case 'error_rate':
          data = await getErrorRateMetrics(startTime, endTime, interval);
          break;
      }

      res.json({
        success: true,
        metric,
        interval,
        duration,
        data,
        summary: calculateSummary(data)
      });

    } catch (error) {
      console.error('パフォーマンス分析エラー:', error);
      res.status(500).json({ 
        error: 'パフォーマンスデータの取得に失敗しました',
        message: error.message 
      });
    }
  }
);

/**
 * @route   GET /api/v1/analytics/reports/generate
 * @desc    カスタムレポートの生成
 * @access  Private (Admin only)
 */
router.get('/reports/generate',
  authHybrid,
  requireAdmin,
  [
    query('reportType').isIn(['daily', 'weekly', 'monthly', 'custom']).withMessage('無効なレポートタイプです'),
    query('format').optional().isIn(['pdf', 'excel', 'csv']).withMessage('無効な形式です')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { reportType, format = 'pdf' } = req.query;

    try {
      // レポート生成ジョブを作成
      const reportJob = await BatchJob.create({
        userId: req.user.id,
        jobType: 'data_export',
        status: 'pending',
        inputData: {
          reportType,
          format,
          requestedBy: req.user.email
        },
        metadata: {
          reportConfig: {
            includeCharts: true,
            includeSummary: true,
            includeDetails: reportType === 'custom'
          }
        }
      });

      // 非同期でレポート生成を開始
      generateReport(reportJob);

      res.json({
        success: true,
        message: 'レポート生成を開始しました',
        jobId: reportJob.id,
        estimatedTime: '5-10分',
        statusUrl: `/api/v1/batch/jobs/${reportJob.id}`
      });

    } catch (error) {
      console.error('レポート生成エラー:', error);
      res.status(500).json({ 
        error: 'レポート生成の開始に失敗しました',
        message: error.message 
      });
    }
  }
);

// ヘルパー関数

async function calculateErrorRate(dateRange) {
  const total = await ApiLog.count({ where: { createdAt: dateRange } });
  const errors = await ApiLog.count({ 
    where: { 
      createdAt: dateRange,
      responseStatus: { [Op.gte]: 400 }
    } 
  });
  
  return total > 0 ? ((errors / total) * 100).toFixed(2) + '%' : '0%';
}

async function generateTrends(period, startDate, endDate) {
  const format = period === 'day' ? '%Y-%m-%d %H:00:00' :
                 period === 'week' ? '%Y-%m-%d' :
                 period === 'month' ? '%Y-%m-%d' : '%Y-%m';

  const performerTrends = await sequelize.query(`
    SELECT 
      DATE_FORMAT(createdAt, :format) as period,
      COUNT(*) as count,
      status
    FROM Performers
    WHERE createdAt BETWEEN :startDate AND :endDate
    GROUP BY period, status
    ORDER BY period ASC
  `, {
    replacements: { format, startDate, endDate },
    type: sequelize.QueryTypes.SELECT
  });

  const apiTrends = await sequelize.query(`
    SELECT 
      DATE_FORMAT(createdAt, :format) as period,
      COUNT(*) as requests,
      AVG(responseTime) as avgResponseTime
    FROM ApiLogs
    WHERE createdAt BETWEEN :startDate AND :endDate
    GROUP BY period
    ORDER BY period ASC
  `, {
    replacements: { format, startDate, endDate },
    type: sequelize.QueryTypes.SELECT
  });

  return {
    performers: performerTrends,
    api: apiTrends
  };
}

async function getResponseTimeMetrics(startTime, endTime, interval) {
  const intervalSeconds = interval === 'minute' ? 60 : 
                         interval === 'hour' ? 3600 : 86400;

  const metrics = await sequelize.query(`
    SELECT 
      FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(createdAt)/:interval)*:interval) as timestamp,
      AVG(responseTime) as avg,
      MIN(responseTime) as min,
      MAX(responseTime) as max,
      COUNT(*) as count
    FROM ApiLogs
    WHERE createdAt BETWEEN :startTime AND :endTime
    GROUP BY timestamp
    ORDER BY timestamp ASC
  `, {
    replacements: { interval: intervalSeconds, startTime, endTime },
    type: sequelize.QueryTypes.SELECT
  });

  return metrics;
}

async function getThroughputMetrics(startTime, endTime, interval) {
  const intervalSeconds = interval === 'minute' ? 60 : 
                         interval === 'hour' ? 3600 : 86400;

  const metrics = await sequelize.query(`
    SELECT 
      FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(createdAt)/:interval)*:interval) as timestamp,
      COUNT(*) as requests,
      COUNT(DISTINCT userId) as uniqueUsers
    FROM ApiLogs
    WHERE createdAt BETWEEN :startTime AND :endTime
    GROUP BY timestamp
    ORDER BY timestamp ASC
  `, {
    replacements: { interval: intervalSeconds, startTime, endTime },
    type: sequelize.QueryTypes.SELECT
  });

  return metrics;
}

async function getErrorRateMetrics(startTime, endTime, interval) {
  const intervalSeconds = interval === 'minute' ? 60 : 
                         interval === 'hour' ? 3600 : 86400;

  const metrics = await sequelize.query(`
    SELECT 
      FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(createdAt)/:interval)*:interval) as timestamp,
      COUNT(*) as total,
      SUM(CASE WHEN responseStatus >= 400 THEN 1 ELSE 0 END) as errors,
      (SUM(CASE WHEN responseStatus >= 400 THEN 1 ELSE 0 END) / COUNT(*) * 100) as errorRate
    FROM ApiLogs
    WHERE createdAt BETWEEN :startTime AND :endTime
    GROUP BY timestamp
    ORDER BY timestamp ASC
  `, {
    replacements: { interval: intervalSeconds, startTime, endTime },
    type: sequelize.QueryTypes.SELECT
  });

  return metrics;
}

function calculateSummary(data) {
  if (!data || data.length === 0) return null;

  const values = data.map(d => d.avg || d.requests || d.errorRate);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    current: values[values.length - 1]
  };
}

async function generateReport(job) {
  // TODO: 実際のレポート生成ロジック
  try {
    await job.start();
    
    // シミュレーション: 5秒後に完了
    setTimeout(async () => {
      await job.complete({
        reportUrl: `/reports/${job.id}.pdf`,
        generatedAt: new Date()
      });
    }, 5000);
    
  } catch (error) {
    await job.fail(error);
  }
}

module.exports = router;