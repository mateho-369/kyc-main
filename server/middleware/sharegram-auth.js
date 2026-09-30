const crypto = require('crypto');
const { SharegramIntegration, ApiLog } = require('../models');
// Preserve the existing signed-message contract; do not trust a client-name
// header as an administrator role. Hard-coded test credentials are not auth.
const validTimestamp = value => typeof value === 'string' && /^\d{10}$/.test(value) &&
  Math.abs(Math.floor(Date.now() / 1000) - Number(value)) <= 300;
const equalSecret = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length > 0 &&
  crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
const validSignature = (received, expected) => typeof received === 'string' && /^[a-f0-9]{64}$/i.test(received) &&
  crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
const sharegramAuth = async (req, res, next) => {
  const startTime = Date.now();
  const deny = async () => {
    await logApiRequest(req, res, 401, 'AUTHENTICATION_FAILED', startTime);
    return res.status(401).json({ code: 'SHAREGRAM_AUTHENTICATION_FAILED' });
  };
  try {
    const authorization = req.header('Authorization');
    const apiKey = req.header('X-Sharegram-API-Key') || (authorization?.startsWith('Bearer ') ? authorization.slice(7) : null);
    const signature = req.header('X-Sharegram-Signature');
    const timestamp = req.header('X-Sharegram-Timestamp');
    const integrationId = req.header('X-Sharegram-Integration-ID');
    const apiClient = req.header('X-API-Client');
    if (!apiKey || !integrationId || !validTimestamp(timestamp) || !/^[a-f0-9]{64}$/i.test(signature || '') ||
        !['sharegram-web','sharegram-mobile','sharegram-admin','sharegram-api','sharegram'].includes(apiClient)) return deny();
    const integration = await SharegramIntegration.findOne({ where: { id: integrationId, integrationType: 'api', isActive: true } });
    let configuration = integration?.configuration;
    if (typeof configuration === 'string') configuration = JSON.parse(configuration);
    if (!integration || !equalSecret(apiKey, configuration?.apiKey) ||
        typeof configuration?.secretKey !== 'string' || Buffer.byteLength(configuration.secretKey) < 32) return deny();
    const expected = generateSignature(constructSignaturePayload(req, timestamp), configuration.secretKey);
    if (!validSignature(signature, expected)) return deny();
    req.sharegramIntegration = integration;
    req.sharegramAuth = { integrationId: integration.id, userId: integration.userId,
      apiKey: '[redacted]', apiClient, authenticated: true, timestamp: Number(timestamp) };
    await logApiRequest(req, res, 200, 'AUTHENTICATED', startTime);
    return next();
  } catch (_) {
    return res.status(503).json({ code: 'SHAREGRAM_AUTHENTICATION_UNAVAILABLE' });
  }
};

/**
 * Sharegram Webhook認証ミドルウェア
 * Webhookリクエストの署名を検証
 */
const sharegramWebhookAuth = async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    const signature = req.header('X-Sharegram-Webhook-Signature');
    const webhookId = req.header('X-Sharegram-Webhook-ID');
    const timestamp = req.header('X-Sharegram-Timestamp');
    
    if (!signature || !webhookId || !validTimestamp(timestamp)) {
      await logApiRequest(req, res, 401, 'Missing webhook headers', startTime);
      return res.status(401).json({
        error: 'Webhook Authentication Failed',
        message: 'Missing required webhook headers'
      });
    }
    
    // Webhook設定の取得
    const { Webhook } = require('../models');
    const webhook = await Webhook.findOne({
      where: {
        id: webhookId,
        isActive: true
      }
    });
    
    if (!webhook || typeof webhook.secret !== 'string' || Buffer.byteLength(webhook.secret) < 32) {
      await logApiRequest(req, res, 401, 'Invalid webhook ID', startTime);
      return res.status(401).json({
        error: 'Webhook Authentication Failed',
        message: 'Invalid webhook configuration'
      });
    }
    
    // 署名の検証
    const payload = JSON.stringify(req.body) + timestamp;
    const expectedSignature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payload)
      .digest('hex');
    
    if (!validSignature(signature, expectedSignature)) {
      await logApiRequest(req, res, 401, 'Invalid webhook signature', startTime);
      return res.status(401).json({
        error: 'Webhook Authentication Failed',
        message: 'Invalid webhook signature'
      });
    }
    
    req.sharegramWebhook = webhook;
    await logApiRequest(req, res, 200, 'Webhook authenticated', startTime);
    
    next();
  } catch (error) {
    console.error('Sharegram webhook authentication error:', error);
    await logApiRequest(req, res, 500, error.message, startTime);
    return res.status(500).json({
      error: 'Webhook Authentication Error',
      message: 'An error occurred during webhook authentication'
    });
  }
};

/**
 * オプショナルSharegram認証
 * 認証は必須ではないが、ヘッダーがある場合は検証
 */
const sharegramAuthOptional = async (req, res, next) => {
  const apiKey = req.header('X-Sharegram-API-Key');
  
  if (!apiKey) {
    req.sharegramAuth = null;
    return next();
  }
  
  return sharegramAuth(req, res, next);
};

/**
 * 署名ペイロードの構築
 */
function constructSignaturePayload(req, timestamp) {
  const method = req.method;
  const path = req.originalUrl || req.url;
  const body = req.body ? JSON.stringify(req.body) : '';
  
  return `${method}\n${path}\n${timestamp}\n${body}`;
}

/**
 * HMAC-SHA256署名の生成
 */
function generateSignature(payload, secretKey) {
  return crypto
    .createHmac('sha256', secretKey)
    .update(payload)
    .digest('hex');
}

/**
 * APIリクエストのログ記録
 */
async function logApiRequest(req, res, statusCode, message, startTime) {
  try {
    const responseTime = Date.now() - startTime;
    
    await ApiLog.create({
      method: req.method,
      path: (req.originalUrl || req.url).split('?')[0],
      headers: {
        'x-sharegram-api-key': req.header('X-Sharegram-API-Key') ? '***' : undefined,
        'x-sharegram-integration-id': req.header('X-Sharegram-Integration-ID'),
        'x-api-client': req.header('X-API-Client'),
        'user-agent': req.header('User-Agent')
      },
      requestBody: {}, // Never persist authentication tokens or KYC request bodies.
      responseStatus: statusCode,
      responseBody: { message },
      responseTime,
      ipAddress: req.ip,
      userAgent: req.header('User-Agent'),
      errorMessage: statusCode >= 400 ? message : null,
      metadata: {
        authType: 'sharegram',
        integrationId: req.sharegramAuth?.integrationId,
        apiClient: req.sharegramAuth?.apiClient
      }
    });
  } catch (error) {
    console.error('Failed to log API request:', error);
  }
}

/**
 * Sharegram APIレート制限
 */
const sharegramRateLimit = async (req, res, next) => {
  if (!req.sharegramAuth) {
    return next();
  }
  
  const integrationId = req.sharegramAuth.integrationId;
  const key = `sharegram_rate_limit:${integrationId}`;
  
  // TODO: Redis実装でレート制限を管理
  // 現在は簡易実装
  
  next();
};

/**
 * APIキー生成
 * @param {string} prefix - APIキーのプレフィックス (例: 'sk_', 'pk_')
 * @returns {string} 生成されたAPIキー
 */
function generateApiKey(prefix = 'sk_') {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `${prefix}${randomBytes}`;
}

/**
 * APIキーのハッシュ化
 * @param {string} apiKey - ハッシュ化するAPIキー
 * @returns {string} ハッシュ化されたAPIキー
 */
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * APIキーの検証
 * @param {string} providedKey - 提供されたAPIキー
 * @param {string} storedHash - 保存されているハッシュ値
 * @returns {boolean} 検証結果
 */
function verifyApiKey(providedKey, storedHash) {
  const providedHash = hashApiKey(providedKey);
  return crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(storedHash));
}

/**
 * APIキー管理ミドルウェア
 * 新しいAPIキー形式での認証をサポート
 */
const sharegramApiKeyAuth = async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    const apiKey = req.header('X-API-Key');
    const apiClient = req.header('X-API-Client');
    
    if (!apiKey || !apiClient) {
      await logApiRequest(req, res, 401, 'Missing API key or client', startTime);
      return res.status(401).json({
        error: 'Authentication Required',
        message: 'Missing API key or client identifier'
      });
    }
    
    // X-API-Clientヘッダーの検証
    const validApiClients = ['sharegram-web', 'sharegram-mobile', 'sharegram-admin', 'sharegram-api'];
    if (!validApiClients.includes(apiClient)) {
      await logApiRequest(req, res, 401, 'Invalid API client', startTime);
      return res.status(401).json({
        error: 'Authentication Failed',
        message: 'Invalid API client identifier'
      });
    }
    
    // APIキーのプレフィックス検証
    if (!apiKey.startsWith('sk_') && !apiKey.startsWith('pk_')) {
      await logApiRequest(req, res, 401, 'Invalid API key format', startTime);
      return res.status(401).json({
        error: 'Authentication Failed',
        message: 'Invalid API key format'
      });
    }
    
    // データベースからAPIキー情報を取得
    const { ApiKey } = require('../models');
    const apiKeyRecord = await ApiKey.findOne({
      where: {
        keyHash: hashApiKey(apiKey),
        isActive: true
      }
    });
    
    if (!apiKeyRecord) {
      await logApiRequest(req, res, 401, 'Invalid API key', startTime);
      return res.status(401).json({
        error: 'Authentication Failed',
        message: 'Invalid or inactive API key'
      });
    }
    
    // 有効期限のチェック
    if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
      await logApiRequest(req, res, 401, 'API key expired', startTime);
      return res.status(401).json({
        error: 'Authentication Failed',
        message: 'API key has expired'
      });
    }
    
    // 使用回数の更新
    await apiKeyRecord.increment('usageCount');
    await apiKeyRecord.update({ lastUsedAt: new Date() });
    
    // 認証情報をリクエストに追加
    req.apiKeyAuth = {
      keyId: apiKeyRecord.id,
      userId: apiKeyRecord.userId,
      keyType: apiKey.startsWith('sk_') ? 'secret' : 'public',
      apiClient: apiClient,
      permissions: apiKeyRecord.permissions || [],
      authenticated: true
    };
    
    await logApiRequest(req, res, 200, 'API key authentication successful', startTime);
    next();
  } catch (error) {
    console.error('API key authentication error:', error);
    await logApiRequest(req, res, 500, error.message, startTime);
    return res.status(500).json({
      error: 'Authentication Error',
      message: 'An error occurred during authentication'
    });
  }
};

module.exports = {
  sharegramAuth,
  sharegramWebhookAuth,
  sharegramAuthOptional,
  sharegramRateLimit,
  sharegramApiKeyAuth,
  generateSignature,
  constructSignaturePayload,
  generateApiKey,
  hashApiKey,
  verifyApiKey
};