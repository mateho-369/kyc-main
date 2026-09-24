/**
 * Webhook統合ルート
 * 外部システムからのWebhookイベントを受信・処理
 */

const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const { authenticateToken } = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { verifyWebhookSignature } = require('../utils/webhookSignature');

// Webhookペイロードの生データを保持するためのミドルウェア
const captureRawBody = (req, res, next) => {
  let data = '';
  req.on('data', chunk => {
    data += chunk;
  });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
};

/**
 * @route   POST /api/webhooks/sharegram
 * @desc    Sharegramからのwebhookを受信
 * @access  Public (signature verification required)
 */
router.post('/sharegram',
  captureRawBody,
  verifyWebhookSignature('sharegram'),
  webhookController.handleSharegramWebhook
);

/**
 * @route   POST /api/webhooks/firebase
 * @desc    Firebaseからのwebhookを受信
 * @access  Public (signature verification required)
 */
router.post('/firebase',
  captureRawBody,
  verifyWebhookSignature('firebase'),
  webhookController.handleFirebaseWebhook
);

/**
 * @route   GET /api/webhooks/config
 * @desc    Webhook設定一覧を取得
 * @access  Private (Admin only)
 */
router.get('/config',
  authenticateToken,
  checkRole(['admin']),
  webhookController.getWebhookConfigs
);

/**
 * @route   POST /api/webhooks/config
 * @desc    新しいWebhook設定を作成
 * @access  Private (Admin only)
 */
router.post('/config',
  authenticateToken,
  checkRole(['admin']),
  webhookController.createWebhookConfig
);

/**
 * @route   PUT /api/webhooks/config/:configId
 * @desc    Webhook設定を更新
 * @access  Private (Admin only)
 */
router.put('/config/:configId',
  authenticateToken,
  checkRole(['admin']),
  webhookController.updateWebhookConfig
);

/**
 * @route   DELETE /api/webhooks/config/:configId
 * @desc    Webhook設定を削除
 * @access  Private (Admin only)
 */
router.delete('/config/:configId',
  authenticateToken,
  checkRole(['admin']),
  webhookController.deleteWebhookConfig
);

/**
 * @route   GET /api/webhooks/logs
 * @desc    Webhookログを取得
 * @access  Private (Admin only)
 */
router.get('/logs',
  authenticateToken,
  checkRole(['admin']),
  webhookController.getWebhookLogs
);

/**
 * @route   POST /api/webhooks/test/:configId
 * @desc    Webhook設定をテスト
 * @access  Private (Admin only)
 */
router.post('/test/:configId',
  authenticateToken,
  checkRole(['admin']),
  webhookController.testWebhook
);

/**
 * @route   POST /api/webhooks/retry/:logId
 * @desc    失敗したWebhookを再試行
 * @access  Private (Admin only)
 */
router.post('/retry/:logId',
  authenticateToken,
  checkRole(['admin']),
  webhookController.retryWebhook
);

/**
 * @route   GET /api/webhooks/stats
 * @desc    Webhook統計情報を取得
 * @access  Private (Admin only)
 */
router.get('/stats',
  authenticateToken,
  checkRole(['admin']),
  webhookController.getWebhookStats
);

/**
 * @route   POST /api/webhooks/batch-retry
 * @desc    複数の失敗したWebhookを一括再試行
 * @access  Private (Admin only)
 */
router.post('/batch-retry',
  authenticateToken,
  checkRole(['admin']),
  webhookController.batchRetryWebhooks
);

/**
 * @route   POST /webhooks/content-approved
 * @desc    外部システムからのコンテンツ承認通知を受信
 * @access  Public (with signature verification)
 */
router.post('/content-approved',
  captureRawBody,
  async (req, res, next) => {
    // カスタム署名検証
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    
    if (!signature || !timestamp) {
      return res.status(401).json({ error: 'Missing signature or timestamp' });
    }
    
    // タイムスタンプ検証
    const timeDiff = Math.abs(new Date() - new Date(timestamp));
    if (timeDiff > 5 * 60 * 1000) {
      return res.status(401).json({ error: 'Request timestamp too old' });
    }
    
    next();
  },
  async (req, res) => {
    try {
      const { Performer, AuditLog } = require('../models');
      const { EventDeliveryService } = require('../services/eventDeliveryService');
      
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
      
      // Performer検索
      const performer = await Performer.findOne({
        where: externalId ? { external_id: externalId } : { id: performerId }
      });
      
      if (!performer) {
        return res.status(404).json({ error: 'Performer not found' });
      }
      
      // メタデータ更新
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
        }
      };
      
      await performer.save();
      
      // 監査ログ
      await AuditLog.create({
        action: 'content_approved_webhook',
        resourceType: 'Performer',
        resourceId: performer.id,
        userId: null,
        userEmail: 'webhook@system',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: { contentId, contentType, approvalStatus }
      });
      
      // イベント配信
      await EventDeliveryService.dispatch('content.approved', {
        performer,
        contentId,
        contentType,
        approvalStatus,
        metadata
      });
      
      res.json({
        success: true,
        message: 'Content approval processed',
        performerId: performer.id
      });
      
    } catch (error) {
      console.error('Content approval webhook error:', error);
      res.status(500).json({ error: 'Processing failed' });
    }
  }
);

/**
 * @route   POST /webhooks/kyc-approved
 * @desc    外部システムからのKYC承認通知を受信
 * @access  Public (with signature verification)
 */
router.post('/kyc-approved',
  captureRawBody,
  async (req, res, next) => {
    // カスタム署名検証
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const secret = req.headers['x-webhook-secret'];
    
    if (!signature || !timestamp) {
      return res.status(401).json({ error: 'Missing signature or timestamp' });
    }
    
    // 署名検証（秘密鍵が提供されている場合）
    if (secret) {
      const { verifySignature } = require('../services/webhookService');
      const isValid = verifySignature(signature, req.body, secret);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
    
    // タイムスタンプ検証
    const timeDiff = Math.abs(new Date() - new Date(timestamp));
    if (timeDiff > 5 * 60 * 1000) {
      return res.status(401).json({ error: 'Request timestamp too old' });
    }
    
    next();
  },
  async (req, res) => {
    try {
      const { Performer, AuditLog } = require('../models');
      const { EventDeliveryService } = require('../services/eventDeliveryService');
      
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
      
      // Performer検索
      const performer = await Performer.findOne({
        where: externalId ? { external_id: externalId } : { id: performerId }
      });
      
      if (!performer) {
        return res.status(404).json({ error: 'Performer not found' });
      }
      
      // KYCステータス更新
      const previousKycStatus = performer.kycStatus;
      performer.kycStatus = kycStatus === 'approved' ? 'verified' : kycStatus;
      
      if (kycStatus === 'approved' || kycStatus === 'verified') {
        performer.kycVerifiedAt = verifiedAt || new Date();
        performer.kycExpiresAt = expiresAt || new Date(new Date().setFullYear(new Date().getFullYear() + 1));
      }
      
      if (riskScore !== undefined) {
        performer.riskScore = riskScore;
      }
      
      performer.kycMetadata = {
        ...performer.kycMetadata,
        verificationLevel,
        verificationDetails,
        documentsVerified: documents,
        webhookMetadata: metadata,
        lastKycUpdate: new Date()
      };
      
      await performer.save();
      
      // 監査ログ
      await AuditLog.create({
        action: 'kyc_approved_webhook',
        resourceType: 'Performer',
        resourceId: performer.id,
        userId: null,
        userEmail: 'webhook@system',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          previousKycStatus,
          newKycStatus: performer.kycStatus,
          verificationLevel,
          riskScore
        }
      });
      
      // イベント配信
      await EventDeliveryService.dispatch('kyc.approved', {
        performer,
        previousKycStatus,
        kycStatus: performer.kycStatus,
        verificationLevel,
        riskScore,
        documents,
        verificationDetails
      });
      
      res.json({
        success: true,
        message: 'KYC approval processed',
        performerId: performer.id,
        kycStatus: performer.kycStatus
      });
      
    } catch (error) {
      console.error('KYC approval webhook error:', error);
      res.status(500).json({ error: 'Processing failed' });
    }
  }
);

module.exports = router;