const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const { Performer, AuditLog } = require('../models');
const { Op } = require('sequelize');
const { sharegramAuth } = require('../middleware/sharegram-auth');

/**
 * Sharegram API専用 Performers エンドポイント
 * Bearer認証とX-API-Clientヘッダーによる認証をサポート
 */

// @route   GET /api/sharegram/performers
// @desc    Get performers for Sharegram (Bearer token authentication)
// @access  Sharegram API Key
router.get('/', sharegramAuth, async (req, res) => {
  const requestId = req.requestId || require('crypto').randomUUID();
  
  try {
    // クエリパラメータの取得
    const {
      page = 1,
      limit = 20,
      status = 'active',
      external_ids,
      user_id,
      search,
      sort = 'createdAt'
    } = req.query;
    
    // ページネーション設定
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit))); // 最大100件
    const offset = (pageNum - 1) * limitNum;
    
    // 検索条件の構築
    const whereClause = {};
    
    // ステータスフィルタリング
    if (status) {
      whereClause.status = status;
    }
    
    // user_idによるフィルタリング（特定ユーザーの出演者のみ取得）
    if (user_id) {
      whereClause.sharegramUserId = user_id;
    }

    // external_idsによるフィルタリング（Sharegramの場合）
    if (external_ids) {
      const ids = external_ids.split(',').map(id => id.trim()).filter(id => id);
      if (ids.length > 0) {
        whereClause.external_id = {
          [Op.in]: ids
        };
      }
    }
    
    // 検索キーワードによるフィルタリング
    if (search) {
      whereClause[Op.or] = [
        { lastName: { [Op.like]: `%${search}%` } },
        { firstName: { [Op.like]: `%${search}%` } },
        { lastNameRoman: { [Op.like]: `%${search}%` } },
        { firstNameRoman: { [Op.like]: `%${search}%` } },
        { external_id: { [Op.like]: `%${search}%` } }
      ];
    }
    
    // ソート順の設定
    let order = [['createdAt', 'DESC']]; // デフォルトは作成日の降順
    
    if (sort === 'updatedAt') {
      order = [['updatedAt', 'DESC']];
    } else if (sort === 'name') {
      order = [['lastName', 'ASC'], ['firstName', 'ASC']];
    } else if (sort === 'status') {
      order = [['status', 'ASC'], ['createdAt', 'DESC']];
    }
    
    // データ取得
    const { count, rows: performers } = await Performer.findAndCountAll({
      where: whereClause,
      order,
      limit: limitNum,
      offset,
      attributes: [
        'id',
        'external_id',
        'sharegramUserId',
        'lastName',
        'firstName',
        'lastNameRoman',
        'firstNameRoman',
        'status',
        'kycStatus',
        'kycVerifiedAt',
        'riskScore',
        'createdAt',
        'updatedAt',
        'lastSyncTime'
      ]
    });
    
    // ページネーション情報
    const totalPages = Math.ceil(count / limitNum);
    const pagination = {
      page: pageNum,
      limit: limitNum,
      total: count,
      totalPages,
      hasNext: pageNum < totalPages,
      hasPrev: pageNum > 1,
      nextPage: pageNum < totalPages ? pageNum + 1 : null,
      prevPage: pageNum > 1 ? pageNum - 1 : null
    };
    
    // 監査ログ記録（Sharegram API用）
    await AuditLog.create({
      userId: req.sharegramAuth?.userId || 0,
      action: 'sharegram_performers_list',
      resourceType: 'performer',
      resourceId: 0,
      details: { 
        query: req.query,
        resultCount: performers.length,
        apiClient: req.sharegramAuth?.apiClient,
        testMode: req.sharegramAuth?.testMode || false
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });
    
    // Sharegram API形式のレスポンス
    res.json({
      success: true,
      data: performers,
      pagination,
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        apiVersion: '1.0',
        source: 'kyc-system',
        testMode: req.sharegramAuth?.testMode || false
      }
    });
    
  } catch (error) {
    console.error('Sharegram performers API error:', error);
    
    // エラー監査ログ
    try {
      await AuditLog.create({
        userId: req.sharegramAuth?.userId || 0,
        action: 'sharegram_performers_error',
        resourceType: 'performer',
        resourceId: 0,
        details: { 
          error: error.message,
          query: req.query,
          apiClient: req.sharegramAuth?.apiClient
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    } catch (auditError) {
      console.error('Audit log error:', auditError);
    }
    
    res.status(500).json({
      error: '認証処理中にエラーが発生しました',
      errorId: require('crypto').randomUUID(),
      requestId,
      message: 'Internal server error occurred while processing request'
    });
  }
});

// @route   GET /api/sharegram/performers/:id
// @desc    Get specific performer by ID or external_id
// @access  Sharegram API Key
router.get('/:identifier', sharegramAuth, async (req, res) => {
  const requestId = req.requestId || require('crypto').randomUUID();
  
  try {
    const { identifier } = req.params;
    
    // IDまたはexternal_idで検索
    const whereClause = isNaN(identifier) 
      ? { external_id: identifier }
      : { 
          [Op.or]: [
            { id: parseInt(identifier) },
            { external_id: identifier }
          ]
        };
    
    const performer = await Performer.findOne({
      where: whereClause,
      attributes: [
        'id',
        'external_id',
        'sharegramUserId',
        'lastName',
        'firstName',
        'lastNameRoman',
        'firstNameRoman',
        'status',
        'kycStatus',
        'kycVerifiedAt',
        'kycExpiresAt',
        'riskScore',
        'kycMetadata',
        'documents',
        'createdAt',
        'updatedAt',
        'lastSyncTime'
      ]
    });
    
    if (!performer) {
      return res.status(404).json({
        success: false,
        error: 'Performer not found',
        message: 'The specified performer could not be found',
        requestId
      });
    }
    
    // 監査ログ記録
    await AuditLog.create({
      userId: req.sharegramAuth?.userId || 0,
      action: 'sharegram_performer_detail',
      resourceType: 'performer',
      resourceId: performer.id,
      details: { 
        identifier,
        external_id: performer.external_id,
        apiClient: req.sharegramAuth?.apiClient,
        testMode: req.sharegramAuth?.testMode || false
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });
    
    // ドキュメント情報の簡略化（プライバシー保護）
    const sanitizedPerformer = {
      ...performer.toJSON(),
      documents: performer.documents ? {
        agreementFile: !!performer.documents.agreementFile,
        idFront: !!performer.documents.idFront,
        idBack: !!performer.documents.idBack,
        selfie: !!performer.documents.selfie,
        selfieWithId: !!performer.documents.selfieWithId,
        verifiedCount: Object.values(performer.documents).filter(doc => doc?.verified).length
      } : null
    };
    
    res.json({
      success: true,
      data: sanitizedPerformer,
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        apiVersion: '1.0',
        source: 'kyc-system',
        testMode: req.sharegramAuth?.testMode || false
      }
    });
    
  } catch (error) {
    console.error('Sharegram performer detail API error:', error);
    
    res.status(500).json({
      error: '認証処理中にエラーが発生しました',
      errorId: require('crypto').randomUUID(),
      requestId,
      message: 'Internal server error occurred while processing request'
    });
  }
});

module.exports = router;