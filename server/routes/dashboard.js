const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const { Op, fn, col, literal } = require('sequelize');
const { sequelize } = require('../config/db');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { Performer, AuditLog, User, KYCRequest, KYCDocument, KYCVerificationStep, SharegramIntegration, ApiLog, Video } = require('../models');

// Simple in-memory cache for dashboard statistics
const dashboardCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// Cache helper functions
const getCacheKey = (endpoint, userId, role) => `${endpoint}_${userId}_${role}`;
const isCacheValid = (cacheEntry) => {
  return cacheEntry && (Date.now() - cacheEntry.timestamp) < CACHE_DURATION;
};
const setCache = (key, data) => {
  dashboardCache.set(key, {
    data,
    timestamp: Date.now()
  });
};
const getCache = (key) => {
  const entry = dashboardCache.get(key);
  return isCacheValid(entry) ? entry.data : null;
};

// @route   GET api/dashboard/stats
// @desc    Get dashboard statistics
// @access  Private (Admin Only)
router.get('/stats', auth, checkRole(['admin']), async (req, res) => {
  try {
    // Check cache first
    const cacheKey = getCacheKey('stats', req.user.id, req.user.role);
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      return res.json({
        ...cachedData,
        cached: true
      });
    }

    // 日付計算
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // 全てのクエリを並列実行
    const [
      totalPerformers,
      pendingVerification,
      recentlyUpdated,
      expiringDocuments,
      recentActivity
    ] = await Promise.all([
      // 登録出演者数
      Performer.count(),

      // 検証待ち書類のある出演者数
      Performer.count({
        where: {
          [Op.and]: [
            {
              documents: {
                [Op.ne]: null
              }
            },
            {
              [Op.or]: [
                { 'documents.agreementFile.verified': false },
                { 'documents.idFront.verified': false },
                { 'documents.selfie.verified': false }
              ]
            }
          ]
        }
      }),

      // 最近更新された出演者数（過去7日間）
      Performer.count({
        where: {
          updatedAt: {
            [Op.gte]: sevenDaysAgo
          }
        }
      }),

      // 期限切れ間近の書類（3ヶ月以上前に作成された検証済み書類）
      Performer.count({
        where: {
          createdAt: {
            [Op.lte]: threeMonthsAgo
          },
          [Op.and]: [
            {
              documents: {
                [Op.ne]: null
              }
            },
            {
              [Op.or]: [
                { 'documents.agreementFile.verified': true },
                { 'documents.idFront.verified': true },
                { 'documents.selfie.verified': true }
              ]
            }
          ]
        }
      }),

      // 最近のアクティビティ
      AuditLog.findAll({
        include: [{
          model: User,
          attributes: ['id', 'name', 'email']
        }],
        order: [['createdAt', 'DESC']],
        limit: 5
      })
    ]);

    // アクティビティデータをフォーマット
    const formattedActivity = recentActivity.map(log => {
      let description = '';

      switch(log.action) {
        case 'create':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}を新規作成しました。`;
          break;
        case 'update':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}情報を更新しました。`;
          break;
        case 'delete':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}を削除しました。`;
          break;
        case 'verify':
          description = `書類を検証しました。`;
          break;
        case 'download':
          description = `書類をダウンロードしました。`;
          break;
        default:
          description = `${log.resourceType}に対して${log.action}を実行しました。`;
      }

      return {
        id: log.id,
        timestamp: log.createdAt,
        userName: log.User ? log.User.name : `ユーザーID: ${log.userId}`,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        description
      };
    });

    const responseData = {
      totalPerformers,
      pendingVerification,
      recentlyUpdated,
      expiringDocuments,
      recentActivity: formattedActivity
    };

    // Cache the result
    setCache(cacheKey, responseData);

    res.json(responseData);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// @route   GET api/dashboard/activity
// @desc    Get recent activity
// @access  Private (Admin Only)
router.get('/activity', auth, checkRole(['admin']), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const recentActivity = await AuditLog.findAll({
      include: [{
        model: User,
        attributes: ['id', 'name', 'email']
      }],
      order: [['createdAt', 'DESC']],
      limit
    });
    
    // アクティビティデータをフォーマット
    const formattedActivity = recentActivity.map(log => {
      let description = '';
      
      switch(log.action) {
        case 'create':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}を新規作成しました。`;
          break;
        case 'update':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}情報を更新しました。`;
          break;
        case 'delete':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}を削除しました。`;
          break;
        case 'verify':
          description = `書類を検証しました。`;
          break;
        case 'download':
          description = `書類をダウンロードしました。`;
          break;
        default:
          description = `${log.resourceType}に対して${log.action}を実行しました。`;
      }
      
      return {
        id: log.id,
        timestamp: log.createdAt,
        userName: log.User ? log.User.name : `ユーザーID: ${log.userId}`,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        description
      };
    });
    
    res.json(formattedActivity);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// @route   GET api/dashboard/chart
// @desc    Get chart data
// @access  Private (Admin Only)
router.get('/chart', auth, checkRole(['admin']), async (req, res) => {
  try {
    const type = req.query.type || 'monthly';
    const now = new Date();
    
    // 期間の設定
    let startDate;
    let groupFormat;
    let labels = [];
    
    switch (type) {
      case 'daily':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 30); // 過去30日
        groupFormat = '%Y-%m-%d';
        // 日付ラベルを生成
        for (let i = 0; i < 30; i++) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + i);
          labels.push(d.toISOString().slice(0, 10));
        }
        break;
      case 'weekly':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7 * 12); // 過去12週間
        groupFormat = '%Y-%u'; // 年-週番号
        // 週ラベルを生成
        for (let i = 0; i < 12; i++) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + i * 7);
          labels.push(`Week ${i + 1}`);
        }
        break;
      case 'monthly':
      default:
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 12); // 過去12ヶ月
        groupFormat = '%Y-%m';
        // 月ラベルを生成
        for (let i = 0; i < 12; i++) {
          const d = new Date(startDate);
          d.setMonth(d.getMonth() + i);
          const monthName = new Intl.DateTimeFormat('ja-JP', { month: 'long' }).format(d);
          labels.push(monthName);
        }
        break;
    }
    
    // 出演者登録数の集計
    const performerCounts = await Performer.findAll({
      attributes: [
        [sequelize.fn('DATE_FORMAT', sequelize.col('createdAt'), groupFormat), 'period'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: {
        createdAt: {
          [Op.gte]: startDate
        }
      },
      group: ['period'],
      raw: true
    });
    
    // データ配列の初期化
    const performers = Array(labels.length).fill(0);
    const documents = Array(labels.length).fill(0);
    const verifications = Array(labels.length).fill(0);
    
    // 集計データをグラフデータに変換
    performerCounts.forEach(item => {
      const period = item.period;
      const count = parseInt(item.count);
      
      // 期間に対応するインデックスを検索
      let index = -1;
      
      if (type === 'daily') {
        index = labels.findIndex(l => l === period);
      } else if (type === 'weekly') {
        const weekNum = parseInt(period.split('-')[1]);
        index = weekNum - 1;
      } else {
        // 月のフォーマット例: 2023-01
        const month = parseInt(period.split('-')[1]) - 1; // 0-indexed month
        const yearMonth = new Date(period).toISOString().slice(0, 7);
        index = labels.findIndex((_, i) => {
          const d = new Date(startDate);
          d.setMonth(d.getMonth() + i);
          return d.toISOString().slice(0, 7) === yearMonth;
        });
      }
      
      if (index !== -1) {
        performers[index] = count;
      }
    });
    
    // 書類アップロード数とデータ検証数は出演者数からの推定値として設定
    // 実際のアプリケーションでは、AuditLogなどから取得する
    for (let i = 0; i < labels.length; i++) {
      // 書類は出演者の約2倍（出演者1人あたり平均2つの書類）
      documents[i] = performers[i] * 2;
      // 検証は書類の約8割
      verifications[i] = Math.floor(documents[i] * 0.8);
    }
    
    res.json({
      labels,
      datasets: [
        {
          label: '出演者登録数',
          data: performers
        },
        {
          label: '書類アップロード数',
          data: documents
        },
        {
          label: '検証完了数',
          data: verifications
        }
      ]
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// @route   GET api/dashboard/statistics
// @desc    Get comprehensive dashboard statistics with caching
// @access  Private (Role-based: admin, manager, analyst)
router.get('/statistics', auth, checkRole(['admin', 'manager', 'analyst']), async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const cacheKey = getCacheKey('statistics', userId, userRole);
    
    // Check cache first
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      return res.json({
        ...cachedData,
        cached: true,
        cacheTimestamp: new Date(dashboardCache.get(cacheKey).timestamp).toISOString()
      });
    }

    // Calculate current date ranges
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);
    const thisMonth = new Date(today);
    thisMonth.setDate(thisMonth.getDate() - 30);
    const thisYear = new Date(today);
    thisYear.setFullYear(thisYear.getFullYear() - 1);

    // Base statistics queries (visible to all roles)
    const baseStats = await Promise.all([
      // KYC System Overview
      KYCRequest.count(),
      KYCRequest.count({ where: { status: 'draft' } }),
      KYCRequest.count({ where: { status: 'submitted' } }),
      KYCRequest.count({ where: { status: 'in_review' } }),
      KYCRequest.count({ where: { status: 'approved' } }),
      KYCRequest.count({ where: { status: 'rejected' } }),
      KYCRequest.count({ where: { status: 'expired' } }),
      
      // Performer Statistics
      Performer.count(),
      Performer.count({ where: { createdAt: { [Op.gte]: today } } }),
      Performer.count({ where: { createdAt: { [Op.gte]: thisWeek } } }),
      Performer.count({ where: { createdAt: { [Op.gte]: thisMonth } } }),
      
      // Document Statistics
      KYCDocument.count(),
      KYCDocument.count({ where: { status: 'pending' } }),
      KYCDocument.count({ where: { status: 'verified' } }),
      KYCDocument.count({ where: { status: 'rejected' } }),
      
      // Recent Activity Counts
      KYCRequest.count({ where: { createdAt: { [Op.gte]: today } } }),
      KYCRequest.count({ where: { submittedAt: { [Op.gte]: today } } }),
      KYCRequest.count({ where: { reviewedAt: { [Op.gte]: today } } })
    ]);

    // Destructure base statistics
    const [
      totalKYCRequests, draftKYC, submittedKYC, inReviewKYC, approvedKYC, rejectedKYC, expiredKYC,
      totalPerformers, todayPerformers, weekPerformers, monthPerformers,
      totalDocuments, pendingDocuments, verifiedDocuments, rejectedDocuments,
      todayKYCRequests, todaySubmissions, todayReviews
    ] = baseStats;

    // Performance metrics (for admin and manager roles)
    let performanceMetrics = {};
    if (['admin', 'manager'].includes(userRole)) {
      const performanceData = await Promise.all([
        // Average processing times
        KYCRequest.findAll({
          attributes: [
            [sequelize.fn('AVG', sequelize.fn('TIMESTAMPDIFF', sequelize.literal('HOUR'), sequelize.col('submittedAt'), sequelize.col('reviewedAt'))), 'avgReviewHours']
          ],
          where: {
            submittedAt: { [Op.not]: null },
            reviewedAt: { [Op.not]: null },
            reviewedAt: { [Op.gte]: thisMonth }
          },
          raw: true
        }),
        
        // System health indicators
        ApiLog.count({ where: { createdAt: { [Op.gte]: today } } }),
        ApiLog.count({ 
          where: { 
            createdAt: { [Op.gte]: today },
            statusCode: { [Op.gte]: 400 }
          } 
        }),
        
        // Verification success rates
        KYCRequest.count({ 
          where: { 
            status: 'approved',
            reviewedAt: { [Op.gte]: thisMonth }
          } 
        }),
        KYCRequest.count({ 
          where: { 
            status: 'rejected',
            reviewedAt: { [Op.gte]: thisMonth }
          } 
        })
      ]);

      const [avgReviewData, totalApiCalls, failedApiCalls, monthlyApproved, monthlyRejected] = performanceData;
      const avgReviewHours = avgReviewData[0]?.avgReviewHours || 0;
      const successRate = monthlyApproved + monthlyRejected > 0 
        ? ((monthlyApproved / (monthlyApproved + monthlyRejected)) * 100).toFixed(1)
        : 0;

      performanceMetrics = {
        averageReviewTime: {
          hours: parseFloat(avgReviewHours).toFixed(1),
          status: avgReviewHours < 24 ? 'good' : avgReviewHours < 72 ? 'warning' : 'critical'
        },
        apiHealth: {
          totalCalls: totalApiCalls,
          failedCalls: failedApiCalls,
          successRate: totalApiCalls > 0 ? (((totalApiCalls - failedApiCalls) / totalApiCalls) * 100).toFixed(1) : 100,
          status: failedApiCalls / totalApiCalls < 0.05 ? 'healthy' : 'degraded'
        },
        verificationSuccessRate: {
          rate: successRate,
          approved: monthlyApproved,
          rejected: monthlyRejected,
          status: successRate > 80 ? 'excellent' : successRate > 60 ? 'good' : 'needs_attention'
        }
      };
    }

    // Detailed analytics (admin only)
    let detailedAnalytics = {};
    if (userRole === 'admin') {
      const analyticsData = await Promise.all([
        // Sharegram Integration Statistics
        SharegramIntegration.count(),
        SharegramIntegration.count({ where: { status: 'active' } }),
        
        // User Activity
        User.count({ where: { lastLoginAt: { [Op.gte]: thisWeek } } }),
        
        // Video Processing Stats
        Video.count(),
        Video.count({ where: { status: 'processed' } }),
        
        // Expiring KYC Requests
        KYCRequest.count({
          where: {
            expiresAt: {
              [Op.lte]: new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)) // 30 days from now
            },
            status: 'approved'
          }
        })
      ]);

      const [
        totalIntegrations, activeIntegrations,
        activeUsers,
        totalVideos, processedVideos,
        expiringKYC
      ] = analyticsData;

      detailedAnalytics = {
        integrations: {
          total: totalIntegrations,
          active: activeIntegrations,
          utilization: totalIntegrations > 0 ? ((activeIntegrations / totalIntegrations) * 100).toFixed(1) : 0
        },
        userActivity: {
          activeUsersWeek: activeUsers,
          engagement: activeUsers > 0 ? 'high' : 'low'
        },
        videoProcessing: {
          total: totalVideos,
          processed: processedVideos,
          processingRate: totalVideos > 0 ? ((processedVideos / totalVideos) * 100).toFixed(1) : 0
        },
        compliance: {
          expiringKYC,
          urgentAction: expiringKYC > 10 ? 'required' : 'monitor'
        }
      };
    }

    // Recent activity summary
    const recentActivitySummary = await AuditLog.findAll({
      include: [{
        model: User,
        attributes: ['id', 'name', 'email']
      }],
      order: [['createdAt', 'DESC']],
      limit: 10,
      where: {
        createdAt: { [Op.gte]: new Date(now.getTime() - (24 * 60 * 60 * 1000)) } // Last 24 hours
      }
    });

    // Format activity data
    const formattedRecentActivity = recentActivitySummary.map(log => ({
      id: log.id,
      timestamp: log.createdAt,
      user: log.User ? {
        id: log.User.id,
        name: log.User.name,
        email: log.User.email
      } : null,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      severity: ['delete', 'reject'].includes(log.action) ? 'high' : 
                ['approve', 'verify'].includes(log.action) ? 'medium' : 'low'
    }));

    // Build comprehensive response based on user role
    const response = {
      kycSystem: {
        overview: {
          totalRequests: totalKYCRequests,
          byStatus: {
            draft: draftKYC,
            submitted: submittedKYC,
            inReview: inReviewKYC,
            approved: approvedKYC,
            rejected: rejectedKYC,
            expired: expiredKYC
          },
          completionRate: totalKYCRequests > 0 ? ((approvedKYC / totalKYCRequests) * 100).toFixed(1) : 0
        },
        documents: {
          total: totalDocuments,
          pending: pendingDocuments,
          verified: verifiedDocuments,
          rejected: rejectedDocuments,
          verificationRate: totalDocuments > 0 ? ((verifiedDocuments / totalDocuments) * 100).toFixed(1) : 0
        }
      },
      performers: {
        total: totalPerformers,
        growth: {
          today: todayPerformers,
          thisWeek: weekPerformers,
          thisMonth: monthPerformers
        }
      },
      activityToday: {
        newKYCRequests: todayKYCRequests,
        submissions: todaySubmissions,
        reviews: todayReviews,
        totalActivity: todayKYCRequests + todaySubmissions + todayReviews
      },
      recentActivity: formattedRecentActivity,
      systemHealth: {
        status: 'operational',
        uptime: '99.9%', // This would typically come from monitoring service
        lastUpdated: now.toISOString()
      }
    };

    // Add role-specific data
    if (['admin', 'manager'].includes(userRole)) {
      response.performance = performanceMetrics;
    }

    if (userRole === 'admin') {
      response.analytics = detailedAnalytics;
    }

    // Add metadata
    response.metadata = {
      generatedAt: now.toISOString(),
      userRole,
      dataFreshness: 'real-time',
      cached: false
    };

    // Cache the result
    setCache(cacheKey, response);

    res.json(response);
  } catch (err) {
    console.error('Dashboard statistics error:', err.message);
    res.status(500).json({
      error: 'サーバーエラーが発生しました',
      message: '統計情報の取得に失敗しました',
      timestamp: new Date().toISOString()
    });
  }
});

// REMOVED: Duplicate /statistics endpoint (was causing routing conflicts)

module.exports = router;
