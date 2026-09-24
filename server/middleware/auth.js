const jwt = require('jsonwebtoken');
const { User } = require('../models');
const tokenService = require('../services/tokenService');
const { logger } = require('../utils/logger/logger');
const { auditLogger } = require('../utils/logger/auditLogger');
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

const authenticateToken = async function(req, res, next) {
  const requestId = req.requestId || require('crypto').randomUUID();
  const startTime = Date.now();
  
  try {
    // トークンの取得
    const token = req.header('Authorization')?.replace('Bearer ', '');

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
    logger.debug('Authentication successful', {
      requestId,
      userId: user.id,
      tokenId: decoded.jti,
      processingTime: Date.now() - startTime
    });

    next();
  } catch (err) {
    const errorId = require('crypto').randomUUID();
    
    logger.error('Auth middleware error', {
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

// すべてのインポートスタイルをサポート
// const auth = require(...)
// const { authenticateToken } = require(...)
// const { authenticateUser } = require(...)
module.exports = authenticateToken;
module.exports.authenticateToken = authenticateToken;
module.exports.authenticateUser = authenticateToken;