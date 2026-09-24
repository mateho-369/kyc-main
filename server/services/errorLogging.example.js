/**
 * Error Logging Service Usage Examples
 * エラーロギングサービスの使用例
 */

const {
  errorLogger,
  ErrorCategories,
  ErrorTags,
  logError,
  expressErrorHandler,
  updateAlertThreshold,
  registerAlertHandler,
  info,
  warning,
  error,
  critical,
  alert
} = require('./errorLogging');

// ========================================
// 基本的な使用例
// ========================================

// 1. シンプルなエラーログ
try {
  // 何かの処理
  throw new Error('Something went wrong');
} catch (err) {
  logError(err, { 
    userId: 123, 
    action: 'user_registration' 
  });
}

// 2. カテゴリ別ログ
info('User logged in successfully', { userId: 123 });
warning('API rate limit approaching', { remaining: 10 });
error('Database connection failed', { host: 'localhost' });
critical('Payment processing failed', { orderId: 'ORD-123' });
alert('Security breach detected', { ip: '192.168.1.1' });

// ========================================
// Express統合
// ========================================

const express = require('express');
const app = express();

// エラーハンドラーの登録（最後に追加）
app.use(expressErrorHandler());

// ========================================
// カスタムエラークラス
// ========================================

class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = 'UNAUTHORIZED';
    this.statusCode = 401;
  }
}

class ValidationError extends Error {
  constructor(message, fields) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'INVALID_INPUT';
    this.statusCode = 400;
    this.fields = fields;
  }
}

class ExternalAPIError extends Error {
  constructor(message, service) {
    super(message);
    this.name = 'ExternalAPIError';
    this.service = service;
    this.statusCode = 502;
    this.retryable = true;
  }
}

// 使用例
try {
  throw new AuthenticationError('Invalid token');
} catch (err) {
  const result = logError(err, { endpoint: '/api/users' });
  console.log('Error classified as:', result.category); // 'authentication'
  console.log('Tags:', result.tags); // ['security', 'user_action']
}

// ========================================
// アラート設定のカスタマイズ
// ========================================

// 認証エラーのアラート閾値を変更（10分間に20回）
updateAlertThreshold(ErrorCategories.AUTHENTICATION, 20, 600000);

// KYCエラーは即座にアラート
updateAlertThreshold(ErrorCategories.KYC, 1, 0);

// カスタムアラートハンドラーの追加
registerAlertHandler('slack', async (alertData) => {
  // Slack通知の実装
  console.log('Sending Slack notification:', alertData);
  
  // 実際のSlack Webhook実装例
  /*
  const axios = require('axios');
  await axios.post(process.env.SLACK_WEBHOOK_URL, {
    text: `🚨 Error Alert: ${alertData.key}`,
    attachments: [{
      color: 'danger',
      fields: [
        { title: 'Error', value: alertData.error.message },
        { title: 'Count', value: alertData.count },
        { title: 'Environment', value: alertData.environment }
      ]
    }]
  });
  */
});

// メール通知ハンドラー
registerAlertHandler('email', async (alertData) => {
  console.log('Sending email alert:', alertData);
  
  // 実際のメール送信実装例
  /*
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({...});
  
  await transporter.sendMail({
    from: 'REPLACE_WITH_ACTUAL_ADDRESS',
    to: 'REPLACE_WITH_ACTUAL_ADDRESS',
    subject: `Error Alert: ${alertData.key}`,
    html: `
      <h2>Error Alert</h2>
      <p>Category/Tag: ${alertData.key}</p>
      <p>Error: ${alertData.error.message}</p>
      <p>Count: ${alertData.count}</p>
      <p>Time: ${alertData.timestamp}</p>
    `
  });
  */
});

// ========================================
// 実際のアプリケーションでの使用例
// ========================================

// Webhook処理でのエラーログ
async function handleWebhook(req, res) {
  try {
    // Webhook処理
    const result = await processWebhook(req.body);
    res.json({ success: true, result });
  } catch (err) {
    // エラーにWebhook固有の情報を追加
    err.webhookType = req.headers['x-webhook-event'];
    err.webhookId = req.headers['x-webhook-id'];
    
    logError(err, {
      req,
      webhookPayload: req.body,
      processingTime: Date.now() - req.startTime
    });
    
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// KYC検証でのエラーログ
async function verifyKYC(performerId) {
  try {
    const result = await kycService.verify(performerId);
    info('KYC verification successful', { performerId, result });
    return result;
  } catch (err) {
    // KYCエラーは重要なのでより詳細な情報を記録
    err.performerId = performerId;
    err.kycProvider = 'external-provider';
    
    const logResult = logError(err, {
      action: 'kyc_verification',
      performerId,
      attemptNumber: 1,
      criticalPath: true // クリティカルパスタグを確実に付ける
    });
    
    // KYCエラーは再試行可能な場合がある
    if (logResult.tags.includes(ErrorTags.RETRY_ABLE)) {
      // 再試行ロジック
      console.log('Retrying KYC verification...');
    }
    
    throw err;
  }
}

// データベーストランザクションでのエラーログ
async function createPerformerWithDocuments(data) {
  const transaction = await sequelize.transaction();
  
  try {
    const performer = await Performer.create(data, { transaction });
    await Document.bulkCreate(data.documents, { transaction });
    
    await transaction.commit();
    info('Performer created with documents', { 
      performerId: performer.id,
      documentCount: data.documents.length 
    });
    
    return performer;
  } catch (err) {
    await transaction.rollback();
    
    // トランザクションエラーの詳細ログ
    logError(err, {
      action: 'create_performer_with_documents',
      data: { 
        performerName: data.name,
        documentCount: data.documents?.length 
      },
      transactionId: transaction.id
    });
    
    throw err;
  }
}

// ========================================
// エラー統計の取得
// ========================================

// 過去1時間のエラー統計を取得
setInterval(() => {
  const stats = errorLogger.getErrorStats(3600000); // 1時間
  console.log('Error statistics (last hour):', stats);
  
  // 統計に基づくアクション
  if (stats[ErrorCategories.DATABASE] > 50) {
    alert('High database error rate detected', { stats });
  }
}, 300000); // 5分ごとにチェック

// ========================================
// 環境別設定
// ========================================

// 本番環境では詳細なエラー情報を隠す
if (process.env.NODE_ENV === 'production') {
  // 本番環境用の設定
  updateAlertThreshold(ErrorCategories.AUTHENTICATION, 50, 300000);
  updateAlertThreshold(ErrorCategories.DATABASE, 10, 60000);
} else {
  // 開発環境用の設定（より敏感に）
  updateAlertThreshold(ErrorCategories.AUTHENTICATION, 5, 300000);
  updateAlertThreshold(ErrorCategories.DATABASE, 3, 60000);
}

module.exports = {
  AuthenticationError,
  ValidationError,
  ExternalAPIError
};