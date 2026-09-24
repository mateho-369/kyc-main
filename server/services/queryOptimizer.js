const { Performer, User, AuditLog, KycDocument, SharegramIntegration } = require('../models');
const { Op } = require('sequelize');
const { cacheStrategy } = require('./cacheStrategy');

/**
 * N+1問題を解決するクエリ最適化サービス
 */
class QueryOptimizer {
  /**
   * パフォーマー一覧取得（最適化版）
   * N+1問題を回避し、必要な関連データを一度に取得
   */
  async getPerformersOptimized(filters = {}, options = {}) {
    const {
      status,
      kycStatus,
      userId,
      search,
      expiringKyc,
      page = 1,
      limit = 50,
      sort = 'createdAt',
      order = 'DESC'
    } = { ...filters, ...options };

    // キャッシュキー生成
    const cacheKey = cacheStrategy.generateKey(
      'performers',
      'list',
      JSON.stringify({ status, kycStatus, userId, search, expiringKyc, page, limit, sort, order })
    );

    // キャッシュからの取得を試行
    const cached = await cacheStrategy.get(cacheKey);
    if (cached) {
      return cached;
    }

    // クエリ条件の構築
    const whereClause = this.buildPerformerWhereClause({
      status,
      kycStatus,
      userId,
      search,
      expiringKyc
    });

    // ソート条件の構築
    const orderClause = this.buildOrderClause(sort, order);

    // メインクエリ（関連データを含む）
    const result = await Performer.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email'], // 必要な属性のみ
          required: false
        },
        {
          model: KycDocument,
          as: 'kycDocuments',
          attributes: ['id', 'documentType', 'verificationStatus', 'verifiedAt'],
          required: false,
          separate: true // 別クエリで取得（パフォーマンス向上）
        }
      ],
      attributes: {
        exclude: ['documents'] // 大きなJSONフィールドは除外
      },
      limit,
      offset: (page - 1) * limit,
      order: orderClause,
      distinct: true, // 重複を避ける
      subQuery: false // サブクエリを無効化（パフォーマンス向上）
    });

    // 結果をキャッシュに保存
    await cacheStrategy.set(cacheKey, result, { ttl: 300 }); // 5分間キャッシュ

    return result;
  }

  /**
   * 単一パフォーマー取得（関連データ込み）
   */
  async getPerformerWithRelations(performerId, options = {}) {
    const cacheKey = cacheStrategy.generateKey('performer', performerId, 'full');
    
    // キャッシュチェック
    const cached = await cacheStrategy.get(cacheKey);
    if (cached) {
      return cached;
    }

    const performer = await Performer.findByPk(performerId, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'role']
        },
        {
          model: KycDocument,
          as: 'kycDocuments',
          attributes: ['id', 'documentType', 'filePath', 'verificationStatus', 'verifiedAt', 'createdAt']
        },
        {
          model: AuditLog,
          as: 'auditLogs',
          attributes: ['id', 'action', 'userId', 'createdAt'],
          limit: 10,
          order: [['createdAt', 'DESC']],
          separate: true
        }
      ]
    });

    if (performer) {
      await cacheStrategy.set(cacheKey, performer, { ttl: 600 }); // 10分間キャッシュ
    }

    return performer;
  }

  /**
   * バッチでパフォーマーを取得（IN句最適化）
   */
  async getPerformersBatch(performerIds, options = {}) {
    if (!performerIds || performerIds.length === 0) {
      return [];
    }

    // バッチキャッシュチェック
    const cacheKeys = performerIds.map(id => 
      cacheStrategy.generateKey('performer', id, 'basic')
    );
    const cachedResults = await cacheStrategy.mget(cacheKeys);
    
    // キャッシュヒットしたIDを除外
    const cachedPerformers = Object.values(cachedResults).filter(Boolean);
    const cachedIds = cachedPerformers.map(p => p.id);
    const missingIds = performerIds.filter(id => !cachedIds.includes(id));

    if (missingIds.length === 0) {
      return cachedPerformers;
    }

    // キャッシュミスしたデータをDBから取得
    const performers = await Performer.findAll({
      where: {
        id: {
          [Op.in]: missingIds
        }
      },
      attributes: options.attributes || undefined
    });

    // 取得したデータをキャッシュに保存
    const cachePromises = performers.map(performer => 
      cacheStrategy.set(
        cacheStrategy.generateKey('performer', performer.id, 'basic'),
        performer,
        { ttl: 600 }
      )
    );
    await Promise.all(cachePromises);

    return [...cachedPerformers, ...performers];
  }

  /**
   * 統計情報の取得（集計クエリ最適化）
   */
  async getPerformerStats(options = {}) {
    const cacheKey = cacheStrategy.generateKey('stats', 'performers', JSON.stringify(options));
    
    const cached = await cacheStrategy.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 並列で統計を取得
    const [
      totalCount,
      activeCount,
      pendingCount,
      verifiedCount,
      documentsStats,
      recentActivity
    ] = await Promise.all([
      // 合計数
      Performer.count(),
      
      // アクティブ数
      Performer.count({ where: { status: 'active' } }),
      
      // 保留中数
      Performer.count({ where: { status: 'pending' } }),
      
      // KYC検証済み数
      Performer.count({ where: { kycStatus: 'verified' } }),
      
      // ドキュメント統計
      KycDocument.findAll({
        attributes: [
          'documentType',
          [Performer.sequelize.fn('COUNT', '*'), 'count'],
          [Performer.sequelize.fn('COUNT', 
            Performer.sequelize.literal(
              'CASE WHEN "verificationStatus" = \'verified\' THEN 1 END'
            )
          ), 'verifiedCount']
        ],
        group: ['documentType'],
        raw: true
      }),
      
      // 最近のアクティビティ
      AuditLog.findAll({
        where: {
          resourceType: 'performer',
          createdAt: {
            [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24時間以内
          }
        },
        attributes: [
          'action',
          [Performer.sequelize.fn('COUNT', '*'), 'count']
        ],
        group: ['action'],
        raw: true
      })
    ]);

    const stats = {
      total: totalCount,
      byStatus: {
        active: activeCount,
        pending: pendingCount,
        inactive: totalCount - activeCount - pendingCount
      },
      byKycStatus: {
        verified: verifiedCount,
        unverified: totalCount - verifiedCount
      },
      documents: documentsStats,
      recentActivity: recentActivity,
      generatedAt: new Date()
    };

    // 統計をキャッシュ（1時間）
    await cacheStrategy.set(cacheKey, stats, { ttl: 3600 });

    return stats;
  }

  /**
   * WHERE句の構築ヘルパー
   */
  buildPerformerWhereClause(filters) {
    const where = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.kycStatus) {
      where.kycStatus = filters.kycStatus;
    }

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.search) {
      where[Op.or] = [
        { lastName: { [Op.iLike]: `%${filters.search}%` } },
        { firstName: { [Op.iLike]: `%${filters.search}%` } },
        { lastNameRoman: { [Op.iLike]: `%${filters.search}%` } },
        { firstNameRoman: { [Op.iLike]: `%${filters.search}%` } },
        { external_id: { [Op.iLike]: `%${filters.search}%` } }
      ];
    }

    if (filters.expiringKyc) {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      where[Op.and] = [
        { kycStatus: 'verified' },
        { 
          kycExpiresAt: {
            [Op.between]: [new Date(), thirtyDaysFromNow]
          }
        }
      ];
    }

    return where;
  }

  /**
   * ORDER句の構築ヘルパー
   */
  buildOrderClause(sort, order) {
    const validSorts = {
      createdAt: ['createdAt', order],
      updatedAt: ['updatedAt', order],
      name: [['lastName', order], ['firstName', order]],
      status: ['status', order],
      kycStatus: ['kycStatus', order]
    };

    return validSorts[sort] || validSorts.createdAt;
  }

  /**
   * キャッシュの無効化
   */
  async invalidatePerformerCache(performerId) {
    const patterns = [
      `performer:${performerId}:*`,
      'performers:list:*',
      'stats:performers:*'
    ];

    const promises = patterns.map(pattern => 
      cacheStrategy.deletePattern(pattern)
    );

    await Promise.all(promises);
  }

  /**
   * プリロード戦略
   */
  async preloadPerformers(criteria = {}) {
    const performers = await Performer.findAll({
      where: criteria,
      attributes: ['id', 'external_id', 'lastName', 'firstName', 'status', 'kycStatus'],
      limit: 100
    });

    const keys = performers.map(p => 
      cacheStrategy.generateKey('performer', p.id, 'basic')
    );

    const warmupResults = await cacheStrategy.warmUp(keys, async (key) => {
      const id = key.split(':')[1];
      return performers.find(p => p.id === parseInt(id));
    });

    return {
      total: warmupResults.length,
      success: warmupResults.filter(r => r.status === 'success').length,
      failed: warmupResults.filter(r => r.status === 'error').length
    };
  }
}

// シングルトンインスタンス
const queryOptimizer = new QueryOptimizer();

module.exports = {
  queryOptimizer,
  QueryOptimizer
};