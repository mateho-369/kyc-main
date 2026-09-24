const jwt = require('jsonwebtoken');
const { User } = require('../models');
const tokenService = require('../services/tokenService');
const { logger } = require('../utils/logger/logger');
const { auditLogger } = require('../utils/logger/auditLogger');
const { sharegramAuth } = require('./sharegram-auth');

// AppError エラーハンドリング修正
let AppError;
try {
  AppError = require('../utils/errors/AppError').AppError;
} catch (err) {
  console.error('AppError import failed:', err.message);
  // Fallback AppError class
  AppError = class extends Error {
    constructor(message, statusCode = 500) {
      super(message);
      this.statusCode = statusCode;
    }
  };
}

/**
 * ハイブリッド認証ミドルウェア
 * JWT認証とSharegram API認証の両方をサポート
 */
module.exports = async function(req, res, next) {
  const requestId = req.requestId || require('crypto').randomUUID();
  const startTime = Date.now();
  
  try {
    // Authorizationヘッダーをチェック
    const authHeader = req.header('Authorization');
    const apiClient = req.header('X-API-Client');
    
    // デバッグログ: Sharegramからのリクエストヘッダーを確認
    console.log('hybrid-auth headers:', {
      Authorization: authHeader ? (authHeader.substring(0, 30) + '...') : 'none',
      'X-API-Client': apiClient || 'none',
      'X-Sharegram-API-Key': req.header('X-Sharegram-API-Key') || 'none'
    });

    // Sharegram API認証の判定
    // 1. テスト用APIキー（sharegram-api-key-test-2025）→ 簡易認証で通す
    // 2. BearerトークンがJWT形式 → JWT認証を優先（フロントエンドSSO対応）
    // 3. HMAC署名ヘッダー付き → Sharegram HMAC認証（バックエンド間通信）
    // 4. X-API-Clientのみ（トークンなし）→ Sharegram HMAC認証（401になる）

    // System API key authentication (only when SYSTEM_API_KEYS is explicitly configured)
    const systemApiKeysEnv = process.env.SYSTEM_API_KEYS;
    const bearerToken = authHeader?.replace('Bearer ', '');
    if (systemApiKeysEnv && bearerToken) {
      const testApiKeys = systemApiKeysEnv.split(',').map(k => k.trim()).filter(k => k.length > 0);
      if (testApiKeys.includes(bearerToken)) {
        logger.info('System API key authentication used', { apiClient, requestId });
        req.sharegramAuth = {
          apiKey: '[redacted]',
          apiClient: apiClient || 'sharegram',
          authenticated: true
        };
        req.user = { id: null, role: 'admin', sharegramUserId: null };
        return next();
      }
    }

    const hasJwtToken = authHeader && authHeader.startsWith('Bearer ') &&
                        !authHeader.includes('sharegram-api-key');
    const isSharegramRequest = !hasJwtToken &&
                              (apiClient === 'sharegram' ||
                               (authHeader && authHeader.includes('sharegram-api-key')));

    if (isSharegramRequest) {
      // Sharegram HMAC認証を使用（バックエンド間通信）
      console.log('Using Sharegram HMAC authentication for request');
      return sharegramAuth(req, res, next);
    }
    
    // 標準JWT認証を実行
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ 
        error: 'トークンがありません。認証が拒否されました',
        requestId 
      });
    }

    // トークンサービスを使用してトークンを検証
    const decoded = await tokenService.verifyToken(token, 'access');
    
    // ユーザーの存在確認
    const user = await User.findByPk(decoded.user.id);
    if (!user) {
      await auditLogger.log('auth_user_not_found', decoded.user.id, req.ip, {
        requestId,
        tokenId: decoded.jti,
        userAgent: req.get('user-agent')
      });
      
      return res.status(401).json({ 
        error: 'ユーザーが見つかりません',
        requestId 
      });
    }

    // アカウントロック確認
    if (user.isLocked) {
      await auditLogger.log('auth_account_locked', user.id, req.ip, {
        requestId,
        tokenId: decoded.jti,
        userAgent: req.get('user-agent')
      });
      
      return res.status(423).json({ 
        error: 'アカウントがロックされています',
        requestId 
      });
    }

    // 非アクティブなアカウント確認
    if (!user.isActive) {
      await auditLogger.log('auth_account_inactive', user.id, req.ip, {
        requestId,
        tokenId: decoded.jti,
        userAgent: req.get('user-agent')
      });
      
      return res.status(403).json({ 
        error: 'アカウントが非アクティブです',
        requestId 
      });
    }

    // リクエストにユーザー情報とトークン情報を追加
    req.user = user;
    req.token = decoded;
    req.requestId = requestId;

    // 成功ログ（デバッグレベル）
    logger.debug('JWT Authentication successful', {
      requestId,
      userId: user.id,
      tokenId: decoded.jti,
      processingTime: Date.now() - startTime
    });

    next();
  } catch (err) {
    const errorId = require('crypto').randomUUID();
    
    logger.error('Hybrid auth middleware error', {
      requestId,
      errorId,
      error: err.message,
      stack: err.stack,
      errorType: err.constructor.name,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      processingTime: Date.now() - startTime
    });

    await auditLogger.log('auth_middleware_error', null, req.ip, {
      requestId,
      errorId,
      error: err.message,
      userAgent: req.get('user-agent')
    });

    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        error: err.message,
        requestId,
        errorId
      });
    }

    res.status(401).json({
      error: 'トークンが無効です',
      requestId,
      errorId
    });
  }
};