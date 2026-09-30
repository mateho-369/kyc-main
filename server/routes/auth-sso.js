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
// Retired fabricated-identity endpoint. Use verified /api/auth/firebase-session.
router.post('/', (req, res) => res.status(410).json({ code: 'LEGACY_SSO_DISABLED' }));

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