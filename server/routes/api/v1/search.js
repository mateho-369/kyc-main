const express = require('express');
const router = express.Router();
const { body, query, validationResult } = require('express-validator');
const { authHybrid, authOptional } = require('../../../middleware/auth-hybrid');
const { Performer, User, AuditLog, sequelize } = require('../../../models');
const { Op } = require('sequelize');

/**
 * @route   POST /api/v1/search/advanced
 * @desc    高度な検索機能（複数条件、フィルタ、ソート対応）
 * @access  Private
 */
router.post('/advanced',
  authHybrid,
  [
    body('resource').isIn(['performers', 'users', 'auditLogs']).withMessage('無効なリソースです'),
    body('filters').optional().isObject(),
    body('sort').optional().isObject(),
    body('pagination.page').optional().isInt({ min: 1 }),
    body('pagination.limit').optional().isInt({ min: 1, max: 100 }),
    body('options.includeRelations').optional().isBoolean(),
    body('options.aggregations').optional().isArray()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      resource, 
      filters = {}, 
      sort = { field: 'createdAt', order: 'DESC' },
      pagination = { page: 1, limit: 20 },
      options = {}
    } = req.body;

    try {
      let Model;
      let searchableFields;
      let whereClause = {};
      let includeOptions = [];

      // リソースごとの設定
      switch (resource) {
        case 'performers':
          Model = Performer;
          searchableFields = ['lastName', 'firstName', 'lastNameRoman', 'firstNameRoman', 'notes'];
          
          // Performerフィルタ処理
          if (filters.status) {
            whereClause.status = Array.isArray(filters.status) ? 
              { [Op.in]: filters.status } : filters.status;
          }
          
          if (filters.dateRange) {
            whereClause.createdAt = {
              [Op.between]: [
                new Date(filters.dateRange.from),
                new Date(filters.dateRange.to)
              ]
            };
          }
          
          if (filters.documentStatus) {
            // JSON内の検索（MySQL JSON関数を使用）
            Object.entries(filters.documentStatus).forEach(([docType, status]) => {
              whereClause[Op.and] = whereClause[Op.and] || [];
              whereClause[Op.and].push(
                sequelize.literal(`JSON_EXTRACT(documents, '$."${docType}".verified') = ${status === 'verified'}`)
              );
            });
          }
          
          if (options.includeRelations) {
            includeOptions.push({
              model: User,
              as: 'creator',
              attributes: ['id', 'name', 'email']
            });
          }
          break;

        case 'users':
          // 管理者のみユーザー検索可能
          if (req.user.role !== 'admin') {
            return res.status(403).json({ 
              error: 'ユーザー検索には管理者権限が必要です' 
            });
          }
          
          Model = User;
          searchableFields = ['name', 'email'];
          
          if (filters.role) {
            whereClause.role = filters.role;
          }
          
          if (filters.authProvider) {
            whereClause.authProvider = filters.authProvider;
          }
          
          if (filters.emailVerified !== undefined) {
            whereClause.emailVerified = filters.emailVerified;
          }
          break;

        case 'auditLogs':
          // 管理者のみ監査ログ検索可能
          if (req.user.role !== 'admin') {
            return res.status(403).json({ 
              error: '監査ログ検索には管理者権限が必要です' 
            });
          }
          
          Model = AuditLog;
          searchableFields = ['userEmail', 'ipAddress'];
          
          if (filters.action) {
            whereClause.action = Array.isArray(filters.action) ? 
              { [Op.in]: filters.action } : filters.action;
          }
          
          if (filters.resourceType) {
            whereClause.resourceType = filters.resourceType;
          }
          
          if (filters.userId) {
            whereClause.userId = filters.userId;
          }
          
          if (filters.dateRange) {
            whereClause.createdAt = {
              [Op.between]: [
                new Date(filters.dateRange.from),
                new Date(filters.dateRange.to)
              ]
            };
          }
          
          if (options.includeRelations) {
            includeOptions.push({
              model: User,
              as: 'user',
              attributes: ['id', 'name', 'email']
            });
          }
          break;

        default:
          return res.status(400).json({ error: '無効なリソースです' });
      }

      // テキスト検索
      if (filters.searchText && searchableFields.length > 0) {
        const searchConditions = searchableFields.map(field => ({
          [field]: { [Op.like]: `%${filters.searchText}%` }
        }));
        
        whereClause[Op.or] = searchConditions;
      }

      // 高度なフィルタ（カスタム条件）
      if (filters.customWhere) {
        Object.assign(whereClause, filters.customWhere);
      }

      // ソート設定
      const orderClause = [];
      if (sort.field) {
        orderClause.push([sort.field, sort.order || 'ASC']);
      }
      
      // 複数ソート対応
      if (sort.secondary) {
        orderClause.push([sort.secondary.field, sort.secondary.order || 'ASC']);
      }

      // ページネーション計算
      const offset = (pagination.page - 1) * pagination.limit;

      // クエリ実行
      const result = await Model.findAndCountAll({
        where: whereClause,
        include: includeOptions,
        order: orderClause,
        limit: pagination.limit,
        offset,
        distinct: true // 正確なカウントのため
      });

      // 集計情報（オプション）
      let aggregations = {};
      if (options.aggregations && options.aggregations.length > 0) {
        aggregations = await performAggregations(Model, whereClause, options.aggregations);
      }

      // レスポンス構築
      const response = {
        success: true,
        data: result.rows,
        pagination: {
          total: result.count,
          page: pagination.page,
          limit: pagination.limit,
          totalPages: Math.ceil(result.count / pagination.limit),
          hasNext: pagination.page < Math.ceil(result.count / pagination.limit),
          hasPrev: pagination.page > 1
        },
        filters: {
          applied: filters,
          searchableFields
        },
        sort: {
          field: sort.field,
          order: sort.order
        }
      };

      if (Object.keys(aggregations).length > 0) {
        response.aggregations = aggregations;
      }

      // 検索履歴を記録（重要な検索のみ）
      if (resource === 'auditLogs' || (resource === 'users' && req.user.role === 'admin')) {
        await AuditLog.create({
          action: 'read',
          resourceType: 'search',
          resourceId: null,
          userId: req.user.id,
          userEmail: req.user.email,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          metadata: {
            searchType: 'advanced',
            resource,
            filters,
            resultCount: result.count
          }
        });
      }

      res.json(response);

    } catch (error) {
      console.error('高度検索エラー:', error);
      res.status(500).json({ 
        error: '検索に失敗しました',
        message: error.message 
      });
    }
  }
);

/**
 * @route   GET /api/v1/search/suggestions
 * @desc    検索候補の取得（オートコンプリート用）
 * @access  Private
 */
router.get('/suggestions',
  authHybrid,
  [
    query('resource').isIn(['performers', 'users']).withMessage('無効なリソースです'),
    query('field').notEmpty().withMessage('フィールドが必要です'),
    query('query').notEmpty().withMessage('検索クエリが必要です'),
    query('limit').optional().isInt({ min: 1, max: 20 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { resource, field, query: searchQuery, limit = 10 } = req.query;

    try {
      let Model;
      let allowedFields;

      switch (resource) {
        case 'performers':
          Model = Performer;
          allowedFields = ['lastName', 'firstName', 'lastNameRoman', 'firstNameRoman'];
          break;
        case 'users':
          if (req.user.role !== 'admin') {
            return res.status(403).json({ 
              error: '管理者権限が必要です' 
            });
          }
          Model = User;
          allowedFields = ['name', 'email'];
          break;
        default:
          return res.status(400).json({ error: '無効なリソースです' });
      }

      if (!allowedFields.includes(field)) {
        return res.status(400).json({ 
          error: '無効なフィールドです',
          allowedFields 
        });
      }

      // DISTINCT値を取得
      const suggestions = await Model.findAll({
        attributes: [[sequelize.fn('DISTINCT', sequelize.col(field)), field]],
        where: {
          [field]: { [Op.like]: `${searchQuery}%` }
        },
        order: [[field, 'ASC']],
        limit: parseInt(limit),
        raw: true
      });

      res.json({
        suggestions: suggestions.map(s => s[field]),
        field,
        count: suggestions.length
      });

    } catch (error) {
      console.error('検索候補取得エラー:', error);
      res.status(500).json({ 
        error: '検索候補の取得に失敗しました',
        message: error.message 
      });
    }
  }
);

/**
 * @route   POST /api/v1/search/export
 * @desc    検索結果のエクスポート
 * @access  Private (Admin only)
 */
router.post('/export',
  authHybrid,
  requireAdmin,
  [
    body('searchParams').isObject().withMessage('検索パラメータが必要です'),
    body('format').isIn(['csv', 'json', 'xlsx']).withMessage('無効な出力形式です'),
    body('fields').optional().isArray()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { searchParams, format, fields } = req.body;

    try {
      // 検索実行（上記の/advancedと同じロジック）
      // ... 検索ロジック ...

      // エクスポート形式に応じた処理
      switch (format) {
        case 'csv':
          // CSV生成処理
          break;
        case 'json':
          // JSON生成処理
          break;
        case 'xlsx':
          // Excel生成処理
          break;
      }

      // TODO: 実際のエクスポート実装
      res.json({
        message: 'エクスポート機能は実装予定です',
        format,
        searchParams
      });

    } catch (error) {
      console.error('エクスポートエラー:', error);
      res.status(500).json({ 
        error: 'エクスポートに失敗しました',
        message: error.message 
      });
    }
  }
);

/**
 * 集計処理ヘルパー関数
 */
async function performAggregations(Model, whereClause, aggregationRequests) {
  const results = {};

  for (const agg of aggregationRequests) {
    switch (agg.type) {
      case 'count':
        results[agg.name] = await Model.count({
          where: whereClause,
          distinct: agg.distinct || false,
          col: agg.field
        });
        break;

      case 'groupBy':
        const groupResult = await Model.findAll({
          where: whereClause,
          attributes: [
            agg.field,
            [sequelize.fn('COUNT', sequelize.col('id')), 'count']
          ],
          group: [agg.field],
          raw: true
        });
        results[agg.name] = groupResult;
        break;

      case 'dateHistogram':
        // 日付ヒストグラム（日/週/月単位）
        const interval = agg.interval || 'day';
        const dateFormat = interval === 'day' ? '%Y-%m-%d' : 
                          interval === 'week' ? '%Y-%u' : '%Y-%m';
        
        const histogramResult = await Model.findAll({
          where: whereClause,
          attributes: [
            [sequelize.fn('DATE_FORMAT', sequelize.col(agg.field), dateFormat), 'period'],
            [sequelize.fn('COUNT', sequelize.col('id')), 'count']
          ],
          group: ['period'],
          order: [['period', 'ASC']],
          raw: true
        });
        results[agg.name] = histogramResult;
        break;
    }
  }

  return results;
}

const { requireAdmin } = require('../../../middleware/auth-hybrid');

module.exports = router;