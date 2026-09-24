// KYC承認Webhook専用エンドポイント（CEOミッション緊急実装）
const express = require('express');
const router = express.Router();
const { Performer, AuditLog } = require('../../models');
const { EventDeliveryService } = require('../../services/EventDeliveryService');

// @route   POST /api/webhooks/kyc-approved
// @desc    KYC承認通知Webhook
// @access  Public (署名検証)
router.post('/kyc-approved', async (req, res, next) => {
  try {
    const {
      performer_id,
      external_id,
      approved_by,
      approved_at,
      approval_status = 'approved',
      documents = [],
      metadata = {}
    } = req.body;

    // 必須パラメータ検証
    if (!performer_id && !external_id) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PERFORMER_ID',
          message: 'performer_id または external_id が必要です。'
        }
      });
    }

    // 出演者検索
    let performer;
    if (performer_id) {
      performer = await Performer.findByPk(performer_id);
    } else if (external_id) {
      performer = await Performer.findOne({
        where: { external_id: external_id }
      });
    }

    if (!performer) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'PERFORMER_NOT_FOUND',
          message: '指定された出演者が見つかりません。'
        }
      });
    }

    // KYC承認処理
    const updateData = {
      status: approval_status === 'approved' ? 'active' : 'rejected',
      kycStatus: approval_status,
      kycApprovedAt: approved_at ? new Date(approved_at) : new Date(),
      kycApprovedBy: approved_by || 'external_system'
    };

    // ドキュメント情報更新
    if (documents.length > 0) {
      const existingDocs = performer.documents ? JSON.parse(performer.documents) : {};
      documents.forEach(doc => {
        if (existingDocs[doc.type]) {
          existingDocs[doc.type].verified = true;
          existingDocs[doc.type].verifiedAt = approved_at || new Date().toISOString();
          existingDocs[doc.type].verifiedBy = approved_by || 'external_system';
        }
      });
      updateData.documents = JSON.stringify(existingDocs);
    }

    // メタデータ更新
    if (Object.keys(metadata).length > 0) {
      const existingMetadata = performer.kycMetadata ? JSON.parse(performer.kycMetadata) : {};
      updateData.kycMetadata = JSON.stringify({
        ...existingMetadata,
        ...metadata,
        webhookReceivedAt: new Date().toISOString()
      });
    }

    // 出演者情報更新
    await performer.update(updateData);

    // 監査ログ記録
    await AuditLog.create({
      userId: null, // 外部システムからの通知
      action: 'KYC_WEBHOOK_RECEIVED',
      targetId: performer.id,
      targetType: 'Performer',
      details: {
        performerId: performer.id,
        externalId: external_id,
        approvalStatus: approval_status,
        approvedBy: approved_by,
        approvedAt: approved_at,
        documentsCount: documents.length,
        webhookSource: 'external_kyc_system'
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    // イベント配信（内部システム用）
    try {
      await EventDeliveryService.dispatch('performer.kyc.approved', {
        performerId: performer.id,
        externalId: external_id,
        status: approval_status,
        approvedBy: approved_by,
        approvedAt: approved_at,
        documents: documents
      });
    } catch (eventError) {
      console.error('Event delivery error:', eventError);
      // イベント配信エラーは致命的ではないので続行
    }

    // 成功レスポンス
    res.json({
      success: true,
      message: 'KYC承認通知を正常に処理しました',
      data: {
        performerId: performer.id,
        externalId: external_id,
        status: approval_status,
        updatedAt: new Date().toISOString(),
        processedDocuments: documents.length
      }
    });

  } catch (error) {
    console.error('KYC Webhook処理エラー:', error);
    
    // 監査ログ（エラー）
    try {
      await AuditLog.create({
        userId: null,
        action: 'KYC_WEBHOOK_ERROR',
        targetId: null,
        targetType: 'Webhook',
        details: {
          error: error.message,
          requestBody: req.body,
          stack: error.stack
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
    } catch (logError) {
      console.error('監査ログ記録エラー:', logError);
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'KYC_WEBHOOK_ERROR',
        message: 'KYC承認通知の処理中にエラーが発生しました。'
      }
    });
  }
});

module.exports = router;