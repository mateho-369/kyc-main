const express = require('express');
const router = express.Router();

/**
 * Sharegram SSO認証エンドポイント（最小限実装）
 * POST /api/auth/sharegram-sso
 * 
 * この実装は依存関係を最小限にして、安定稼働を優先しています。
 */

// ロギング関数（シンプル実装）
const log = (level, message, data = {}) => {
  console.log(`[${new Date().toISOString()}] [${level}] ${message}`, JSON.stringify(data));
};

// エラーレスポンス関数
const sendError = (res, message, statusCode = 400) => {
  log('ERROR', message);
  res.status(statusCode).json({
    success: false,
    error: {
      message: message
    }
  });
};

/**
 * Sharegram SSO ログインエンドポイント
 */
router.post('/sharegram-sso', async (req, res) => {
  try {
    const { idToken, sharegramUserId, email } = req.body;

    // パラメータ検証
    if (!idToken || !sharegramUserId || !email) {
      return sendError(res, 'Missing required parameters: idToken, sharegramUserId, and email are required');
    }

    log('INFO', 'Sharegram SSO login attempt', {
      sharegramUserId,
      email,
      ip: req.ip
    });

    // TODO: 本番環境では適切なトークン検証を実装
    // 現在はモック実装
    const mockUser = {
      id: `kyc_user_${sharegramUserId}`,
      email: email,
      displayName: email.split('@')[0],
      sharegramUserId: sharegramUserId
    };

    // 簡易セッショントークン生成（本番では適切な実装が必要）
    const sessionToken = Buffer.from(JSON.stringify({
      userId: mockUser.id,
      sharegramUserId: sharegramUserId,
      timestamp: Date.now()
    })).toString('base64');

    log('INFO', 'Sharegram SSO login successful', {
      userId: mockUser.id,
      sharegramUserId
    });

    // 成功レスポンス
    res.json({
      success: true,
      user: mockUser,
      sessionToken: sessionToken,
      isNewUser: false
    });

  } catch (error) {
    log('ERROR', 'Sharegram SSO login error', {
      error: error.message,
      stack: error.stack
    });
    sendError(res, 'Internal server error', 500);
  }
});

/**
 * Sharegram SSO セッション確認エンドポイント
 */
router.get('/sharegram-sso/session', async (req, res) => {
  try {
    // 簡易的な認証チェック
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 'Missing or invalid authorization header', 401);
    }

    const token = authHeader.substring(7);
    
    // TODO: 本番環境では適切なセッション検証を実装
    try {
      const sessionData = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
      
      res.json({
        success: true,
        user: {
          id: sessionData.userId,
          sharegramUserId: sessionData.sharegramUserId
        }
      });
    } catch (e) {
      return sendError(res, 'Invalid session token', 401);
    }

  } catch (error) {
    log('ERROR', 'Session check error', { error: error.message });
    sendError(res, 'Internal server error', 500);
  }
});

/**
 * Sharegram SSO ログアウトエンドポイント
 */
router.post('/sharegram-sso/logout', async (req, res) => {
  try {
    // 簡易実装：クライアント側でトークンを削除することを想定
    log('INFO', 'Sharegram SSO logout', { ip: req.ip });
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    log('ERROR', 'Logout error', { error: error.message });
    sendError(res, 'Internal server error', 500);
  }
});

/**
 * ヘルスチェックエンドポイント
 */
router.get('/sharegram-sso/health', (req, res) => {
  res.json({
    success: true,
    service: 'sharegram-sso',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;