/**
 * API保護戦略
 * 
 * 特徴:
 * - 全エンドポイントでの認証必須化
 * - 管理者専用エンドポイントの保護
 * - 機密データへのアクセス制御
 * - レート制限とブルートフォース対策
 * - APIキーとIP制限
 */

const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { unifiedAuth } = require('./auth-unified');
const { requirePermission, PERMISSIONS } = require('./permission-manager');
const { enhancedSecurity } = require('./security-enhanced');
const { logger } = require('../utils/logger/logger');
const { auditLogger } = require('../utils/logger/auditLogger');

/**
 * APIエンドポイントの分類
 */
const API_CATEGORIES = {
  PUBLIC: 'public',           // 公開API
  PROTECTED: 'protected',     // 認証必須API
  ADMIN: 'admin',            // 管理者専用API
  INTERNAL: 'internal',      // 内部API
  WEBHOOK: 'webhook'         // Webhook API
};

/**
 * レート制限の設定
 */
const RATE_LIMITS = {
  // 一般的なAPI
  GENERAL: {
    windowMs: 15 * 60 * 1000, // 15分
    max: 100,                  // 最大100リクエスト
    message: 'Too many requests, please try again later'
  },
  
  // 認証関連API
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15分
    max: 5,                    // 最大5回試行
    message: 'Too many authentication attempts, please try again later'
  },
  
  // 管理者API
  ADMIN: {
    windowMs: 15 * 60 * 1000, // 15分
    max: 200,                  // 最大200リクエスト
    message: 'Admin API rate limit exceeded'
  },
  
  // ファイルアップロード
  UPLOAD: {
    windowMs: 60 * 60 * 1000, // 60分
    max: 10,                   // 最大10回
    message: 'File upload rate limit exceeded'
  },
  
  // 検索API
  SEARCH: {
    windowMs: 5 * 60 * 1000,  // 5分
    max: 50,                   // 最大50リクエスト
    message: 'Search rate limit exceeded'
  },
  
  // Webhook
  WEBHOOK: {
    windowMs: 1 * 60 * 1000,  // 1分
    max: 30,                   // 最大30リクエスト
    message: 'Webhook rate limit exceeded'
  }
};

/**
 * APIエンドポイントの保護設定
 */
const API_PROTECTION_CONFIG = {
  // 公開エンドポイント
  public: {
    paths: [
      '/api/health',
      '/api/status',
      '/api/version'
    ],
    auth: false,
    rateLimit: RATE_LIMITS.GENERAL
  },
  
  // 認証エンドポイント
  auth: {
    paths: [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/forgot-password',
      '/api/auth/reset-password',
      '/api/auth/verify-email'
    ],
    auth: false,
    rateLimit: RATE_LIMITS.AUTH
  },
  
  // 保護されたエンドポイント
  protected: {
    paths: [
      '/api/performers',
      '/api/documents',
      '/api/kyc',
      '/api/dashboard',
      '/api/profile'
    ],
    auth: true,
    rateLimit: RATE_LIMITS.GENERAL
  },
  
  // 管理者専用エンドポイント
  admin: {
    paths: [
      '/api/admin',
      '/api/audit-logs',
      '/api/system',
      '/api/users/admin',
      '/api/performers/admin',
      '/api/integration/admin'
    ],
    auth: true,
    permission: PERMISSIONS.SYSTEM_ADMIN,
    rateLimit: RATE_LIMITS.ADMIN
  },
  
  // ファイルアップロード
  upload: {
    paths: [
      '/api/upload',
      '/api/documents/upload',
      '/api/performers/upload'
    ],
    auth: true,
    rateLimit: RATE_LIMITS.UPLOAD
  },
  
  // 検索エンドポイント
  search: {
    paths: [
      '/api/search',
      '/api/performers/search',
      '/api/documents/search'
    ],
    auth: true,
    rateLimit: RATE_LIMITS.SEARCH
  },
  
  // Webhook
  webhook: {
    paths: [
      '/api/webhooks',
      '/api/integration/webhook'
    ],
    auth: false,
    customAuth: true,
    rateLimit: RATE_LIMITS.WEBHOOK
  }
};

/**
 * APIレート制限ファクトリー
 */
const createRateLimit = (config) => {
  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: {
      success: false,
      error: 'Rate limit exceeded',
      message: config.message
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      // レート制限違反をログに記録
      auditLogger.log({
        event: 'RATE_LIMIT_EXCEEDED',
        userId: req.user?.id,
        ip: req.ip,
        path: req.originalUrl,
        method: req.method,
        userAgent: req.headers['user-agent']
      });
      
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: config.message
      });
    }
  });
};

/**
 * APIスロー制限ファクトリー
 */
const createSlowDown = (config) => {
  return slowDown({
    windowMs: config.windowMs,
    delayAfter: Math.floor(config.max * 0.7), // 70%の時点から遅延開始
    delayMs: 500, // 500ms の遅延
    maxDelayMs: 5000, // 最大5秒の遅延
    skipFailedRequests: true,
    skipSuccessfulRequests: false
  });
};

/**
 * IP制限ミドルウェア
 */
const ipRestriction = (allowedIPs = []) => {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    // 開発環境ではIP制限をスキップ
    if (process.env.NODE_ENV === 'development') {
      return next();
    }
    
    // 許可されたIPリストが空の場合は制限なし
    if (allowedIPs.length === 0) {
      return next();
    }
    
    // IP制限チェック
    if (!allowedIPs.includes(clientIP)) {
      auditLogger.log({
        event: 'IP_RESTRICTION_VIOLATION',
        clientIP,
        path: req.originalUrl,
        method: req.method,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'Your IP address is not allowed to access this resource'
      });
    }
    
    next();
  };
};

/**
 * APIキー認証ミドルウェア
 */
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const validApiKeys = process.env.API_KEYS ? process.env.API_KEYS.split(',') : [];
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API key required',
      message: 'X-API-Key header is required'
    });
  }
  
  if (!validApiKeys.includes(apiKey)) {
    auditLogger.log({
      event: 'INVALID_API_KEY',
      apiKey: apiKey.substring(0, 8) + '...',
      ip: req.ip,
      path: req.originalUrl,
      method: req.method
    });
    
    return res.status(401).json({
      success: false,
      error: 'Invalid API key',
      message: 'The provided API key is invalid'
    });
  }
  
  req.apiKey = apiKey;
  next();
};

/**
 * Webhook認証ミドルウェア
 */
const webhookAuth = (req, res, next) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const body = req.body;
  
  if (!signature || !timestamp) {
    return res.status(401).json({
      success: false,
      error: 'Webhook authentication required',
      message: 'Missing webhook signature or timestamp'
    });
  }
  
  // タイムスタンプの検証（5分以内のリクエストのみ有効）
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp);
  
  if (Math.abs(currentTime - requestTime) > 300) {
    return res.status(401).json({
      success: false,
      error: 'Webhook timestamp invalid',
      message: 'Request timestamp is too old'
    });
  }
  
  // 署名の検証
  const crypto = require('crypto');
  const secret = process.env.WEBHOOK_SECRET;
  const payload = timestamp + '.' + JSON.stringify(body);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    auditLogger.log({
      event: 'WEBHOOK_SIGNATURE_INVALID',
      ip: req.ip,
      path: req.originalUrl,
      providedSignature: signature,
      expectedSignature: expectedSignature.substring(0, 16) + '...'
    });
    
    return res.status(401).json({
      success: false,
      error: 'Webhook signature invalid',
      message: 'The webhook signature is invalid'
    });
  }
  
  next();
};

/**
 * 機密データの保護
 */
const protectSensitiveData = (req, res, next) => {
  // レスポンスの後処理
  const originalSend = res.send;
  
  res.send = function(data) {
    if (typeof data === 'string') {
      try {
        const jsonData = JSON.parse(data);
        const sanitizedData = sanitizeResponse(jsonData);
        return originalSend.call(this, JSON.stringify(sanitizedData));
      } catch (e) {
        // JSONでない場合はそのまま返す
      }
    }
    
    return originalSend.call(this, data);
  };
  
  next();
};

/**
 * レスポンスデータの不要な機密情報を削除
 */
const sanitizeResponse = (data) => {
  if (Array.isArray(data)) {
    return data.map(item => sanitizeResponse(item));
  }
  
  if (typeof data === 'object' && data !== null) {
    const sanitized = { ...data };
    
    // 削除する機密フィールド
    const sensitiveFields = [
      'password',
      'passwordHash',
      'privateKey',
      'secret',
      'token',
      'apiKey',
      'internalId',
      'firebasePrivateKey'
    ];
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        delete sanitized[field];
      }
    });
    
    // ネストされたオブジェクトも処理
    Object.keys(sanitized).forEach(key => {
      if (typeof sanitized[key] === 'object') {
        sanitized[key] = sanitizeResponse(sanitized[key]);
      }
    });
    
    return sanitized;
  }
  
  return data;
};

/**
 * APIエンドポイント保護の適用
 */
const applyApiProtection = (app) => {
  // 全体的なセキュリティ強化
  app.use(enhancedSecurity());
  
  // 機密データの保護
  app.use(protectSensitiveData);
  
  // 各エンドポイントの保護設定を適用
  Object.entries(API_PROTECTION_CONFIG).forEach(([category, config]) => {
    config.paths.forEach(path => {
      // レート制限の適用
      if (config.rateLimit) {
        app.use(path, createRateLimit(config.rateLimit));
        app.use(path, createSlowDown(config.rateLimit));
      }
      
      // IP制限の適用
      if (config.allowedIPs) {
        app.use(path, ipRestriction(config.allowedIPs));
      }
      
      // 認証の適用
      if (config.auth) {
        app.use(path, unifiedAuth({ required: true }));
      }
      
      // カスタム認証の適用
      if (config.customAuth) {
        if (category === 'webhook') {
          app.use(path, webhookAuth);
        } else {
          app.use(path, apiKeyAuth);
        }
      }
      
      // 権限チェックの適用
      if (config.permission) {
        app.use(path, requirePermission(config.permission));
      }
    });
  });
  
  // 保護されていないエンドポイントは拒否
  app.use('/api/*', (req, res, next) => {
    const path = req.originalUrl;
    const isProtected = Object.values(API_PROTECTION_CONFIG).some(config =>
      config.paths.some(protectedPath => path.startsWith(protectedPath))
    );
    
    if (!isProtected) {
      auditLogger.log({
        event: 'UNPROTECTED_ENDPOINT_ACCESS',
        path: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        message: 'The requested endpoint does not exist'
      });
    }
    
    next();
  });
};

/**
 * ブルートフォース対策
 */
const bruteForcePrevention = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 5,                    // 最大5回試行
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // IPアドレスとユーザーエージェントでキーを生成
    return `${req.ip}-${req.headers['user-agent']}`;
  },
  handler: (req, res) => {
    auditLogger.log({
      event: 'BRUTE_FORCE_ATTEMPT',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.originalUrl,
      method: req.method
    });
    
    res.status(429).json({
      success: false,
      error: 'Too many failed attempts',
      message: 'Account temporarily locked due to too many failed attempts'
    });
  }
});

module.exports = {
  applyApiProtection,
  createRateLimit,
  createSlowDown,
  ipRestriction,
  apiKeyAuth,
  webhookAuth,
  protectSensitiveData,
  bruteForcePrevention,
  API_PROTECTION_CONFIG,
  RATE_LIMITS
};