/**
 * Webhook署名検証ユーティリティ
 * 外部システムからのWebhookリクエストの署名を検証
 */

const crypto = require('crypto');

/**
 * Webhook署名検証設定
 */
const WEBHOOK_SECRETS = {
  sharegram: process.env.SHAREGRAM_WEBHOOK_SECRET || 'sharegram-webhook-secret',
  firebase: process.env.FIREBASE_WEBHOOK_SECRET || 'firebase-webhook-secret'
};

/**
 * HMAC署名を生成
 * @param {string} secret - シークレットキー
 * @param {string} payload - ペイロード文字列
 * @returns {string} HMAC署名
 */
const generateSignature = (secret, payload) => {
  return crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
};

/**
 * Sharegram署名を検証
 * @param {string} signature - リクエストヘッダーの署名
 * @param {string} payload - リクエストボディ
 * @returns {boolean} 検証結果
 */
const verifySharegramSignature = (signature, payload) => {
  const secret = WEBHOOK_SECRETS.sharegram;
  const expectedSignature = `sha256=${generateSignature(secret, payload)}`;
  
  // タイミング攻撃を防ぐためにcrypto.timingSafeEqualを使用
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

/**
 * Firebase署名を検証
 * @param {string} signature - リクエストヘッダーの署名
 * @param {string} payload - リクエストボディ
 * @returns {boolean} 検証結果
 */
const verifyFirebaseSignature = (signature, payload) => {
  const secret = WEBHOOK_SECRETS.firebase;
  
  // Firebaseは異なる署名形式を使用する可能性があるため、
  // 実際の実装に合わせて調整が必要
  const expectedSignature = generateSignature(secret, payload);
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

/**
 * Webhook署名検証ミドルウェア
 * @param {string} source - Webhookソース（'sharegram' | 'firebase'）
 * @returns {Function} Expressミドルウェア
 */
const verifyWebhookSignature = (source) => {
  return (req, res, next) => {
    try {
      let signature;
      let isValid = false;

      switch (source) {
        case 'sharegram':
          // Sharegramは 'X-Sharegram-Signature' ヘッダーを使用
          signature = req.headers['x-sharegram-signature'];
          if (signature && req.rawBody) {
            isValid = verifySharegramSignature(signature, req.rawBody);
          }
          break;

        case 'firebase':
          // Firebaseは 'X-Firebase-Signature' ヘッダーを使用
          signature = req.headers['x-firebase-signature'];
          if (signature && req.rawBody) {
            isValid = verifyFirebaseSignature(signature, req.rawBody);
          }
          break;

        default:
          return res.status(400).json({
            success: false,
            error: 'Unknown webhook source'
          });
      }

      // 開発環境では署名検証をスキップするオプション
      if (process.env.NODE_ENV === 'development' && process.env.SKIP_WEBHOOK_VERIFICATION === 'true') {
        console.warn(`Skipping webhook signature verification for ${source} in development mode`);
        return next();
      }

      if (!signature) {
        return res.status(401).json({
          success: false,
          error: 'Missing webhook signature'
        });
      }

      if (!isValid) {
        console.error(`Invalid webhook signature for ${source}`);
        return res.status(401).json({
          success: false,
          error: 'Invalid webhook signature'
        });
      }

      // 署名が有効な場合、次のミドルウェアへ
      next();

    } catch (error) {
      console.error('Error verifying webhook signature:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify webhook signature'
      });
    }
  };
};

/**
 * Webhookペイロードのタイムスタンプを検証
 * リプレイ攻撃を防ぐため
 * @param {number} timestamp - Webhookタイムスタンプ
 * @param {number} maxAge - 最大許容時間（秒）
 * @returns {boolean} 検証結果
 */
const verifyTimestamp = (timestamp, maxAge = 300) => {
  const currentTime = Math.floor(Date.now() / 1000);
  const webhookTime = Math.floor(timestamp);
  
  return Math.abs(currentTime - webhookTime) <= maxAge;
};

/**
 * Webhookリクエストの完全性を検証
 * @param {Object} req - Expressリクエストオブジェクト
 * @param {string} source - Webhookソース
 * @returns {Object} 検証結果
 */
const validateWebhookRequest = (req, source) => {
  const errors = [];

  // 必須ヘッダーのチェック
  const requiredHeaders = {
    sharegram: ['x-sharegram-signature', 'x-sharegram-timestamp'],
    firebase: ['x-firebase-signature', 'x-firebase-event']
  };

  const headers = requiredHeaders[source] || [];
  headers.forEach(header => {
    if (!req.headers[header]) {
      errors.push(`Missing required header: ${header}`);
    }
  });

  // ペイロードの存在チェック
  if (!req.body || Object.keys(req.body).length === 0) {
    errors.push('Empty webhook payload');
  }

  // タイムスタンプ検証（該当する場合）
  const timestampHeader = source === 'sharegram' ? 'x-sharegram-timestamp' : null;
  if (timestampHeader && req.headers[timestampHeader]) {
    const timestamp = parseInt(req.headers[timestampHeader]);
    if (!verifyTimestamp(timestamp)) {
      errors.push('Webhook timestamp is too old');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Webhook署名を生成（送信用）
 * @param {string} source - Webhookソース
 * @param {Object} payload - ペイロードオブジェクト
 * @returns {Object} 署名情報
 */
const createWebhookSignature = (source, payload) => {
  const secret = WEBHOOK_SECRETS[source];
  if (!secret) {
    throw new Error(`No webhook secret configured for source: ${source}`);
  }

  const payloadString = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateSignature(secret, payloadString);

  return {
    signature,
    timestamp,
    headers: {
      [`X-${source.charAt(0).toUpperCase() + source.slice(1)}-Signature`]: `sha256=${signature}`,
      [`X-${source.charAt(0).toUpperCase() + source.slice(1)}-Timestamp`]: timestamp.toString()
    }
  };
};

module.exports = {
  verifyWebhookSignature,
  validateWebhookRequest,
  createWebhookSignature,
  verifyTimestamp,
  generateSignature
};