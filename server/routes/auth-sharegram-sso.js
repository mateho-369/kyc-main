const express = require('express');
const router = express.Router();

// AppError エラーハンドリング修正
let AppError, AuthenticationError, ValidationError;
try {
  const errors = require('../utils/errors/AppError');
  AppError = errors.AppError;
  AuthenticationError = errors.AuthenticationError;
  ValidationError = errors.ValidationError;
} catch (err) {
  console.error('AppError import failed in auth-sharegram-sso:', err.message);
  // Fallback classes
  AppError = class extends Error { constructor(message, statusCode = 500) { super(message); this.statusCode = statusCode; } };
  AuthenticationError = class extends AppError { constructor(message) { super(message, 401); } };
  ValidationError = class extends AppError { constructor(message) { super(message, 400); } };
}

const { logger } = require('../utils/logger/logger');
const { auditLogger } = require('../utils/logger/auditLogger');
const asyncHandler = require('../utils/asyncHandler');

// firebaseSSOミドルウェアから必要な関数をインポート
// 循環依存を避けるため、直接関数をインポート
const firebaseSSO = require('../middleware/firebaseSSO');

/**
 * Sharegram SSO認証エンドポイント
 * POST /api/auth/sharegram-sso
 * 
 * リクエストボディ:
 * {
 *   "userAccessToken": "Sharegram USER_ACCESS_TOKEN"
 * }
 */
router.post('/sharegram-sso', asyncHandler(async (req, res, next) => {
  try {
    const { userAccessToken } = req.body;

    // パラメータ検証
    if (!userAccessToken) {
      throw new AppError('Missing userAccessToken', 400);
    }

    logger.info('Sharegram SSO login attempt with USER_ACCESS_TOKEN', {
      ip: req.ip
    });

    // SharegramのUSER_ACCESS_TOKENを検証してユーザー情報を取得
    const sharegramUserInfo = await firebaseSSO.verifySharegramAccessToken(userAccessToken);
    
    if (!sharegramUserInfo || !sharegramUserInfo.userId || !sharegramUserInfo.email) {
      throw new AppError('Invalid user access token', 401);
    }

    // ユーザー情報を取得または作成
    const userInfo = await firebaseSSO.findOrCreateSharegramUser({
      sharegramUserId: sharegramUserInfo.userId,
      email: sharegramUserInfo.email,
      verifiedData: sharegramUserInfo
    });

    // Firebase Admin SDKでカスタムトークンを生成
    const firebaseCustomToken = await firebaseSSO.createFirebaseCustomToken(userInfo.user);

    // 監査ログ
    auditLogger.logAuth({
      action: 'SHAREGRAM_SSO_LOGIN',
      userId: userInfo.user.id,
      sharegramUserId: sharegramUserInfo.userId,
      email: sharegramUserInfo.email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      success: true
    });

    // レスポンス - Firebase Custom Tokenを返す
    res.json({
      success: true,
      customToken: firebaseCustomToken,
      user: {
        id: userInfo.user.id,
        email: userInfo.user.email,
        // レスポンスのキーは外部仕様のため displayName のまま、値は User.name から取る
        displayName: userInfo.user.name,
        sharegramUserId: sharegramUserInfo.userId
      },
      isNewUser: userInfo.isNewUser
    });

  } catch (error) {
    logger.error('Sharegram SSO login error:', error);
    
    // 監査ログ（失敗）
    auditLogger.logAuth({
      action: 'SHAREGRAM_SSO_LOGIN',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      success: false,
      error: error.message
    });

    next(error);
  }
}));

/**
 * Sharegram SSO ログアウトエンドポイント
 * POST /api/auth/sharegram-sso/logout
 */
router.post('/sharegram-sso/logout', firebaseSSO.authenticateSharegramSSO, asyncHandler(async (req, res, next) => {
  try {
    const userId = req.user.id;
    const sessionToken = req.headers.authorization?.replace('Bearer ', '');

    // セッション無効化
    if (sessionToken) {
      await firebaseSSO.invalidateSession(sessionToken);
    }

    // 監査ログ
    auditLogger.logAuth({
      action: 'SHAREGRAM_SSO_LOGOUT',
      userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      success: true
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error('Sharegram SSO logout error:', error);
    next(error);
  }
}));

/**
 * Sharegram SSO セッション確認エンドポイント
 * GET /api/auth/sharegram-sso/session
 */
router.get('/sharegram-sso/session', firebaseSSO.authenticateSharegramSSO, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      displayName: req.user.name,
      sharegramUserId: req.sharegramUser?.sharegramUserId
    }
  });
}));

/**
 * Sharegram SSO トークンリフレッシュエンドポイント
 * POST /api/auth/sharegram-sso/refresh
 */
router.post('/sharegram-sso/refresh', firebaseSSO.authenticateSharegramSSO, asyncHandler(async (req, res, next) => {
  try {
    const userId = req.user.id;
    const oldToken = req.headers.authorization?.replace('Bearer ', '');

    // 新しいセッショントークンを生成
    const newSessionToken = await firebaseSSO.createSessionToken(req.user);

    // 古いトークンを無効化
    if (oldToken) {
      await firebaseSSO.invalidateSession(oldToken);
    }

    // 監査ログ
    auditLogger.logAuth({
      action: 'SHAREGRAM_SSO_TOKEN_REFRESH',
      userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      success: true
    });

    res.json({
      success: true,
      sessionToken: newSessionToken
    });

  } catch (error) {
    logger.error('Sharegram SSO token refresh error:', error);
    next(error);
  }
}));

module.exports = router;