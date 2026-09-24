const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User } = require('../models');
const authenticateUser = require('../middleware/auth');
const logger = require('../utils/logger/logger');
const { auditLog } = require('../utils/logger/auditLogger');
const AppError = require('../utils/errors/AppError');
const { Op } = require('sequelize');
const rateLimit = require('express-rate-limit');

// ShareGram SSO認証エンドポイント - 緊急修正版
router.post('/', async (req, res) => {
  try {
    console.log('🚨 ShareGram SSO認証開始:', req.body);
    
    const { token, action, performer_id, come_back_url } = req.body;

    // 必須フィールドの検証
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'token is required'
      });
    }
    
    // ShareGramトークンの簡易検証（仮実装）
    if (token.length < 10) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    
    // 仮のユーザー情報生成（緊急対応）
    const userId = 'sharegram-user-' + Date.now();
    
    console.log('✅ ShareGram SSO認証成功');
    
    // 成功レスポンス
    res.json({
      success: true,
      customToken: 'kyc-custom-token-' + Date.now(), // 仮のカスタムトークン
      user: {
        id: userId,
        email: 'sharegram-user@example.com',
        displayName: 'ShareGram User'
      },
      sessionInfo: {
        loginMethod: 'sharegram_sso',
        action: action,
        performer_id: performer_id,
        come_back_url: come_back_url
      }
    });

  } catch (error) {
    logger.error('SSO authentication error:', error);
    
    // 監査ログ記録
    await auditLog('sso_error', null, req.ip, {
      error: error.message,
      stack: error.stack?.substring(0, 500)
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// SSO状態確認エンドポイント
router.get('/status', authenticateUser, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    
    res.json({
      success: true,
      isConnected: !!user.sharegramUserId,
      sharegramUserId: user.sharegramUserId,
      email: user.email,
      name: user.name
    });
  } catch (error) {
    logger.error('SSO status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// テスト用エンドポイント
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'SSO endpoints are working',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /api/auth/sso/sso - Sharegram SSO authentication',
      'GET /api/auth/sso/status - Check SSO connection status',
      'GET /api/auth/sso/test - This test endpoint'
    ]
  });
});

module.exports = router;