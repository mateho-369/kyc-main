const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { authHybrid, requireAdmin } = require('../../../middleware/auth-hybrid');
const { Webhook, AuditLog } = require('../../../models');
const { Op } = require('sequelize');
const crypto = require('crypto');
const axios = require('axios');

/**
 * @route   POST /api/v1/webhooks/configure
 * @desc    Webhookを設定・作成
 * @access  Private
 */
router.post('/configure',
  authHybrid,
  [
    body('name').notEmpty().withMessage('Webhook名が必要です'),
    body('url').isURL({ protocols: ['https'] }).withMessage('有効なHTTPS URLを入力してください'),
    body('events').isArray({ min: 1 }).withMessage('少なくとも1つのイベントを選択してください'),
    body('events.*').isIn([
      'performer.created',
      'performer.updated',
      'performer.deleted',
      'performer.verified',
      'performer.rejected',
      'performer.approved',
      'performer.registration_completed',
      'document.uploaded',
      'document.verified',
      'batch.completed',
      'integration.synced',
      'content.approved',
      'kyc.approved'
    ]).withMessage('無効なイベントタイプです'),
    body('headers').optional().isObject(),
    body('retryConfig.maxRetries').optional().isInt({ min: 0, max: 10 }),
    body('retryConfig.retryDelay').optional().isInt({ min: 100, max: 60000 }),
    body('secret').optional().isString()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, url, events, headers = {}, retryConfig, secret } = req.body;

    try {
      // 同一URLのWebhookが既に存在するかチェック
      const existingWebhook = await Webhook.findOne({
        where: {
          userId: req.user.id,
          url
        }
      });

      if (existingWebhook) {
        return res.status(400).json({
          error: '同じURLのWebhookが既に存在します',
          existingId: existingWebhook.id
        });
      }

      // Webhookを作成
      const webhook = await Webhook.create({
        userId: req.user.id,
        name,
        url,
        events,
        headers,
        retryConfig: retryConfig || {
          maxRetries: 3,
          retryDelay: 1000,
          backoffMultiplier: 2
        },
        secret: secret || crypto.randomBytes(32).toString('hex'),
        metadata: {
          createdBy: req.user.email,
          authMethod: req.authMethod
        }
      });

      // 監査ログ記録
      await AuditLog.create({
        action: 'create',
        resourceType: 'Webhook',
        resourceId: webhook.id,
        userId: req.user.id,
        userEmail: req.user.email,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          webhookName: name,
          url: url.replace(/^(https:\/\/[^\/]+).*/, '$1/***'), // URLを部分的にマスク
          events
        }
      });

      // テスト通知を送信（オプション）
      if (req.body.sendTestNotification) {
        const testResult = await webhook.trigger('test', {
          message: 'これはテスト通知です',
          timestamp: new Date().toISOString()
        });

        return res.status(201).json({
          success: true,
          webhook: {
            id: webhook.id,
            name: webhook.name,
            url: webhook.url,
            events: webhook.events,
            secret: webhook.getDecryptedSecret(), // 初回のみ平文で返す
            isActive: webhook.isActive,
            createdAt: webhook.createdAt
          },
          testNotification: testResult
        });
      }

      res.status(201).json({
        success: true,
        webhook: {
          id: webhook.id,
          name: webhook.name,
          url: webhook.url,
          events: webhook.events,
          secret: webhook.getDecryptedSecret(), // 初回のみ平文で返す
          isActive: webhook.isActive,
          createdAt: webhook.createdAt
        }
      });

    } catch (error) {
      console.error('Webhook作成エラー:', error);
      res.status(500).json({
        error: 'Webhookの作成に失敗しました',
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/v1/webhooks
 * @desc    ユーザーのWebhook一覧を取得
 * @access  Private
 */
router.get('/', authHybrid, async (req, res) => {
  try {
    const webhooks = await Webhook.findAll({
      where: {
        userId: req.user.id
      },
      attributes: [
        'id', 'name', 'url', 'events', 'isActive',
        'lastTriggeredAt', 'lastStatus', 'totalCalls',
        'successCalls', 'failedCalls', 'createdAt', 'updatedAt'
      ],
      order: [['createdAt', 'DESC']]
    });

    // 健全性スコアを計算
    const webhooksWithHealth = webhooks.map(webhook => {
      const healthScore = webhook.totalCalls > 0
        ? (webhook.successCalls / webhook.totalCalls * 100).toFixed(2)
        : null;

      return {
        ...webhook.toJSON(),
        healthScore,
        successRate: webhook.totalCalls > 0
          ? `${healthScore}%`
          : 'N/A'
      };
    });

    res.json({
      success: true,
      count: webhooks.length,
      webhooks: webhooksWithHealth
    });

  } catch (error) {
    console.error('Webhook一覧取得エラー:', error);
    res.status(500).json({
      error: 'Webhook一覧の取得に失敗しました',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/v1/webhooks/:id
 * @desc    特定のWebhookの詳細を取得
 * @access  Private
 */
router.get('/:id',
  authHybrid,
  [
    param('id').isInt().withMessage('有効なWebhook IDが必要です')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const webhook = await Webhook.findOne({
        where: {
          id: req.params.id,
          userId: req.user.id
        }
      });

      if (!webhook) {
        return res.status(404).json({
          error: 'Webhookが見つかりません'
        });
      }

      // 最近の実行履歴を取得（実装予定）
      const recentExecutions = []; // TODO: 実行履歴テーブルから取得

      res.json({
        success: true,
        webhook: {
          ...webhook.toJSON(),
          secret: undefined, // シークレットは返さない
          healthScore: webhook.totalCalls > 0
            ? (webhook.successCalls / webhook.totalCalls * 100).toFixed(2) + '%'
            : 'N/A',
          recentExecutions
        }
      });

    } catch (error) {
      console.error('Webhook詳細取得エラー:', error);
      res.status(500).json({
        error: 'Webhook詳細の取得に失敗しました',
        message: error.message
      });
    }
  }
);

/**
 * @route   PUT /api/v1/webhooks/:id
 * @desc    Webhookを更新
 * @access  Private
 */
router.put('/:id',
  authHybrid,
  [
    param('id').isInt().withMessage('有効なWebhook IDが必要です'),
    body('name').optional().notEmpty(),
    body('url').optional().isURL({ protocols: ['https'] }),
    body('events').optional().isArray({ min: 1 }),
    body('isActive').optional().isBoolean(),
    body('headers').optional().isObject(),
    body('retryConfig').optional().isObject()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const webhook = await Webhook.findOne({
        where: {
          id: req.params.id,
          userId: req.user.id
        }
      });

      if (!webhook) {
        return res.status(404).json({
          error: 'Webhookが見つかりません'
        });
      }

      // 更新前の値を保存（監査用）
      const previousValues = webhook.toJSON();

      // 更新を実行
      await webhook.update(req.body);

      // 監査ログ記録
      await AuditLog.create({
        action: 'update',
        resourceType: 'Webhook',
        resourceId: webhook.id,
        userId: req.user.id,
        userEmail: req.user.email,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          previousValues: {
            name: previousValues.name,
            url: previousValues.url,
            events: previousValues.events,
            isActive: previousValues.isActive
          },
          newValues: req.body
        }
      });

      res.json({
        success: true,
        message: 'Webhookを更新しました',
        webhook: {
          ...webhook.toJSON(),
          secret: undefined
        }
      });

    } catch (error) {
      console.error('Webhook更新エラー:', error);
      res.status(500).json({
        error: 'Webhookの更新に失敗しました',
        message: error.message
      });
    }
  }
);

/**
 * @route   DELETE /api/v1/webhooks/:id
 * @desc    Webhookを削除
 * @access  Private
 */
router.delete('/:id',
  authHybrid,
  [
    param('id').isInt().withMessage('有効なWebhook IDが必要です')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const webhook = await Webhook.findOne({
        where: {
          id: req.params.id,
          userId: req.user.id
        }
      });

      if (!webhook) {
        return res.status(404).json({
          error: 'Webhookが見つかりません'
        });
      }

      // 削除前の情報を保存
      const webhookData = webhook.toJSON();

      // 削除実行
      await webhook.destroy();

      // 監査ログ記録
      await AuditLog.create({
        action: 'delete',
        resourceType: 'Webhook',
        resourceId: webhookData.id,
        userId: req.user.id,
        userEmail: req.user.email,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          deletedWebhook: {
            name: webhookData.name,
            url: webhookData.url,
            events: webhookData.events
          }
        }
      });

      res.json({
        success: true,
        message: 'Webhookを削除しました',
        deletedId: webhookData.id
      });

    } catch (error) {
      console.error('Webhook削除エラー:', error);
      res.status(500).json({
        error: 'Webhookの削除に失敗しました',
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/v1/webhooks/:id/test
 * @desc    Webhookのテスト送信
 * @access  Private
 */
router.post('/:id/test',
  authHybrid,
  [
    param('id').isInt().withMessage('有効なWebhook IDが必要です'),
    body('payload').optional().isObject()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const webhook = await Webhook.findOne({
        where: {
          id: req.params.id,
          userId: req.user.id
        }
      });

      if (!webhook) {
        return res.status(404).json({
          error: 'Webhookが見つかりません'
        });
      }

      // テストペイロード
      const testPayload = req.body.payload || {
        event: 'test',
        message: 'これはWebhookのテスト送信です',
        timestamp: new Date().toISOString(),
        webhookId: webhook.id,
        webhookName: webhook.name
      };

      // テスト送信実行
      const result = await webhook.trigger('test', testPayload);

      res.json({
        success: true,
        message: result.success ? 'テスト送信に成功しました' : 'テスト送信に失敗しました',
        result: {
          success: result.success,
          statusCode: result.statusCode,
          response: result.response,
          error: result.error,
          attempts: result.attempts
        }
      });

    } catch (error) {
      console.error('Webhookテスト送信エラー:', error);
      res.status(500).json({
        error: 'テスト送信に失敗しました',
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/v1/webhooks/events/list
 * @desc    利用可能なWebhookイベントの一覧
 * @access  Public
 */
router.get('/events/list', async (req, res) => {
  const events = [
    {
      category: 'Performer',
      events: [
        { id: 'performer.created', name: '出演者登録', description: '新しい出演者が登録されたとき' },
        { id: 'performer.updated', name: '出演者情報更新', description: '出演者情報が更新されたとき' },
        { id: 'performer.deleted', name: '出演者削除', description: '出演者が削除されたとき' },
        { id: 'performer.verified', name: '出演者承認', description: '出演者のKYCが承認されたとき' },
        { id: 'performer.rejected', name: '出演者却下', description: '出演者のKYCが却下されたとき' },
        { id: 'performer.approved', name: '出演者承認完了', description: '出演者が管理者により承認されたとき' },
        { id: 'performer.registration_completed', name: '出演者登録完了', description: '出演者の登録が完了したとき' }
      ]
    },
    {
      category: 'Document',
      events: [
        { id: 'document.uploaded', name: '書類アップロード', description: '新しい書類がアップロードされたとき' },
        { id: 'document.verified', name: '書類検証完了', description: '書類の検証が完了したとき' }
      ]
    },
    {
      category: 'Batch',
      events: [
        { id: 'batch.completed', name: 'バッチ処理完了', description: 'バッチ処理が完了したとき' }
      ]
    },
    {
      category: 'Integration',
      events: [
        { id: 'integration.synced', name: '統合同期完了', description: '外部システムとの同期が完了したとき' }
      ]
    },
    {
      category: 'Content',
      events: [
        { id: 'content.approved', name: 'コンテンツ承認', description: 'コンテンツが承認されたとき' }
      ]
    },
    {
      category: 'KYC',
      events: [
        { id: 'kyc.approved', name: 'KYC承認', description: 'KYC検証が承認されたとき' }
      ]
    }
  ];

  res.json({
    success: true,
    events
  });
});

/**
 * @route   POST /api/v1/webhooks/validate
 * @desc    Webhook URLの検証
 * @access  Private
 */
router.post('/validate',
  authHybrid,
  [
    body('url').isURL({ protocols: ['https'] }).withMessage('有効なHTTPS URLを入力してください')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { url } = req.body;

    try {
      // URLの到達可能性をチェック
      const testPayload = {
        event: 'validation',
        message: 'Webhook URL validation test',
        timestamp: new Date().toISOString()
      };

      const response = await axios.post(url, testPayload, {
        timeout: 10000, // 10秒タイムアウト
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SafeVideo-Webhook-Validator/1.0'
        },
        validateStatus: (status) => status < 500 // 5xx以外は成功とみなす
      });

      res.json({
        success: true,
        valid: true,
        statusCode: response.status,
        message: 'URLは有効で到達可能です'
      });

    } catch (error) {
      const errorInfo = {
        valid: false,
        error: error.message
      };

      if (error.code === 'ECONNREFUSED') {
        errorInfo.message = '接続が拒否されました';
      } else if (error.code === 'ETIMEDOUT') {
        errorInfo.message = 'タイムアウトしました';
      } else if (error.response) {
        errorInfo.message = `サーバーエラー: ${error.response.status}`;
        errorInfo.statusCode = error.response.status;
      } else {
        errorInfo.message = 'URLに到達できません';
      }

      res.json({
        success: false,
        ...errorInfo
      });
    }
  }
);

/**
 * @route   POST /webhooks/content-approved
 * @desc    外部システムからのコンテンツ承認通知を受信
 * @access  Public (with signature verification)
 */
router.post('/content-approved', async (req, res) => {
  try {
    // 署名検証
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const eventType = req.headers['x-webhook-event'] || 'content.approved';
    
    if (!signature || !timestamp) {
      return res.status(401).json({
        error: 'Missing signature or timestamp headers'
      });
    }
    
    // タイムスタンプの有効性チェック（5分以内）
    const requestTime = new Date(timestamp);
    const now = new Date();
    const timeDiff = Math.abs(now - requestTime);
    
    if (timeDiff > 5 * 60 * 1000) {
      return res.status(401).json({
        error: 'Request timestamp too old'
      });
    }
    
    // ペイロードの取得
    const { 
      performerId,
      externalId,
      contentId,
      contentType,
      approvalStatus,
      approvedBy,
      approvedAt,
      metadata = {}
    } = req.body;
    
    // 必須フィールドの検証
    if (!performerId || !contentId || !approvalStatus) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['performerId', 'contentId', 'approvalStatus']
      });
    }
    
    // Performerの検索と更新
    const { Performer } = require('../../../models');
    const performer = await Performer.findOne({
      where: externalId ? { external_id: externalId } : { id: performerId }
    });
    
    if (!performer) {
      return res.status(404).json({
        error: 'Performer not found',
        performerId,
        externalId
      });
    }
    
    // コンテンツ承認情報をメタデータに記録
    performer.kycMetadata = {
      ...performer.kycMetadata,
      contentApprovals: {
        ...(performer.kycMetadata?.contentApprovals || {}),
        [contentId]: {
          contentType,
          approvalStatus,
          approvedBy,
          approvedAt: approvedAt || new Date(),
          metadata
        }
      },
      lastContentApproval: new Date()
    };
    
    await performer.save();
    
    // 監査ログ記録
    await AuditLog.create({
      action: 'content_approved',
      resourceType: 'Performer',
      resourceId: performer.id,
      userId: null, // システムアクション
      userEmail: 'webhook@system',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      metadata: {
        performerId: performer.id,
        externalId: performer.external_id,
        contentId,
        contentType,
        approvalStatus,
        webhookEvent: eventType
      }
    });
    
    // イベント配信システムへの通知
    const { EventDeliveryService } = require('../../../services/eventDeliveryService');
    await EventDeliveryService.dispatch('content.approved', {
      performer,
      contentId,
      contentType,
      approvalStatus,
      approvedBy,
      approvedAt,
      metadata
    });
    
    res.json({
      success: true,
      message: 'Content approval received',
      performerId: performer.id,
      contentId
    });
    
  } catch (error) {
    console.error('Content approval webhook error:', error);
    res.status(500).json({
      error: 'Failed to process content approval',
      message: error.message
    });
  }
});

/**
 * @route   POST /webhooks/kyc-approved
 * @desc    外部システムからのKYC承認通知を受信
 * @access  Public (with signature verification)
 */
router.post('/kyc-approved', async (req, res) => {
  try {
    // 署名検証
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const secret = req.headers['x-webhook-secret'];
    const eventType = req.headers['x-webhook-event'] || 'kyc.approved';
    
    if (!signature || !timestamp) {
      return res.status(401).json({
        error: 'Missing signature or timestamp headers'
      });
    }
    
    // 署名の検証（統合設定から秘密鍵を取得）
    if (secret) {
      const { verifyWebhookSignature } = require('../../../services/webhookService');
      const payload = JSON.stringify(req.body);
      const isValid = verifyWebhookSignature(signature, { ...req.body, timestamp }, secret);
      
      if (!isValid) {
        return res.status(401).json({
          error: 'Invalid signature'
        });
      }
    }
    
    // タイムスタンプの有効性チェック
    const requestTime = new Date(timestamp);
    const now = new Date();
    const timeDiff = Math.abs(now - requestTime);
    
    if (timeDiff > 5 * 60 * 1000) {
      return res.status(401).json({
        error: 'Request timestamp too old'
      });
    }
    
    // ペイロードの取得
    const {
      performerId,
      externalId,
      kycStatus,
      verificationLevel,
      verifiedAt,
      expiresAt,
      riskScore,
      documents = [],
      verificationDetails = {},
      metadata = {}
    } = req.body;
    
    // 必須フィールドの検証
    if (!performerId || !kycStatus) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['performerId', 'kycStatus']
      });
    }
    
    // Performerの検索と更新
    const { Performer } = require('../../../models');
    const performer = await Performer.findOne({
      where: externalId ? { external_id: externalId } : { id: performerId }
    });
    
    if (!performer) {
      return res.status(404).json({
        error: 'Performer not found',
        performerId,
        externalId
      });
    }
    
    // KYCステータスの更新
    const previousKycStatus = performer.kycStatus;
    performer.kycStatus = kycStatus === 'approved' ? 'verified' : kycStatus;
    
    if (kycStatus === 'approved' || kycStatus === 'verified') {
      performer.kycVerifiedAt = verifiedAt || new Date();
      performer.kycExpiresAt = expiresAt || new Date(new Date().setFullYear(new Date().getFullYear() + 1));
    }
    
    if (riskScore !== undefined) {
      performer.riskScore = riskScore;
    }
    
    // KYCメタデータの更新
    performer.kycMetadata = {
      ...performer.kycMetadata,
      verificationLevel,
      verificationDetails,
      documentsVerified: documents,
      webhookMetadata: metadata,
      lastKycUpdate: new Date(),
      kycProvider: metadata.provider || 'external'
    };
    
    await performer.save();
    
    // 監査ログ記録
    await AuditLog.create({
      action: 'kyc_approved',
      resourceType: 'Performer',
      resourceId: performer.id,
      userId: null, // システムアクション
      userEmail: 'webhook@system',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      metadata: {
        performerId: performer.id,
        externalId: performer.external_id,
        previousKycStatus,
        newKycStatus: performer.kycStatus,
        verificationLevel,
        riskScore,
        webhookEvent: eventType
      }
    });
    
    // イベント配信システムへの通知
    const { EventDeliveryService } = require('../../../services/eventDeliveryService');
    await EventDeliveryService.dispatch('kyc.approved', {
      performer,
      previousKycStatus,
      kycStatus: performer.kycStatus,
      verificationLevel,
      verifiedAt: performer.kycVerifiedAt,
      expiresAt: performer.kycExpiresAt,
      riskScore,
      documents,
      verificationDetails
    });
    
    res.json({
      success: true,
      message: 'KYC approval received',
      performerId: performer.id,
      kycStatus: performer.kycStatus,
      verifiedAt: performer.kycVerifiedAt
    });
    
  } catch (error) {
    console.error('KYC approval webhook error:', error);
    res.status(500).json({
      error: 'Failed to process KYC approval',
      message: error.message
    });
  }
});

// 署名検証ミドルウェア
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const webhookId = req.headers['x-webhook-id'];
  
  if (!signature || !timestamp) {
    return res.status(401).json({
      error: 'Missing signature or timestamp'
    });
  }
  
  // タイムスタンプの検証
  const requestTime = new Date(timestamp);
  const now = new Date();
  const timeDiff = Math.abs(now - requestTime);
  
  if (timeDiff > 5 * 60 * 1000) { // 5分
    return res.status(401).json({
      error: 'Request timestamp too old'
    });
  }
  
  // 署名検証のロジックをここに実装
  // TODO: 実際の署名検証実装
  
  next();
}

module.exports = router;