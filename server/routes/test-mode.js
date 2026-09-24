const express = require('express');
const router = express.Router();
const { getTestModeInfo, disableTestMode } = require('../middleware/test-mode-security');

/**
 * @route   GET /api/v1/test-mode/status
 * @desc    テストモードのステータスを取得
 * @access  Public
 */
router.get('/status', (req, res) => {
  const info = getTestModeInfo();
  
  if (!info) {
    return res.json({
      success: true,
      data: {
        enabled: false,
        message: 'Test mode is not active'
      }
    });
  }
  
  res.json({
    success: true,
    data: {
      enabled: info.enabled,
      startTime: info.startTime,
      requestsUsed: info.requestCount,
      requestsRemaining: info.remainingRequests,
      timeRemaining: {
        seconds: info.remainingTime,
        minutes: Math.floor(info.remainingTime / 60),
        formatted: `${Math.floor(info.remainingTime / 60)}分 ${info.remainingTime % 60}秒`
      },
      limits: {
        maxRequests: info.maxRequests,
        ipWhitelist: info.ipWhitelist
      }
    }
  });
});

/**
 * @route   POST /api/v1/test-mode/disable
 * @desc    テストモードを手動で無効化
 * @access  Admin only
 */
router.post('/disable', (req, res) => {
  // 管理者権限チェック（簡易版）
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access required'
    });
  }
  
  disableTestMode('Manually disabled by admin');
  
  res.json({
    success: true,
    message: 'Test mode has been disabled'
  });
});

module.exports = router;