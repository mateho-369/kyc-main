const crypto = require('crypto');
const { SharegramIntegration, ApiLog } = require('../models');
const { testModeSecurity, isTestMode } = require('./test-mode-security');

/**
 * Sharegram API認証ミドルウェア
 * HMAC-SHA256ベースの署名検証とAPIキー認証をサポート
 */
const sharegramAuth = async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    // ヘッダーからSharegram認証情報を取得
    let apiKey = req.header('X-Sharegram-API-Key');
    const signature = req.header('X-Sharegram-Signature');
    const timestamp = req.header('X-Sharegram-Timestamp');
    const integrationId = req.header('X-Sharegram-Integration-ID');
    const apiClient = req.header('X-API-Client');
    
    // 【修正】Bearer形式のAuthorizationヘッダーも受け入れる
    if (!apiKey) {
      const authHeader = req.header('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.replace('Bearer ', '');
      }
    }
    
    // テストモードチェック
    if (isTestMode(apiKey)) {
      // テストモードセキュリティミドルウェアを実行
      return testModeSecurity(req, res, () => {
        // テストモードでは簡略化された認証
        req.sharegramAuth = {
          integrationId: 'test-integration',
          userId: 'test-user',
          apiKey: 'test-mode',
          apiClient: apiClient || 'test-client',
          authenticated: true,
          testMode: true
        };
        next();
      });
    }
    
    // 【修正】テストモードの場合は必須ヘッダーチェックを緩和
    if (!apiKey) {
      await logApiRequest(req, res, 401, 'Missing API key', startTime);
      return res.status(401).json({
        error: 'Authentication Required',
        message: 'Missing API key in Authorization header or X-Sharegram-API-Key header',
        requiredHeaders: ['Authorization: Bearer <api-key>', 'X-Sharegram-API-Key']
      });
    }

    // テストモード以外の場合は通常の検証を実行
    if (!isTestMode(apiKey)) {
      // 必須ヘッダーの確認（通常モード）
      if (!signature || !timestamp || !integrationId || !apiClient) {
        await logApiRequest(req, res, 401, 'Missing required Sharegram headers', startTime);
        return res.status(401).json({
          error: 'Authentication Required',
          message: 'Missing required Sharegram authentication headers',
          missingHeaders: {
            'X-Sharegram-Signature': !signature,
            'X-Sharegram-Timestamp': !timestamp,
            'X-Sharegram-Integration-ID': !integrationId,
            'X-API-Client': !apiClient
          }
        });
      }
    }
    
    // テストモード以外の場合のAPI Client検証
    if (!isTestMode(apiKey)) {
      // X-API-Clientヘッダーの検証（sharegram単体も許可）
      const validApiClients = ['sharegram-web', 'sharegram-mobile', 'sharegram-admin', 'sharegram-api', 'sharegram'];
      if (!validApiClients.includes(apiClient)) {
        await logApiRequest(req, res, 401, 'Invalid API client', startTime);
        return res.status(401).json({
          error: 'Authentication Failed',
          message: 'Invalid API client identifier',
          validClients: validApiClients
        });
      }
    }
    
    // テストモード以外の場合の詳細検証
    if (!isTestMode(apiKey)) {
      // タイムスタンプの検証（5分以内）
      const requestTime = parseInt(timestamp);
      const currentTime = Math.floor(Date.now() / 1000);
      const timeDiff = Math.abs(currentTime - requestTime);
      
      if (timeDiff > 300) { // 5分
        await logApiRequest(req, res, 401, 'Request timestamp expired', startTime);
        return res.status(401).json({
          error: 'Authentication Failed',
          message: 'Request timestamp is too old or too far in the future'
        });
      }
      
      // 統合設定の取得
      const integration = await SharegramIntegration.findOne({
        where: {
          id: integrationId,
          integrationType: 'api',
          isActive: true
        }
      });
      
      if (!integration) {
        await logApiRequest(req, res, 401, 'Invalid integration ID', startTime);
        return res.status(401).json({
          error: 'Authentication Failed',
          message: 'Invalid or inactive integration'
        });
      }
      
      // APIキーの検証
      const storedApiKey = integration.configuration.apiKey;
      if (apiKey !== storedApiKey) {
        await logApiRequest(req, res, 401, 'Invalid API key', startTime);
        return res.status(401).json({
          error: 'Authentication Failed',
          message: 'Invalid API key'
        });
      }
      
      // 署名の検証
      const payload = constructSignaturePayload(req, timestamp);
      const expectedSignature = generateSignature(payload, integration.configuration.secretKey);
      
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        await logApiRequest(req, res, 401, 'Invalid signature', startTime);
        return res.status(401).json({
          error: 'Authentication Failed',
          message: 'Invalid request signature'
        });
      }
    }
    
    // 認証成功 - リクエストに統合情報を追加
    if (!isTestMode(apiKey)) {
      req.sharegramIntegration = integration;
      req.sharegramAuth = {
        integrationId: integration.id,
        userId: integration.userId,
        apiKey: apiKey.substring(0, 8) + '...',
        apiClient: apiClient,
        authenticated: true,
        timestamp: requestTime
      };
    } else {
      // テストモードの場合は既に認証情報が設定されている
      console.log('Test mode authentication successful for API key:', apiKey);
    }
    
    // 成功ログ
    await logApiRequest(req, res, 200, 'Authentication successful', startTime);
    
    next();
  } catch (error) {
    console.error('Sharegram authentication error:', error);
    await logApiRequest(req, res, 500, error.message, startTime);
    return res.status(500).json({
      error: 'Authentication Error',
      message: 'An error occurred during authentication'
    });
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
    
    if (!signature || !webhookId || !timestamp) {
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
    
    if (!webhook) {
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
    
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
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
      path: req.originalUrl || req.url,
      headers: {
        'x-sharegram-api-key': req.header('X-Sharegram-API-Key') ? '***' : undefined,
        'x-sharegram-integration-id': req.header('X-Sharegram-Integration-ID'),
        'x-api-client': req.header('X-API-Client'),
        'user-agent': req.header('User-Agent')
      },
      requestBody: req.body || {},
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