const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

// テストモード設定
const testModeConfig = {
  enabled: false,
  startTime: null,
  requestCount: 0,
  maxRequests: parseInt(process.env.TEST_MODE_MAX_REQUESTS) || 100,
  duration: parseInt(process.env.TEST_MODE_DURATION) || 30 * 60 * 1000, // 30分
  ipWhitelist: (process.env.TEST_MODE_IP_WHITELIST || '127.0.0.1,::1').split(',').map(ip => ip.trim())
};

// 専用ログ設定
const testModeLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/test-mode-access.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// テストモード有効化
function enableTestMode(apiKey) {
  testModeConfig.enabled = true;
  testModeConfig.startTime = Date.now();
  testModeConfig.requestCount = 0;
  testModeConfig.apiKey = apiKey;
  
  // 自動無効化タイマー設定
  setTimeout(() => {
    disableTestMode('Time limit expired');
  }, testModeConfig.duration);
  
  testModeLogger.info('Test mode enabled', {
    apiKey,
    duration: testModeConfig.duration,
    maxRequests: testModeConfig.maxRequests,
    ipWhitelist: testModeConfig.ipWhitelist
  });
}

// テストモード無効化
function disableTestMode(reason) {
  if (testModeConfig.enabled) {
    testModeLogger.info('Test mode disabled', {
      reason,
      totalRequests: testModeConfig.requestCount,
      duration: Date.now() - testModeConfig.startTime
    });
    
    testModeConfig.enabled = false;
    testModeConfig.startTime = null;
    testModeConfig.requestCount = 0;
    delete testModeConfig.apiKey;
  }
}

// テストモードチェック
function isTestMode(apiKey) {
  // sharegram-api-key-test-2025 をテストモードキーとして認識
  return apiKey === 'sharegram-api-key-test-2025' || apiKey === process.env.TEST_MODE_API_KEY;
}

// IP制限チェック
function isIpAllowed(ip) {
  // IPv6のローカルホスト表記を正規化
  const normalizedIp = ip === '::ffff:127.0.0.1' ? '127.0.0.1' : ip;
  
  // プロダクションモードでは制限なし
  if (!testModeConfig.enabled) {
    return true;
  }
  
  // テストモードではホワイトリストチェック
  return testModeConfig.ipWhitelist.includes(normalizedIp) || 
         testModeConfig.ipWhitelist.includes('*'); // ワイルドカード対応
}

// ミドルウェア関数
async function testModeSecurity(req, res, next) {
  try {
    const clientIp = req.ip || req.connection.remoteAddress;
    const apiKey = req.headers['x-sharegram-api-key'] || 
                   req.headers['authorization']?.replace('Bearer ', '');
    
    // テストモードキーチェック
    if (isTestMode(apiKey)) {
      // 初回アクセス時にテストモードを有効化
      if (!testModeConfig.enabled) {
        enableTestMode(apiKey);
      }
      
      // IP制限チェック
      if (!isIpAllowed(clientIp)) {
        testModeLogger.warn('Access denied - IP not whitelisted', {
          ip: clientIp,
          endpoint: req.path,
          apiKey: apiKey.substring(0, 10) + '...'
        });
        
        return res.status(403).json({
          error: 'Access Denied',
          message: 'Your IP address is not authorized for test mode',
          requestId: req.requestId
        });
      }
      
      // リクエスト数チェック
      testModeConfig.requestCount++;
      if (testModeConfig.requestCount > testModeConfig.maxRequests) {
        disableTestMode('Request limit exceeded');
        
        return res.status(429).json({
          error: 'Test Mode Limit Exceeded',
          message: `Maximum ${testModeConfig.maxRequests} requests allowed in test mode`,
          requestId: req.requestId
        });
      }
      
      // 残り時間計算
      const remainingTime = Math.max(0, 
        testModeConfig.duration - (Date.now() - testModeConfig.startTime)
      );
      const remainingMinutes = Math.floor(remainingTime / 60000);
      const remainingRequests = testModeConfig.maxRequests - testModeConfig.requestCount;
      
      // レスポンスヘッダーに情報追加
      res.setHeader('X-Test-Mode', 'true');
      res.setHeader('X-Test-Mode-Remaining-Time', remainingMinutes);
      res.setHeader('X-Test-Mode-Remaining-Requests', remainingRequests);
      
      // 詳細ログ記録
      testModeLogger.info('Test mode request', {
        timestamp: new Date().toISOString(),
        ip: clientIp,
        endpoint: req.path,
        method: req.method,
        apiKey: apiKey.substring(0, 10) + '...',
        testMode: true,
        requestNumber: testModeConfig.requestCount,
        remainingTime: remainingMinutes,
        remainingRequests: remainingRequests,
        headers: req.headers,
        query: req.query
      });
      
      // 期限切れチェック
      if (remainingTime <= 0) {
        disableTestMode('Time limit expired');
        
        return res.status(401).json({
          error: 'Test Mode Expired',
          message: 'Test mode time limit has expired',
          requestId: req.requestId
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Test mode security error:', error);
    next(error);
  }
}

// テストモード情報取得エンドポイント用
function getTestModeInfo() {
  if (!testModeConfig.enabled) {
    return null;
  }
  
  const elapsed = Date.now() - testModeConfig.startTime;
  const remaining = Math.max(0, testModeConfig.duration - elapsed);
  
  return {
    enabled: true,
    startTime: new Date(testModeConfig.startTime).toISOString(),
    requestCount: testModeConfig.requestCount,
    maxRequests: testModeConfig.maxRequests,
    remainingRequests: testModeConfig.maxRequests - testModeConfig.requestCount,
    remainingTime: Math.floor(remaining / 1000), // 秒単位
    ipWhitelist: testModeConfig.ipWhitelist
  };
}

module.exports = {
  testModeSecurity,
  enableTestMode,
  disableTestMode,
  getTestModeInfo,
  isTestMode
};