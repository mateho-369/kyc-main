const jwt = require('jsonwebtoken');
const { User } = require('../models');
const tokenService = require('../services/tokenService');
const { logger } = require('../utils/logger/logger');
const { auditLogger } = require('../utils/logger/auditLogger');
const { AppError } = require('../utils/errors/AppError');

/**
 * Enhanced authentication middleware that supports both Authorization header and cookies
 * This helps handle cases where the frontend might not properly set the Authorization header
 */
module.exports = async function(req, res, next) {
  const requestId = req.requestId || require('crypto').randomUUID();
  const startTime = Date.now();
  
  try {
    // Try to get token from multiple sources
    let token = null;
    let tokenSource = null;

    // 1. Check Authorization header (primary method)
    const authHeader = req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.replace('Bearer ', '');
      tokenSource = 'header';
    }

    // 2. If no header token, check for access token in cookies (fallback)
    if (!token && req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
      tokenSource = 'cookie';
    }

    // 3. If still no token, try to use refresh token to get a new access token
    if (!token && req.cookies && req.cookies.refreshToken) {
      try {
        logger.info('Attempting to refresh token from cookie', {
          requestId,
          ip: req.ip
        });

        const tokens = await tokenService.refreshTokens(req.cookies.refreshToken, {
          ip: req.ip,
          userAgent: req.get('user-agent')
        });

        // Set the new access token
        token = tokens.accessToken;
        tokenSource = 'refreshed';

        // Update cookies with new tokens
        const cookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days for refresh token
        };

        res.cookie('refreshToken', tokens.refreshToken, cookieOptions);
        
        // Also set access token in cookie for future requests
        res.cookie('accessToken', tokens.accessToken, {
          ...cookieOptions,
          maxAge: 15 * 60 * 1000 // 15 minutes for access token
        });

      } catch (refreshError) {
        logger.warn('Failed to refresh token', {
          requestId,
          error: refreshError.message
        });
      }
    }

    if (!token) {
      return res.status(401).json({ 
        error: 'トークンがありません。認証が拒否されました',
        requestId,
        hint: 'Please include Authorization header with Bearer token or ensure cookies are enabled'
      });
    }

    // Verify the token using tokenService
    const decoded = await tokenService.verifyToken(token, 'access');
    
    // Get user from database
    const user = await User.findByPk(decoded.user.id);
    if (!user) {
      await auditLogger.log('auth_user_not_found', decoded.user.id, req.ip, {
        requestId,
        tokenId: decoded.jti,
        tokenSource,
        userAgent: req.get('user-agent')
      });
      
      return res.status(401).json({ 
        error: 'ユーザーが見つかりません',
        requestId 
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      await auditLogger.log('auth_account_locked', user.id, req.ip, {
        requestId,
        tokenId: decoded.jti,
        tokenSource,
        userAgent: req.get('user-agent')
      });
      
      return res.status(423).json({ 
        error: 'アカウントがロックされています',
        requestId 
      });
    }

    // Check if account is inactive
    if (!user.isActive) {
      await auditLogger.log('auth_account_inactive', user.id, req.ip, {
        requestId,
        tokenId: decoded.jti,
        tokenSource,
        userAgent: req.get('user-agent')
      });
      
      return res.status(403).json({ 
        error: 'アカウントが非アクティブです',
        requestId 
      });
    }

    // Add user info to request
    req.user = user;
    req.token = decoded;
    req.requestId = requestId;
    req.tokenSource = tokenSource;

    // Log successful authentication
    logger.debug('Authentication successful', {
      requestId,
      userId: user.id,
      tokenId: decoded.jti,
      tokenSource,
      processingTime: Date.now() - startTime
    });

    // If token was refreshed, add new access token to response header
    if (tokenSource === 'refreshed' && token) {
      res.setHeader('X-New-Access-Token', token);
    }

    next();
  } catch (err) {
    const errorId = require('crypto').randomUUID();
    
    logger.error('Auth middleware error', {
      requestId,
      errorId,
      error: err.message,
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