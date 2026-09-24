const express = require('express');
const router = express.Router();
const { Performer } = require('../models');

/**
 * 簡単なBearer認証でSharegramエンジニアがテスト可能なAPI
 * テスト用APIキー: sharegram-api-key-test-2025
 */

// 簡単な認証ミドルウェア
const simpleAuth = (req, res, next) => {
  const authHeader = req.header('Authorization');
  const apiClient = req.header('X-API-Client');
  
  // Bearer認証のチェック
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication Required',
      message: 'Bearer token required',
      expectedFormat: 'Authorization: Bearer sharegram-api-key-test-2025'
    });
  }
  
  const token = authHeader.substring(7);
  
  // テスト用APIキーのチェック
  if (token !== 'sharegram-api-key-test-2025') {
    return res.status(401).json({
      error: 'Authentication Failed',
      message: 'Invalid API key',
      expectedKey: 'sharegram-api-key-test-2025'
    });
  }
  
  // X-API-Clientのチェック（オプショナル）
  if (apiClient && apiClient !== 'sharegram') {
    console.warn(`Unexpected X-API-Client: ${apiClient}`);
  }
  
  req.auth = {
    apiKey: token,
    apiClient: apiClient || 'sharegram',
    authenticated: true,
    testMode: true
  };
  
  next();
};

// ヘルスチェック
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Sharegram Simple API is running',
    timestamp: new Date().toISOString(),
    testApiKey: 'sharegram-api-key-test-2025',
    usage: {
      endpoint: 'GET /api/performers',
      headers: {
        'Authorization': 'Bearer sharegram-api-key-test-2025',
        'X-API-Client': 'sharegram'
      }
    }
  });
});

module.exports = router;