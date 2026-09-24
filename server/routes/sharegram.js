const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const { check, validationResult } = require('express-validator');
const axios = require('axios');
const crypto = require('crypto');

// Skip database imports for SSO endpoints to avoid connection issues
// const { authenticateFirebase } = require('../middleware/firebaseAuth');
// const { User, SharegramIntegration, FirebaseUser } = require('../models');

// One-time code storage (In production, use Redis or database)
const oneTimeCodes = new Map();

// CORS middleware for SSO endpoints (restricted to allowed origins)
const corsForSSO = (req, res, next) => {
  const allowedOrigins = (process.env.SHAREGRAM_ALLOWED_ORIGINS || 'https://sharegram.com,https://stg.id-manager.com,https://id-manager.com').split(',').map(o => o.trim());
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Max-Age', '3600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
};

// @route   OPTIONS api/sharegram/sso/prepare
// @desc    CORS preflight for SSO prepare
// @access  Public
router.options('/sso/prepare', corsForSSO);

// @route   POST api/sharegram/sso/prepare
// @desc    Prepare SSO authentication (generate one-time code)
// @access  Public
router.post('/sso/prepare', corsForSSO, [
  check('token', 'Sharegramトークンは必須です').notEmpty(),
  check('apiKey', 'APIキーは必須です').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { token, apiKey, next = '/dashboard', userInfo } = req.body;

    // APIキーの検証（環境変数から取得）
    const validApiKey = process.env.SHAREGRAM_API_KEY;
    if (!validApiKey || apiKey !== validApiKey) {
      return res.status(401).json({ success: false, error: 'Invalid API key' });
    }

    // One-time codeを生成
    const oneTimeCode = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (5 * 60 * 1000); // 5分後に期限切れ

    // ユーザー情報を構築
    const user = {
      id: userInfo?.id || 'sharegram_user_' + Date.now(),
      email: userInfo?.email || 'test@sharegram.com',
      name: userInfo?.name || userInfo?.display_name || 'Sharegram User',
      sharegramToken: token
    };

    // Generate simple token instead of Firebase for now (to avoid Firebase dependency)
    const firebaseToken = `simple_token_${user.id}_${Date.now()}`;

    // One-time codeをマップに保存
    oneTimeCodes.set(oneTimeCode, {
      user: user,
      firebaseToken: firebaseToken,
      next: next,
      expiresAt: expiresAt,
      createdAt: Date.now()
    });

    console.log('SSO準備完了:', { 
      oneTimeCode: oneTimeCode.substring(0, 8) + '...', 
      user: user.name,
      expiresAt: new Date(expiresAt).toISOString()
    });

    res.json({
      success: true,
      oneTimeCode: oneTimeCode,
      expiresAt: expiresAt,
      message: 'SSO認証の準備が完了しました'
    });

  } catch (error) {
    console.error('SSO準備エラー:', error);
    res.status(500).json({ 
      success: false, 
      error: 'サーバーエラーが発生しました',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   OPTIONS api/sharegram/sso/consume
// @desc    CORS preflight for SSO consume
// @access  Public
router.options('/sso/consume', corsForSSO);

// @route   GET api/sharegram/sso/consume
// @desc    Consume SSO one-time code and perform login
// @access  Public
router.get('/sso/consume', corsForSSO, async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code || !oneTimeCodes.has(code)) {
      console.log('無効なコード:', { code: code?.substring(0, 8) + '...', available: oneTimeCodes.size });
      return res.status(400).send('Invalid or expired login code');
    }
    
    const ssoData = oneTimeCodes.get(code);
    oneTimeCodes.delete(code); // コードは一度だけ使用可能
    
    if (ssoData.expiresAt < Date.now()) {
      console.log('期限切れコード:', { 
        code: code.substring(0, 8) + '...',
        expiresAt: new Date(ssoData.expiresAt).toISOString(),
        now: new Date().toISOString()
      });
      return res.status(400).send('Login code expired');
    }
    
    // Sanitize user data to prevent XSS
    const escapeHtml = (str) => String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const escapedUserName = escapeHtml(ssoData.user.name);
    const safeUserJson = JSON.stringify(ssoData.user).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/'/g, '\\u0027');
    const firebaseToken = ssoData.firebaseToken;

    // Validate redirect URL - only allow relative paths or same-origin
    let nextPage = '/dashboard';
    const requestedNext = ssoData.next;
    if (requestedNext && /^\/[a-zA-Z0-9\-_/]*$/.test(requestedNext)) {
      nextPage = requestedNext;
    }

    console.log('SSO消費成功:', {
      user: escapedUserName,
      nextPage: nextPage
    });

    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Sharegram SSO Login</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      text-align: center;
      padding: 50px;
      background: linear-gradient(135deg, #102a43 0%, #243b53 100%);
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 16px;
      max-width: 450px;
      box-shadow: 0 20px 40px -10px rgba(16, 42, 67, 0.3);
      animation: slideIn 0.5s ease-out;
    }
    .success { color: #10b981; font-size: 28px; margin-bottom: 20px; }
    .logo {
      width: 64px; height: 64px;
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      border-radius: 50%;
      margin: 0 auto 20px auto;
      display: flex; align-items: center; justify-content: center;
      color: #102a43; font-size: 20px; font-weight: bold;
    }
    h2 { color: #102a43; margin-bottom: 15px; }
    p { color: #486581; font-size: 16px; }
    .progress { width: 100%; height: 4px; background: #d9e2ec; border-radius: 2px; margin-top: 20px; overflow: hidden; }
    .progress-bar { height: 100%; background: linear-gradient(90deg, #fbbf24, #f59e0b); width: 0%; animation: progress 3s ease-in-out; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes progress { from { width: 0%; } to { width: 100%; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">KYC</div>
    <div class="success">&#x2705; ログイン成功！</div>
    <h2>Sharegramでログインしました</h2>
    <p>ユーザー: <strong>${escapedUserName}</strong></p>
    <p>ダッシュボードに移動中...</p>
    <div class="progress"><div class="progress-bar"></div></div>
  </div>
  <script>
    localStorage.setItem('CURRENT_USER_KEY', '${safeUserJson}');
    localStorage.setItem('USER_STATUS', '1');
    localStorage.setItem('SSO_LOGIN', 'sharegram');
    localStorage.setItem('firebase_auth_token', ${JSON.stringify(firebaseToken)});
    setTimeout(function() { window.location.href = ${JSON.stringify(nextPage)}; }, 3000);
  </script>
</body>
</html>`);
    
  } catch (error) {
    console.error('SSO消費エラー:', error);
    res.status(500).send(`
      <div style="text-align:center; padding:50px; font-family:Arial;">
        <h2>ログインエラー</h2>
        <p>システムエラーが発生しました。再度お試しください。</p>
        <button onclick="window.close()">閉じる</button>
      </div>
    `);
  }
});

// @route   GET api/sharegram/health
// @desc    Health check endpoint
// @access  Public
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    service: 'sharegram-integration',
    version: '1.0.0',
    sso: {
      activeCodesCount: oneTimeCodes.size,
      endpoints: ['/sso/prepare', '/sso/consume']
    }
  });
});

// @route   POST api/sharegram/auth-result (Simple version for testing)
// /auth-result-simple は削除。認証なしで 200 を返し、受け取ったボディを
// そのままエコーバックするだけのデバッグ用エンドポイントが本番に残っていた。

/**
 * 以下のエンドポイントは、存在しないDBスキーマ（sharegram_user_id / firebase_uid /
 * display_name など）を前提に書かれている。SharegramIntegration モデルにも本番DBにも
 * 該当カラムは無く（実カラムは userId / integrationType / configuration ... の camelCase）、
 * さらに models と authenticateFirebase の import 自体がコメントアウトされているため、
 * ReferenceError で必ず 500 になる。一度も動作したことがない。
 *
 * 未認証のまま 500 を返し続ける状態を避けるため、意図を明示して 501 で閉じる。
 * 復活させる場合は SharegramIntegration の実スキーマに合わせた再実装と、
 * 認証ミドルウェアの付与（req.user.uid ではなく req.user.firebaseUid）が必要。
 */
const notImplemented = (name) => (req, res) => res.status(501).json({
  success: false,
  error: {
    code: 'NOT_IMPLEMENTED',
    message: `${name} is not available. Contact the KYC team before using this endpoint.`
  }
});

// @route   POST api/sharegram/auth-result
// @desc    Send authentication result to Sharegram
// @access  Private (Firebase Auth)
router.post('/auth-result', notImplemented('/auth-result'), [
  check('callback_url', 'コールバックURLは必須です').notEmpty().isURL(),
  check('api_key', 'APIキーは必須です').notEmpty(),
  check('result', '結果データは必須です').notEmpty(),
  check('result.user_id', 'ユーザーIDは必須です').notEmpty(),
  check('result.firebase_uid', 'Firebase UIDは必須です').notEmpty(),
  check('result.email', 'メールアドレスは必須です').isEmail(),
  check('result.status', 'ステータスは必須です').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { callback_url, api_key, result } = req.body;

  try {
    // SSRF prevention: validate callback_url against whitelist
    const allowedCallbackHosts = (process.env.SHAREGRAM_ALLOWED_CALLBACK_HOSTS || 'sharegram.com,api.sharegram.com').split(',').map(h => h.trim());
    try {
      const callbackUrlObj = new URL(callback_url);
      if (!['https:'].includes(callbackUrlObj.protocol) || !allowedCallbackHosts.some(h => callbackUrlObj.hostname === h || callbackUrlObj.hostname.endsWith('.' + h))) {
        return res.status(400).json({ message: 'Invalid callback URL: must be HTTPS and an allowed Sharegram domain' });
      }
    } catch (urlError) {
      return res.status(400).json({ message: 'Invalid callback URL format' });
    }

    // Firebase UIDの検証
    if (req.user.uid !== result.firebase_uid) {
      return res.status(403).json({ message: 'Firebase UIDが一致しません' });
    }

    // APIキーの検証
    if (!isValidApiKey(api_key)) {
      return res.status(401).json({ message: '無効なAPIキーです' });
    }

    // Sharegram統合情報の保存
    const integrationData = {
      sharegram_user_id: result.user_id,
      firebase_uid: result.firebase_uid,
      email: result.email,
      display_name: result.display_name,
      photo_url: result.photo_url,
      session_id: result.session_id,
      status: result.status,
      callback_url: callback_url,
      api_key_hash: hashApiKey(api_key), // APIキーをハッシュ化して保存
      created_at: new Date(),
      updated_at: new Date()
    };

    // データベースに保存
    const integration = await SharegramIntegration.create(integrationData);

    // Sharegramに結果を送信
    const sharegramResponse = await sendToSharegram(callback_url, api_key, result);

    res.json({
      message: 'Sharegramに認証結果を送信しました',
      integration_id: integration.id,
      sharegram_response: sharegramResponse
    });

  } catch (error) {
    console.error('Sharegram認証結果送信エラー:', error);
    res.status(500).json({ 
      message: 'サーバーエラーが発生しました',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST api/sharegram/user-register
// @desc    Register user for Sharegram integration
// @access  Private (Firebase Auth)
router.post('/user-register', notImplemented('/user-register'), [
  check('sharegram_user_id', 'Sharegram ユーザーIDは必須です').notEmpty(),
  check('session_id', 'セッションIDは必須です').notEmpty(),
  check('company_id', '企業IDは必須です').optional(),
  check('locale', 'ロケールは必須です').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    sharegram_user_id,
    session_id,
    company_id,
    locale,
    display_name,
    photo_url
  } = req.body;

  try {
    // Firebase ユーザー情報の保存/更新
    const [firebaseUser] = await FirebaseUser.findOrCreate({
      where: { firebase_uid: req.user.uid },
      defaults: {
        firebase_uid: req.user.uid,
        email: req.user.email,
        display_name: display_name || req.user.name,
        photo_url: photo_url || req.user.picture,
        provider: req.user.firebase?.sign_in_provider || 'unknown',
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // 既存のレコードを更新
    if (!firebaseUser.isNewRecord) {
      await firebaseUser.update({
        email: req.user.email,
        display_name: display_name || req.user.name,
        photo_url: photo_url || req.user.picture,
        updated_at: new Date()
      });
    }

    // Sharegram統合情報の保存
    const [integration] = await SharegramIntegration.findOrCreate({
      where: { 
        sharegram_user_id: sharegram_user_id,
        firebase_uid: req.user.uid
      },
      defaults: {
        sharegram_user_id: sharegram_user_id,
        firebase_uid: req.user.uid,
        email: req.user.email,
        display_name: display_name || req.user.name,
        photo_url: photo_url || req.user.picture,
        session_id: session_id,
        company_id: company_id,
        locale: locale,
        status: 'registered',
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // 既存のレコードを更新
    if (!integration.isNewRecord) {
      await integration.update({
        email: req.user.email,
        display_name: display_name || req.user.name,
        photo_url: photo_url || req.user.picture,
        session_id: session_id,
        company_id: company_id,
        locale: locale,
        status: 'registered',
        updated_at: new Date()
      });
    }

    res.json({
      message: 'ユーザー登録が完了しました',
      firebase_user_id: firebaseUser.id,
      integration_id: integration.id
    });

  } catch (error) {
    console.error('Sharegramユーザー登録エラー:', error);
    res.status(500).json({ 
      message: 'サーバーエラーが発生しました',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET api/sharegram/integration/:user_id
// @desc    Get Sharegram integration status
// @access  Private (Firebase Auth)
// TEMPORARY FIX - Remove Firebase auth dependency
router.get('/integration/:user_id', notImplemented('/integration/:user_id'), async (req, res) => {
  const { user_id } = req.params;

  try {
    const integration = await SharegramIntegration.findOne({
      where: { 
        sharegram_user_id: user_id,
        firebase_uid: req.user.uid
      }
    });

    if (!integration) {
      return res.status(404).json({ message: '統合情報が見つかりません' });
    }

    res.json({
      integration: {
        id: integration.id,
        sharegram_user_id: integration.sharegram_user_id,
        firebase_uid: integration.firebase_uid,
        email: integration.email,
        display_name: integration.display_name,
        photo_url: integration.photo_url,
        status: integration.status,
        created_at: integration.created_at,
        updated_at: integration.updated_at
      }
    });

  } catch (error) {
    console.error('Sharegram統合情報取得エラー:', error);
    res.status(500).json({ 
      message: 'サーバーエラーが発生しました',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST api/sharegram/webhook
// @desc    Handle Sharegram webhook
// @access  Public (with signature validation)
router.post('/webhook', notImplemented('/webhook'), [
  check('event', 'イベントタイプは必須です').notEmpty(),
  check('user_id', 'ユーザーIDは必須です').notEmpty(),
  check('timestamp', 'タイムスタンプは必須です').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    // Webhook署名の検証（テストモード対応）
    const signature = req.headers['x-sharegram-signature'];
    if (!validateWebhookSignature(req.body, signature, req)) {
      console.error('[WEBHOOK] 署名検証失敗');
      return res.status(401).json({ message: '無効なWebhook署名です' });
    }
    
    // テストモードの場合、追加のログ出力
    if (req.isTestMode) {
      console.log('[TEST MODE] Webhookリクエスト処理中');
      console.log('[TEST MODE] イベントタイプ:', req.body.event);
      console.log('[TEST MODE] ユーザーID:', req.body.user_id);
    }

    const { event, user_id, timestamp, data } = req.body;

    // イベントタイプに応じた処理
    switch (event) {
      case 'user.kyc.completed':
        await handleKYCCompleted(user_id, data);
        break;
      case 'user.kyc.failed':
        await handleKYCFailed(user_id, data);
        break;
      case 'user.account.suspended':
        await handleAccountSuspended(user_id, data);
        break;
      default:
        console.warn('未対応のWebhookイベント:', event);
    }

    res.json({ message: 'Webhookを処理しました' });

  } catch (error) {
    console.error('Sharegram Webhookエラー:', error);
    res.status(500).json({ 
      message: 'サーバーエラーが発生しました',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ヘルパー関数

// APIキーの検証
function isValidApiKey(apiKey) {
  // 本番環境では適切なAPIキー検証を実装
  const validApiKeys = process.env.SHAREGRAM_API_KEYS?.split(',') || [];
  return validApiKeys.includes(apiKey) || process.env.NODE_ENV === 'development';
}

// APIキーのハッシュ化
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

// Sharegramへの結果送信
async function sendToSharegram(callbackUrl, apiKey, result) {
  try {
    const response = await axios.post(callbackUrl, {
      api_key: apiKey,
      result: result,
      timestamp: new Date().toISOString(),
      source: 'safevideo-kyc'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SafeVideo-KYC/1.0'
      },
      timeout: 30000 // 30秒タイムアウト
    });

    return {
      status: response.status,
      data: response.data
    };
  } catch (error) {
    console.error('Sharegram送信エラー:', error);
    throw new Error('Sharegramへの送信に失敗しました');
  }
}

// Webhook署名の検証（HMAC-SHA256）
function validateWebhookSignature(payload, signature, req) {
  const webhookSecret = process.env.SHAREGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('SHAREGRAM_WEBHOOK_SECRET is not configured - rejecting webhook');
    return false;
  }

  if (!signature) {
    return false;
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', webhookSecret)
    .update(JSON.stringify(payload))
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expectedSignature, 'utf8')
    );
  } catch (e) {
    return false;
  }
}

// KYC完了処理
async function handleKYCCompleted(userId, data) {
  try {
    await SharegramIntegration.update(
      { 
        status: 'kyc_completed',
        kyc_completed_at: new Date(),
        updated_at: new Date()
      },
      { where: { sharegram_user_id: userId } }
    );
  } catch (error) {
    console.error('KYC完了処理エラー:', error);
  }
}

// KYC失敗処理
async function handleKYCFailed(userId, data) {
  try {
    await SharegramIntegration.update(
      { 
        status: 'kyc_failed',
        kyc_failed_reason: data.reason || '不明なエラー',
        updated_at: new Date()
      },
      { where: { sharegram_user_id: userId } }
    );
  } catch (error) {
    console.error('KYC失敗処理エラー:', error);
  }
}

// アカウント停止処理
async function handleAccountSuspended(userId, data) {
  try {
    await SharegramIntegration.update(
      { 
        status: 'suspended',
        suspended_reason: data.reason || '不明な理由',
        updated_at: new Date()
      },
      { where: { sharegram_user_id: userId } }
    );
  } catch (error) {
    console.error('アカウント停止処理エラー:', error);
  }
}

module.exports = router;