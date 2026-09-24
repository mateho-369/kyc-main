const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const checkRole = require('../../middleware/checkRole');
const { Performer, AuditLog } = require('../../models');
const { triggerWebhook } = require('../../services/webhookService');

// @route   POST /api/performers/:id/approve
// @desc    Approve a performer registration
// @access  Private (Admin only)
router.post('/:id/approve', [auth, checkRole(['admin'])], async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ message: '出演者情報が見つかりません' });
    }
    
    // 既に承認済みの場合
    if (performer.status === 'active') {
      return res.status(400).json({ message: 'この出演者は既に承認されています' });
    }
    
    // ステータスを承認済みに更新
    const previousStatus = performer.status;
    performer.status = 'active';
    
    // KYCステータスも更新（必要に応じて）
    if (performer.kycStatus === 'in_progress') {
      performer.kycStatus = 'verified';
      performer.kycVerifiedAt = new Date();
      // KYC有効期限を1年後に設定
      const expirationDate = new Date();
      expirationDate.setFullYear(expirationDate.getFullYear() + 1);
      performer.kycExpiresAt = expirationDate;
    }
    
    await performer.save();
    
    // 監査ログ記録
    await AuditLog.create({
      userId: req.user.id,
      action: 'approve',
      resourceType: 'performer',
      resourceId: performer.id,
      details: {
        previousStatus,
        newStatus: 'active',
        performerName: `${performer.lastName} ${performer.firstName}`,
        kycStatus: performer.kycStatus
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });
    
    // Webhook通知をトリガー
    try {
      await triggerWebhook('performer.approved', {
        performerId: performer.id,
        externalId: performer.external_id,
        sharegramUserId: performer.sharegramUserId,
        name: `${performer.lastName} ${performer.firstName}`,
        nameRoman: `${performer.firstNameRoman} ${performer.lastNameRoman}`,
        approvedAt: new Date(),
        approvedBy: req.user.id,
        kycStatus: performer.kycStatus,
        kycVerifiedAt: performer.kycVerifiedAt,
        kycExpiresAt: performer.kycExpiresAt
      });
    } catch (webhookError) {
      console.error('Webhook通知エラー:', webhookError);
      // Webhookエラーはレスポンスには影響させない
    }
    
    res.json({
      message: '出演者が承認されました',
      performer: {
        id: performer.id,
        lastName: performer.lastName,
        firstName: performer.firstName,
        lastNameRoman: performer.lastNameRoman,
        firstNameRoman: performer.firstNameRoman,
        status: performer.status,
        kycStatus: performer.kycStatus,
        kycVerifiedAt: performer.kycVerifiedAt,
        kycExpiresAt: performer.kycExpiresAt,
        external_id: performer.external_id
      }
    });
  } catch (err) {
    console.error('出演者承認エラー:', err);
    res.status(500).json({ 
      message: '出演者の承認に失敗しました', 
      error: err.message 
    });
  }
});

// @route   POST /api/performers/:id/registration-complete
// @desc    Mark performer registration as complete
// @access  Private
router.post('/:id/registration-complete', auth, async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ message: '出演者情報が見つかりません' });
    }
    
    // ユーザーロールの場合、自分が登録したデータのみアクセス可能
    if (req.user.role === 'user' && performer.userId !== req.user.id) {
      return res.status(403).json({ message: 'このデータへのアクセス権限がありません' });
    }
    
    // 必須ドキュメントの確認
    const documents = performer.documents || {};
    const requiredDocs = ['agreementFile', 'idFront', 'selfie'];
    const missingDocs = requiredDocs.filter(doc => !documents[doc]);
    
    if (missingDocs.length > 0) {
      return res.status(400).json({ 
        message: '必須書類が不足しています',
        missingDocuments: missingDocs,
        required: ['agreementFile (許諾書)', 'idFront (身分証明書表面)', 'selfie (本人写真)']
      });
    }
    
    // 既に登録完了している場合
    if (performer.kycMetadata?.registrationCompletedAt) {
      return res.status(400).json({ 
        message: '既に登録が完了しています',
        completedAt: performer.kycMetadata.registrationCompletedAt
      });
    }
    
    // KYCステータスを更新
    const previousKycStatus = performer.kycStatus;
    if (performer.kycStatus === 'not_started') {
      performer.kycStatus = 'in_progress';
    }
    
    // メタデータに登録完了時刻を記録
    performer.kycMetadata = {
      ...performer.kycMetadata,
      registrationCompletedAt: new Date(),
      registrationCompletedBy: req.user.id,
      registrationCompletedByEmail: req.user.email
    };
    
    await performer.save();
    
    // 監査ログ記録
    await AuditLog.create({
      userId: req.user.id,
      action: 'complete_registration',
      resourceType: 'performer',
      resourceId: performer.id,
      details: {
        performerName: `${performer.lastName} ${performer.firstName}`,
        previousKycStatus,
        newKycStatus: performer.kycStatus,
        documentsSubmitted: Object.keys(documents)
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });
    
    // Webhook通知をトリガー
    try {
      await triggerWebhook('performer.registration_completed', {
        performerId: performer.id,
        externalId: performer.external_id,
        sharegramUserId: performer.sharegramUserId,
        name: `${performer.lastName} ${performer.firstName}`,
        nameRoman: `${performer.firstNameRoman} ${performer.lastNameRoman}`,
        completedAt: new Date(),
        userId: req.user.id,
        userEmail: req.user.email,
        kycStatus: performer.kycStatus,
        documents: Object.keys(documents)
      });
    } catch (webhookError) {
      console.error('Webhook通知エラー:', webhookError);
      // Webhookエラーはレスポンスには影響させない
    }
    
    res.json({
      message: '登録が完了しました',
      performer: {
        id: performer.id,
        lastName: performer.lastName,
        firstName: performer.firstName,
        lastNameRoman: performer.lastNameRoman,
        firstNameRoman: performer.firstNameRoman,
        status: performer.status,
        kycStatus: performer.kycStatus,
        registrationCompletedAt: performer.kycMetadata.registrationCompletedAt,
        external_id: performer.external_id
      }
    });
  } catch (err) {
    console.error('登録完了エラー:', err);
    res.status(500).json({ 
      message: '登録完了処理に失敗しました', 
      error: err.message 
    });
  }
});

module.exports = router;