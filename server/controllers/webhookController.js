/**
 * Webhookコントローラー
 * 外部システムからのWebhookイベントの受信、処理、管理
 */

const { Webhook, Performer, KYCRequest, ApiLog } = require('../models');
const { processWebhookEvent } = require('../services/webhookService');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

/**
 * Sharegramからのwebhookを処理
 */
const handleSharegramWebhook = async (req, res, next) => {
  const webhookId = uuidv4();
  
  try {
    // Webhookイベントをログに記録
    const webhookLog = await Webhook.create({
      id: webhookId,
      source: 'sharegram',
      eventType: req.body.event,
      payload: JSON.stringify(req.body),
      status: 'processing',
      receivedAt: new Date()
    });

    // 即座にレスポンスを返す（非同期処理）
    res.status(200).json({ 
      success: true, 
      webhookId,
      message: 'Webhook received and queued for processing'
    });

    // バックグラウンドで処理
    processSharegramEvent(webhookLog, req.body).catch(error => {
      console.error('Error processing Sharegram webhook:', error);
      webhookLog.status = 'failed';
      webhookLog.errorMessage = error.message;
      webhookLog.save();
    });

  } catch (error) {
    console.error('Error handling Sharegram webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process webhook' 
    });
  }
};

/**
 * Firebaseからのwebhookを処理
 */
const handleFirebaseWebhook = async (req, res, next) => {
  const webhookId = uuidv4();
  
  try {
    // Webhookイベントをログに記録
    const webhookLog = await Webhook.create({
      id: webhookId,
      source: 'firebase',
      eventType: req.body.type,
      payload: JSON.stringify(req.body),
      status: 'processing',
      receivedAt: new Date()
    });

    // 即座にレスポンスを返す
    res.status(200).json({ 
      success: true, 
      webhookId,
      message: 'Webhook received and queued for processing'
    });

    // バックグラウンドで処理
    processFirebaseEvent(webhookLog, req.body).catch(error => {
      console.error('Error processing Firebase webhook:', error);
      webhookLog.status = 'failed';
      webhookLog.errorMessage = error.message;
      webhookLog.save();
    });

  } catch (error) {
    console.error('Error handling Firebase webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process webhook' 
    });
  }
};

/**
 * Sharegramイベントを処理する非同期関数
 */
const processSharegramEvent = async (webhookLog, payload) => {
  try {
    const { event, data } = payload;

    switch (event) {
      case 'performer.created':
        await handlePerformerCreated(data);
        break;
      
      case 'performer.updated':
        await handlePerformerUpdated(data);
        break;
      
      case 'kyc.submitted':
        await handleKYCSubmitted(data);
        break;
      
      case 'kyc.approved':
      case 'kyc.verification.completed':
        await handleKYCApproved(data);
        break;
      
      case 'kyc.rejected':
      case 'kyc.verification.failed':
        await handleKYCRejected(data);
        break;
      
      case 'kyc.verification.pending':
        await handleKYCPending(data);
        break;
      
      case 'performer.status.updated':
        await handlePerformerStatusUpdated(data);
        break;
      
      case 'performer.risk.assessment':
        await handlePerformerRiskAssessment(data);
        break;
      
      case 'performer.document.uploaded':
      case 'document.uploaded':
        await handleDocumentUploaded(data);
        break;
      
      default:
        console.log(`Unhandled Sharegram event: ${event}`);
        // 未対応イベントのログ記録
        await ApiLog.create({
          method: 'WEBHOOK',
          path: '/webhooks/sharegram',
          requestBody: { event, data },
          responseStatus: 200,
          responseBody: { message: 'Unhandled event type' },
          errorMessage: `Unhandled event type: ${event}`,
          metadata: {
            service: 'sharegram_webhook',
            eventType: event,
            webhookId: webhookLog.id
          }
        });
    }

    webhookLog.status = 'completed';
    webhookLog.processedAt = new Date();
    await webhookLog.save();

  } catch (error) {
    throw error;
  }
};

/**
 * Firebaseイベントを処理する非同期関数
 */
const processFirebaseEvent = async (webhookLog, payload) => {
  try {
    const { type, data } = payload;

    switch (type) {
      case 'user.created':
        await handleFirebaseUserCreated(data);
        break;
      
      case 'user.updated':
        await handleFirebaseUserUpdated(data);
        break;
      
      case 'user.deleted':
        await handleFirebaseUserDeleted(data);
        break;
      
      case 'auth.revoked':
        await handleAuthRevoked(data);
        break;
      
      default:
        console.log(`Unhandled Firebase event: ${type}`);
    }

    webhookLog.status = 'completed';
    webhookLog.processedAt = new Date();
    await webhookLog.save();

  } catch (error) {
    throw error;
  }
};

/**
 * イベントハンドラー：パフォーマー作成
 */
const handlePerformerCreated = async (data) => {
  const { performerId, email, name } = data;
  
  // ローカルDBに同期
  await Performer.findOrCreate({
    where: { externalId: performerId },
    defaults: {
      externalId: performerId,
      email,
      name,
      source: 'sharegram',
      syncStatus: 'synced',
      lastSyncAt: new Date()
    }
  });
};

/**
 * イベントハンドラー：パフォーマー更新
 */
const handlePerformerUpdated = async (data) => {
  const { performerId, updates } = data;
  
  const performer = await Performer.findOne({
    where: { externalId: performerId }
  });
  
  if (performer) {
    await performer.update({
      ...updates,
      lastSyncAt: new Date()
    });
  }
};

/**
 * イベントハンドラー：KYC提出
 */
const handleKYCSubmitted = async (data) => {
  const { performerId, kycRequestId, documents } = data;
  
  await KYCRequest.create({
    externalId: kycRequestId,
    performerId,
    status: 'submitted',
    documents: JSON.stringify(documents),
    submittedAt: new Date()
  });
};

/**
 * イベントハンドラー：KYC承認/検証完了
 */
const handleKYCApproved = async (data) => {
  const { 
    kycRequestId, 
    performerId, 
    verificationId,
    approvedBy, 
    approvedAt, 
    verifiedAt,
    kycStatus = 'verified',
    riskScore,
    verificationLevel,
    documents = [],
    verificationDetails = {}
  } = data;
  
  try {
    // KYCリクエストの更新（存在する場合）
    if (kycRequestId) {
      const kycRequest = await KYCRequest.findOne({
        where: { externalId: kycRequestId }
      });
      
      if (kycRequest) {
        await kycRequest.update({
          status: 'approved',
          approvedBy,
          approvedAt: approvedAt || verifiedAt
        });
      }
    }
    
    // パフォーマーの更新
    const whereClause = performerId 
      ? { external_id: performerId }
      : kycRequestId 
        ? { id: (await KYCRequest.findOne({ where: { externalId: kycRequestId } }))?.performerId }
        : null;
    
    if (whereClause) {
      const performer = await Performer.findOne({ where: whereClause });
      
      if (performer) {
        const updateData = {
          kycStatus: kycStatus === 'approved' ? 'verified' : kycStatus,
          kycVerifiedAt: verifiedAt || approvedAt || new Date(),
          lastSyncTime: new Date(),
          syncSource: 'sharegram'
        };
        
        if (riskScore !== undefined) {
          updateData.riskScore = riskScore;
        }
        
        updateData.kycMetadata = {
          ...performer.kycMetadata,
          sharegramVerificationId: verificationId,
          verificationLevel,
          verificationDetails,
          documentsVerified: documents,
          lastKYCUpdate: new Date().toISOString(),
          verificationSource: 'sharegram',
          approvedBy
        };
        
        await performer.update(updateData);
        
        console.log(`KYC approved for performer: ${performer.external_id || performer.id}`);
      } else {
        console.warn(`Performer not found for KYC approval: ${JSON.stringify(whereClause)}`);
      }
    }
  } catch (error) {
    console.error('Error handling KYC approval:', error);
    throw error;
  }
};

/**
 * イベントハンドラー：KYC却下/検証失敗
 */
const handleKYCRejected = async (data) => {
  const { 
    kycRequestId, 
    performerId,
    verificationId,
    reason, 
    failureReason,
    rejectedBy, 
    rejectedAt,
    rejectionDetails = {}
  } = data;
  
  try {
    // KYCリクエストの更新（存在する場合）
    if (kycRequestId) {
      const kycRequest = await KYCRequest.findOne({
        where: { externalId: kycRequestId }
      });
      
      if (kycRequest) {
        await kycRequest.update({
          status: 'rejected',
          rejectionReason: reason || failureReason,
          rejectedBy,
          rejectedAt
        });
      }
    }
    
    // パフォーマーの更新
    const whereClause = performerId 
      ? { external_id: performerId }
      : kycRequestId 
        ? { id: (await KYCRequest.findOne({ where: { externalId: kycRequestId } }))?.performerId }
        : null;
    
    if (whereClause) {
      const performer = await Performer.findOne({ where: whereClause });
      
      if (performer) {
        await performer.update({
          kycStatus: 'rejected',
          lastSyncTime: new Date(),
          syncSource: 'sharegram',
          kycMetadata: {
            ...performer.kycMetadata,
            sharegramVerificationId: verificationId,
            rejectionReason: reason || failureReason,
            rejectionDetails,
            lastKYCUpdate: new Date().toISOString(),
            verificationSource: 'sharegram',
            rejectedBy
          }
        });
        
        console.log(`KYC rejected for performer: ${performer.external_id || performer.id} - Reason: ${reason || failureReason}`);
      } else {
        console.warn(`Performer not found for KYC rejection: ${JSON.stringify(whereClause)}`);
      }
    }
  } catch (error) {
    console.error('Error handling KYC rejection:', error);
    throw error;
  }
};

/**
 * イベントハンドラー：KYC検証保留
 */
const handleKYCPending = async (data) => {
  const { performerId, verificationId, additionalInfo, pendingReason } = data;
  
  try {
    const performer = await Performer.findOne({
      where: { external_id: performerId }
    });
    
    if (performer) {
      await performer.update({
        kycStatus: 'pending',
        lastSyncTime: new Date(),
        syncSource: 'sharegram',
        kycMetadata: {
          ...performer.kycMetadata,
          sharegramVerificationId: verificationId,
          pendingReason,
          additionalInfo,
          lastKYCUpdate: new Date().toISOString(),
          verificationSource: 'sharegram'
        }
      });
      
      console.log(`KYC pending for performer: ${performer.external_id} - Reason: ${pendingReason}`);
    }
  } catch (error) {
    console.error('Error handling KYC pending:', error);
    throw error;
  }
};

/**
 * イベントハンドラー：パフォーマーステータス更新
 */
const handlePerformerStatusUpdated = async (data) => {
  const { performerId, status, updatedAt, metadata = {} } = data;
  
  try {
    const performer = await Performer.findOne({
      where: { external_id: performerId }
    });
    
    if (performer) {
      await performer.update({
        status: status,
        lastSyncTime: new Date(updatedAt),
        syncSource: 'sharegram',
        kycMetadata: {
          ...performer.kycMetadata,
          lastStatusUpdate: new Date().toISOString(),
          statusSource: 'sharegram',
          statusMetadata: metadata
        }
      });
      
      console.log(`Status updated for performer: ${performer.external_id} - New status: ${status}`);
    }
  } catch (error) {
    console.error('Error handling performer status update:', error);
    throw error;
  }
};

/**
 * イベントハンドラー：リスクアセスメント
 */
const handlePerformerRiskAssessment = async (data) => {
  const { performerId, riskScore, riskFactors, assessmentDate, metadata = {} } = data;
  
  try {
    const performer = await Performer.findOne({
      where: { external_id: performerId }
    });
    
    if (performer) {
      await performer.update({
        riskScore: riskScore,
        lastSyncTime: new Date(),
        syncSource: 'sharegram',
        kycMetadata: {
          ...performer.kycMetadata,
          riskFactors: riskFactors,
          lastRiskAssessment: new Date(assessmentDate).toISOString(),
          riskAssessmentSource: 'sharegram',
          riskMetadata: metadata
        }
      });
      
      console.log(`Risk assessment updated for performer: ${performer.external_id} - Score: ${riskScore}`);
    }
  } catch (error) {
    console.error('Error handling risk assessment:', error);
    throw error;
  }
};

/**
 * イベントハンドラー：ドキュメントアップロード
 */
const handleDocumentUploaded = async (data) => {
  const { performerId, documentType, documentUrl, uploadedAt, metadata = {} } = data;
  
  try {
    const performer = await Performer.findOne({
      where: { external_id: performerId }
    });
    
    if (performer) {
      // ドキュメント情報を更新
      const updatedDocuments = {
        ...performer.documents,
        [documentType]: {
          url: documentUrl,
          uploadedAt: new Date(uploadedAt).toISOString(),
          source: 'sharegram',
          metadata
        }
      };
      
      await performer.update({
        documents: updatedDocuments,
        lastSyncTime: new Date(),
        syncSource: 'sharegram',
        kycMetadata: {
          ...performer.kycMetadata,
          lastDocumentUpdate: new Date().toISOString()
        }
      });
      
      console.log(`Document uploaded for performer: ${performer.external_id} - Type: ${documentType}`);
    }
  } catch (error) {
    console.error('Error handling document upload:', error);
    throw error;
  }
};

/**
 * イベントハンドラー：Firebaseユーザー作成
 */
const handleFirebaseUserCreated = async (data) => {
  console.log('Firebase user created:', data);
};

/**
 * イベントハンドラー：Firebaseユーザー更新
 */
const handleFirebaseUserUpdated = async (data) => {
  console.log('Firebase user updated:', data);
};

/**
 * イベントハンドラー：Firebaseユーザー削除
 */
const handleFirebaseUserDeleted = async (data) => {
  console.log('Firebase user deleted:', data);
};

/**
 * イベントハンドラー：認証取り消し
 */
const handleAuthRevoked = async (data) => {
  console.log('Auth revoked:', data);
};

/**
 * Webhook設定一覧を取得
 */
const getWebhookConfigs = async (req, res, next) => {
  try {
    const configs = await Webhook.findAll({
      where: { type: 'config' },
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: configs
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 新しいWebhook設定を作成
 */
const createWebhookConfig = async (req, res, next) => {
  try {
    const { name, url, events, headers, active = true } = req.body;

    const config = await Webhook.create({
      type: 'config',
      name,
      url,
      events: JSON.stringify(events),
      headers: JSON.stringify(headers),
      active,
      secret: uuidv4() // Webhook署名用のシークレット
    });

    res.status(201).json({
      success: true,
      data: config
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Webhook設定を更新
 */
const updateWebhookConfig = async (req, res, next) => {
  try {
    const { configId } = req.params;
    const updates = req.body;

    const config = await Webhook.findByPk(configId);
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Webhook config not found'
      });
    }

    await config.update(updates);

    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Webhook設定を削除
 */
const deleteWebhookConfig = async (req, res, next) => {
  try {
    const { configId } = req.params;

    const config = await Webhook.findByPk(configId);
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Webhook config not found'
      });
    }

    await config.destroy();

    res.json({
      success: true,
      message: 'Webhook config deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Webhookログを取得
 */
const getWebhookLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, status, source } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = { type: { [Op.ne]: 'config' } };
    if (status) whereClause.status = status;
    if (source) whereClause.source = source;

    const { count, rows } = await Webhook.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['receivedAt', 'DESC']]
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Webhook設定をテスト
 */
const testWebhook = async (req, res, next) => {
  try {
    const { configId } = req.params;
    const { testPayload } = req.body;

    const config = await Webhook.findByPk(configId);
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Webhook config not found'
      });
    }

    // テストリクエストを送信
    const response = await axios.post(config.url, testPayload, {
      headers: JSON.parse(config.headers || '{}'),
      timeout: 10000
    });

    res.json({
      success: true,
      data: {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data
      }
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
};

/**
 * 失敗したWebhookを再試行
 */
const retryWebhook = async (req, res, next) => {
  try {
    const { logId } = req.params;

    const webhookLog = await Webhook.findByPk(logId);
    
    if (!webhookLog) {
      return res.status(404).json({
        success: false,
        error: 'Webhook log not found'
      });
    }

    if (webhookLog.status !== 'failed') {
      return res.status(400).json({
        success: false,
        error: 'Can only retry failed webhooks'
      });
    }

    // 再試行処理
    webhookLog.status = 'retrying';
    webhookLog.retryCount = (webhookLog.retryCount || 0) + 1;
    await webhookLog.save();

    // バックグラウンドで再処理
    const payload = JSON.parse(webhookLog.payload);
    if (webhookLog.source === 'sharegram') {
      processSharegramEvent(webhookLog, payload);
    } else if (webhookLog.source === 'firebase') {
      processFirebaseEvent(webhookLog, payload);
    }

    res.json({
      success: true,
      message: 'Webhook retry initiated',
      webhookId: logId
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Webhook統計情報を取得
 */
const getWebhookStats = async (req, res, next) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await Webhook.findAll({
      attributes: [
        'source',
        'status',
        [Webhook.sequelize.fn('COUNT', Webhook.sequelize.col('id')), 'count']
      ],
      where: {
        receivedAt: { [Op.gte]: startDate },
        type: { [Op.ne]: 'config' }
      },
      group: ['source', 'status']
    });

    const eventStats = await Webhook.findAll({
      attributes: [
        'eventType',
        [Webhook.sequelize.fn('COUNT', Webhook.sequelize.col('id')), 'count']
      ],
      where: {
        receivedAt: { [Op.gte]: startDate },
        type: { [Op.ne]: 'config' }
      },
      group: ['eventType']
    });

    res.json({
      success: true,
      data: {
        statusBySource: stats,
        eventTypes: eventStats,
        dateRange: {
          from: startDate,
          to: new Date(),
          days
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 複数の失敗したWebhookを一括再試行
 */
const batchRetryWebhooks = async (req, res, next) => {
  try {
    const { webhookIds } = req.body;

    if (!Array.isArray(webhookIds) || webhookIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of webhook IDs'
      });
    }

    const webhooks = await Webhook.findAll({
      where: {
        id: webhookIds,
        status: 'failed'
      }
    });

    const retryResults = [];

    for (const webhook of webhooks) {
      webhook.status = 'retrying';
      webhook.retryCount = (webhook.retryCount || 0) + 1;
      await webhook.save();

      const payload = JSON.parse(webhook.payload);
      
      // バックグラウンドで再処理
      if (webhook.source === 'sharegram') {
        processSharegramEvent(webhook, payload);
      } else if (webhook.source === 'firebase') {
        processFirebaseEvent(webhook, payload);
      }

      retryResults.push({
        id: webhook.id,
        status: 'retry_initiated'
      });
    }

    res.json({
      success: true,
      data: retryResults,
      summary: {
        requested: webhookIds.length,
        retried: retryResults.length,
        skipped: webhookIds.length - retryResults.length
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  handleSharegramWebhook,
  handleFirebaseWebhook,
  getWebhookConfigs,
  createWebhookConfig,
  updateWebhookConfig,
  deleteWebhookConfig,
  getWebhookLogs,
  testWebhook,
  retryWebhook,
  getWebhookStats,
  batchRetryWebhooks
};