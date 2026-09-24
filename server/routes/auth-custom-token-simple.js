// CEO技術仕様明確化 - トークン役割区別実装
const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const crypto = require('crypto');

// Firebase Admin SDK
let createCustomToken, verifyIdToken, getUser, logger;
try {
  const firebase = require('../config/firebase-admin');
  createCustomToken = firebase.createCustomToken;
  verifyIdToken = firebase.verifyIdToken;
  getUser = firebase.getUser;
  logger = firebase.logger;
} catch (err) {
  console.log('Firebase disabled, using mock functions');
  // Mock functions for Firebase disabled mode
  createCustomToken = async (uid, claims) => `mock_custom_token_${uid}_${Date.now()}`;
  verifyIdToken = async (token) => ({
    uid: 'mock_uid_123',
    email: 'test@example.com',
    aud: process.env.FIREBASE_PROJECT_ID || 'test-project',
    iss: `https://securetoken.google.com/${process.env.FIREBASE_PROJECT_ID || 'test-project'}`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  });
  getUser = async (uid) => ({
    uid,
    email: 'test@example.com',
    displayName: 'Test User',
    emailVerified: true,
    disabled: false,
    metadata: {
      creationTime: new Date().toISOString(),
      lastSignInTime: new Date().toISOString()
    }
  });
  logger = {
    info: console.log,
    error: console.error,
    warn: console.warn
  };
}

// API Key認証
const authenticateSharegramAPIKey = (req, res, next) => {
  const authHeader = req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: { code: 'MISSING_AUTH', message: 'Authorization header required' }
    });
  }

  const apiKey = authHeader.replace('Bearer ', '');
  const validKeys = ['sharegram-api-key-test-2025', 'sharegram-kyc-system-key-2025'];
  
  if (!validKeys.includes(apiKey)) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_API_KEY', message: 'Invalid API key' }
    });
  }

  req.sharegramAPIKey = apiKey;
  req.isTestEnvironment = apiKey.includes('test');
  next();
};

/**
 * 【CEO技術仕様】Sharegram IDトークン → KYCカスタムトークン変換
 * POST /api/auth/custom-token
 * 
 * 受信: Firebase IDトークン (ShareGram発行)
 * 送信: Firebase カスタムトークン (KYC用)
 * 
 * Request Body:
 * {
 *   "idToken": "Firebase ID Token from ShareGram",
 *   "performerId": "optional_performer_id", 
 *   "redirect_target": "optional_redirect_url"
 * }
 */
router.post('/custom-token', authenticateSharegramAPIKey, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { idToken, performerId, redirect_target, metadata = {} } = req.body;

    // 【必須】IDトークン検証
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ID_TOKEN', message: 'Firebase ID Token required' }
      });
    }

    // JWT形式検証
    const tokenParts = idToken.split('.');
    if (tokenParts.length !== 3) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TOKEN_FORMAT', message: 'Invalid JWT format' }
      });
    }

    logger.info('Sharegram IDToken→CustomToken conversion started', {
      apiKey: req.sharegramAPIKey,
      performerId,
      hasRedirectTarget: !!redirect_target,
      ip: req.ip
    });

    // 【STEP 1】Firebase IDトークン検証 (ShareGram→KYC)
    let decodedIdToken;
    try {
      decodedIdToken = await verifyIdToken(idToken, true); // checkRevoked=true
      
      logger.info('ShareGram Firebase ID Token verified', {
        uid: decodedIdToken.uid,
        email: decodedIdToken.email,
        performerId
      });
    } catch (verifyError) {
      logger.error('ShareGram ID Token verification failed', {
        error: verifyError.message,
        code: verifyError.code,
        performerId
      });

      const errorMap = {
        'auth/id-token-expired': 'ShareGram ID Token expired',
        'auth/id-token-revoked': 'ShareGram ID Token revoked', 
        'auth/invalid-id-token': 'Invalid ShareGram ID Token',
        'auth/user-disabled': 'ShareGram user disabled'
      };

      return res.status(401).json({
        success: false,
        error: {
          code: verifyError.code || 'ID_TOKEN_VERIFICATION_FAILED',
          message: errorMap[verifyError.code] || 'ShareGram ID Token verification failed'
        }
      });
    }

    // 【STEP 2】Firebase プロジェクト検証
    if (process.env.FIREBASE_PROJECT_ID && decodedIdToken.aud !== process.env.FIREBASE_PROJECT_ID) {
      return res.status(403).json({
        success: false,
        error: { code: 'PROJECT_MISMATCH', message: 'Firebase project mismatch' }
      });
    }

    // 【STEP 3】ShareGram ユーザー情報取得
    let sharegramUser;
    try {
      sharegramUser = await getUser(decodedIdToken.uid);
    } catch (getUserError) {
      logger.error('Failed to get ShareGram user info', {
        uid: decodedIdToken.uid,
        error: getUserError.message
      });
      
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'ShareGram user not found' }
      });
    }

    // 【STEP 4】KYC用カスタムクレーム設計
    const kycCustomClaims = {
      // 基本識別
      kycSiteUser: true,
      sharegramUser: true,
      
      // ShareGram情報
      sharegramUid: decodedIdToken.uid,
      sharegramEmail: decodedIdToken.email,
      sharegramPerformerId: performerId,
      
      // セッション情報  
      loginMethod: 'sharegram_sso',
      loginTimestamp: Math.floor(Date.now() / 1000),
      sessionId: crypto.randomUUID(),
      
      // API情報
      apiKeyUsed: req.sharegramAPIKey,
      isTestEnvironment: req.isTestEnvironment,
      
      // リダイレクト情報
      redirectTarget: redirect_target,
      
      // メタデータ
      integrationVersion: '2.0',
      processingTime: Date.now() - startTime,
      
      // 追加メタデータ
      ...metadata
    };

    // 【STEP 5】KYCカスタムトークン発行 (KYC→フロント)
    let kycCustomToken;
    try {
      kycCustomToken = await createCustomToken(decodedIdToken.uid, kycCustomClaims);
      
      logger.info('KYC Custom Token created successfully', {
        uid: decodedIdToken.uid,
        performerId,
        claimsCount: Object.keys(kycCustomClaims).length,
        hasRedirectTarget: !!redirect_target
      });
    } catch (createError) {
      logger.error('KYC Custom Token creation failed', {
        uid: decodedIdToken.uid,
        error: createError.message,
        performerId
      });
      
      return res.status(500).json({
        success: false,
        error: { code: 'CUSTOM_TOKEN_CREATION_FAILED', message: 'Failed to create KYC custom token' }
      });
    }

    // 【成功レスポンス】
    const responseData = {
      success: true,
      
      // 【重要】KYC用カスタムトークン (KYC→フロント)
      customToken: kycCustomToken,
      
      // ShareGramユーザー情報
      user: {
        uid: sharegramUser.uid,
        email: sharegramUser.email,
        displayName: sharegramUser.displayName,
        emailVerified: sharegramUser.emailVerified,
        disabled: sharegramUser.disabled
      },
      
      // セッション情報
      sessionInfo: {
        sessionId: kycCustomClaims.sessionId,
        loginMethod: 'sharegram_sso',
        loginTimestamp: new Date().toISOString(),
        performerId,
        isTestEnvironment: req.isTestEnvironment
      },
      
      // 【CEO仕様】redirect_target パラメータ処理
      redirectTarget: redirect_target,
      
      // メタデータ
      metadata: {
        apiVersion: '2.0',
        processingTime: Date.now() - startTime,
        tokenType: 'custom', // Firebase Custom Token
        sourceTokenType: 'id', // Firebase ID Token
        claimsCount: Object.keys(kycCustomClaims).length
      }
    };

    res.json(responseData);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    logger.error('Sharegram→KYC token conversion failed', {
      error: error.message,
      stack: error.stack,
      processingTime,
      apiKey: req.sharegramAPIKey
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'TOKEN_CONVERSION_ERROR',
        message: 'Failed to convert ShareGram ID Token to KYC Custom Token'
      }
    });
  }
});

/**
 * カスタムトークンステータス確認
 * GET /api/auth/custom-token/status
 */
router.get('/custom-token/status', authenticateSharegramAPIKey, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        service: 'ShareGram→KYC Token Converter',
        version: '2.0',
        apiKeyValid: true,
        isTestEnvironment: req.isTestEnvironment,
        tokenConversion: {
          input: 'Firebase ID Token (from ShareGram)',
          output: 'Firebase Custom Token (for KYC)',
          process: 'verifyIdToken() → createCustomToken()'
        },
        firebase: {
          projectId: process.env.FIREBASE_PROJECT_ID,
          enabled: !process.env.DISABLE_FIREBASE
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: 'STATUS_ERROR', message: 'Status check failed' }
    });
  }
});

/**
 * トークン形式テスト
 * POST /api/auth/custom-token/test
 */
router.post('/custom-token/test', authenticateSharegramAPIKey, async (req, res) => {
  try {
    const testIdToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.eyJ1aWQiOiJ0ZXN0X3VpZCIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImF1ZCI6InRlc3QiLCJpc3MiOiJ0ZXN0IiwiZXhwIjo5OTk5OTk5OTk5LCJpYXQiOjE2MzA0NTcyMDB9.test_signature';
    
    const testCustomToken = await createCustomToken('test_uid', {
      testMode: true,
      timestamp: Date.now()
    });
    
    res.json({
      success: true,
      data: {
        tokenConversion: {
          inputExample: 'Firebase ID Token (JWT from ShareGram)',
          outputExample: 'Firebase Custom Token (for KYC authentication)',
          testCustomToken: testCustomToken.substring(0, 50) + '...'
        },
        process: {
          step1: 'verifyIdToken(sharegramIdToken)',
          step2: 'createCustomToken(uid, kycClaims)',
          step3: 'return customToken to frontend'
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: 'TEST_FAILED', message: error.message }
    });
  }
});

module.exports = router;