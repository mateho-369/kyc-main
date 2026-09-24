// KYC状態管理エンドポイント（CEO完全制覇ミッション）
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Performer, AuditLog, User } = require('../models');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

// インメモリキャッシュ（5分間）
const statusCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5分

// @route   GET /api/kyc/status/:id
// @desc    Get detailed KYC status for performer
// @access  Private
router.get('/status/:id', auth, async (req, res) => {
  try {
    const performerId = req.params.id;
    const cacheKey = `kyc_status_${performerId}_${req.user.id}`;

    // キャッシュチェック
    const cached = statusCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      return res.json({
        ...cached.data,
        cached: true,
        cacheTimestamp: new Date(cached.timestamp).toISOString()
      });
    }

    // パフォーマー検索
    const performer = await Performer.findByPk(performerId, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'email', 'name']
        }
      ]
    });

    if (!performer) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'PERFORMER_NOT_FOUND',
          message: '指定されたパフォーマーが見つかりません。'
        }
      });
    }

    // アクセス制御
    const isOwner = performer.userId === req.user.id;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isOwner && !isAdmin && !isManager) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'このパフォーマーのKYC状態にアクセスする権限がありません。'
        }
      });
    }

    // ドキュメント解析
    const documents = performer.documents ? JSON.parse(performer.documents) : {};
    const documentStatus = [];
    const requiredDocuments = [
      { type: 'agreementFile', name: '出演同意書', required: true },
      { type: 'idFront', name: '身分証明書（表面）', required: true },
      { type: 'idBack', name: '身分証明書（裏面）', required: true },
      { type: 'selfie', name: 'セルフィー', required: true },
      { type: 'selfieWithId', name: '身分証明書付きセルフィー', required: true }
    ];

    let totalRequired = 0;
    let completed = 0;
    let verified = 0;
    let pending = 0;
    let missing = 0;

    requiredDocuments.forEach(({ type, name, required }) => {
      if (required) totalRequired++;
      
      const doc = documents[type];
      if (doc) {
        completed++;
        if (doc.verified) {
          verified++;
        } else {
          pending++;
        }
        
        documentStatus.push({
          type,
          name,
          status: doc.verified ? 'verified' : 'pending',
          uploadedAt: doc.uploadedAt,
          verifiedAt: doc.verifiedAt,
          verifiedBy: doc.verifiedBy,
          fileSize: doc.size,
          mimeType: doc.mimeType
        });
      } else {
        missing++;
        documentStatus.push({
          type,
          name,
          status: 'missing',
          uploadedAt: null,
          verifiedAt: null,
          verifiedBy: null,
          fileSize: null,
          mimeType: null
        });
      }
    });

    // KYCステータス判定
    let kycStatus = 'incomplete';
    let kycStatusMessage = 'KYC手続きが未完了です。';
    let completionPercentage = Math.round((verified / totalRequired) * 100);

    if (missing === 0 && pending === 0 && verified === totalRequired) {
      kycStatus = 'completed';
      kycStatusMessage = 'KYC手続きが完了しています。';
    } else if (missing === 0 && verified > 0) {
      kycStatus = 'pending_review';
      kycStatusMessage = '書類審査中です。';
    } else if (completed > 0) {
      kycStatus = 'in_progress';
      kycStatusMessage = 'KYC手続きが進行中です。';
    }

    // 最近のアクティビティ（監査ログから）
    const recentActivity = await AuditLog.findAll({
      where: {
        targetId: performerId,
        targetType: 'Performer',
        action: {
          [Op.in]: [
            'DOCUMENT_UPLOAD', 
            'DOCUMENT_VERIFY', 
            'PERFORMER_UPDATE',
            'KYC_STATUS_UPDATE'
          ]
        }
      },
      order: [['createdAt', 'DESC']],
      limit: 10,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['name', 'email']
        }
      ]
    });

    // 次のステップ推奨
    const nextSteps = [];
    if (missing > 0) {
      nextSteps.push({
        action: 'upload_documents',
        message: `${missing}件の必須書類をアップロードしてください。`,
        priority: 'high'
      });
    }
    if (pending > 0) {
      nextSteps.push({
        action: 'wait_review',
        message: `${pending}件の書類が審査待ちです。`,
        priority: 'medium'
      });
    }
    if (kycStatus === 'completed' && performer.status !== 'active') {
      nextSteps.push({
        action: 'activate_account',
        message: 'アカウントの有効化が可能です。',
        priority: 'high'
      });
    }

    // レスポンスデータ構築
    const responseData = {
      success: true,
      data: {
        performerId: performer.id,
        externalId: performer.external_id,
        userId: performer.userId,
        user: isAdmin || isManager ? performer.user : undefined,
        
        // KYC概要
        kycOverview: {
          status: kycStatus,
          statusMessage: kycStatusMessage,
          completionPercentage: completionPercentage,
          lastUpdated: performer.updatedAt,
          
          // 統計
          statistics: {
            totalRequired: totalRequired,
            completed: completed,
            verified: verified,
            pending: pending,
            missing: missing
          }
        },

        // 詳細ドキュメント状態
        documents: documentStatus,

        // バッチアップロード情報
        batchUploads: documents.batchUploads || [],

        // 次のステップ
        nextSteps: nextSteps,

        // 最近のアクティビティ（管理者・マネージャーのみ）
        recentActivity: (isAdmin || isManager) ? recentActivity.map(activity => ({
          action: activity.action,
          timestamp: activity.createdAt,
          performer: activity.user ? {
            name: activity.user.name,
            email: activity.user.email
          } : null,
          details: activity.details
        })) : undefined,

        // メタデータ
        metadata: {
          generatedAt: new Date().toISOString(),
          userRole: req.user.role,
          accessLevel: isOwner ? 'owner' : (isAdmin ? 'admin' : 'manager')
        }
      }
    };

    // キャッシュ保存
    statusCache.set(cacheKey, {
      data: responseData,
      timestamp: Date.now()
    });

    // 監査ログ記録
    await AuditLog.create({
      userId: req.user.id,
      action: 'KYC_STATUS_VIEW',
      targetId: performer.id,
      targetType: 'Performer',
      details: {
        performerId: performer.id,
        requestedBy: req.user.email,
        kycStatus: kycStatus,
        completionPercentage: completionPercentage
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json(responseData);

  } catch (error) {
    console.error('KYC状態取得エラー:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'KYC_STATUS_ERROR',
        message: 'KYC状態の取得中にエラーが発生しました。'
      }
    });
  }
});

// @route   PUT /api/kyc/status/:id
// @desc    Update KYC status (Admin only)
// @access  Private (Admin)
router.put('/status/:id', auth, checkRole(['admin']), async (req, res) => {
  try {
    const performerId = req.params.id;
    const { 
      status,
      notes,
      documentsToVerify = [],
      sendNotification = true
    } = req.body;

    // バリデーション
    const allowedStatuses = ['pending', 'in_progress', 'completed', 'rejected', 'suspended'];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: `無効なステータスです。許可されている値: ${allowedStatuses.join(', ')}`
        }
      });
    }

    const performer = await Performer.findByPk(performerId);
    if (!performer) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'PERFORMER_NOT_FOUND',
          message: '指定されたパフォーマーが見つかりません。'
        }
      });
    }

    // 更新データ準備
    const updateData = {};
    if (status) {
      updateData.kycStatus = status;
      updateData.kycUpdatedAt = new Date();
      updateData.kycUpdatedBy = req.user.id;
    }

    // ドキュメント検証更新
    if (documentsToVerify.length > 0) {
      const documents = performer.documents ? JSON.parse(performer.documents) : {};
      
      documentsToVerify.forEach(docType => {
        if (documents[docType]) {
          documents[docType].verified = true;
          documents[docType].verifiedAt = new Date().toISOString();
          documents[docType].verifiedBy = req.user.id;
        }
      });
      
      updateData.documents = JSON.stringify(documents);
    }

    // KYCメタデータ更新
    const existingMetadata = performer.kycMetadata ? JSON.parse(performer.kycMetadata) : {};
    updateData.kycMetadata = JSON.stringify({
      ...existingMetadata,
      lastStatusUpdate: new Date().toISOString(),
      updatedBy: req.user.email,
      notes: notes || existingMetadata.notes,
      statusHistory: [
        ...(existingMetadata.statusHistory || []),
        {
          status: status,
          timestamp: new Date().toISOString(),
          updatedBy: req.user.email,
          notes: notes
        }
      ]
    });

    // パフォーマー更新
    await performer.update(updateData);

    // キャッシュクリア
    for (const [key] of statusCache) {
      if (key.includes(`kyc_status_${performerId}_`)) {
        statusCache.delete(key);
      }
    }

    // 監査ログ記録
    await AuditLog.create({
      userId: req.user.id,
      action: 'KYC_STATUS_UPDATE',
      targetId: performer.id,
      targetType: 'Performer',
      details: {
        performerId: performer.id,
        oldStatus: performer.kycStatus,
        newStatus: status,
        documentsVerified: documentsToVerify,
        notes: notes,
        updatedBy: req.user.email
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'KYC状態が正常に更新されました。',
      data: {
        performerId: performer.id,
        status: status,
        updatedAt: new Date().toISOString(),
        documentsVerified: documentsToVerify.length,
        updatedBy: {
          id: req.user.id,
          email: req.user.email
        }
      }
    });

  } catch (error) {
    console.error('KYC状態更新エラー:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'KYC_STATUS_UPDATE_ERROR',
        message: 'KYC状態の更新中にエラーが発生しました。'
      }
    });
  }
});

module.exports = router;