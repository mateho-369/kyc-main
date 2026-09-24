const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
// 環境変数ファイルの動的ロード
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.join(__dirname, envFile);
require('dotenv').config({ path: envPath });

// Sharegram SSO 用の設定チェック。
// .env が読めていないだけ（リポジトリ直下に置いてしまった等）で
// SSO が「Invalid token」になる紛らわしいミスを防ぐため、起動時に
// 読み込んだファイルと不足変数を必ず出力する。
(() => {
  if (!fs.existsSync(envPath)) {
    console.warn(`[env] ⚠ ${envFile} が見つかりません (${envPath}) - 環境変数なしで起動します`);
  } else {
    console.log(`[env] ${envPath} を読み込みました (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  }

  const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
    .filter((name) => !process.env[name]);
  if (missing.length > 0 && process.env.DISABLE_FIREBASE !== 'true') {
    console.warn(`[env] ⚠ Sharegram SSO 未設定: ${missing.join(', ')} がありません。`);
    console.warn('[env]   /api/auth/firebase-session は 503 FIREBASE_NOT_CONFIGURED を返します');
    console.warn('[env]   （Test User でのフォールバックはありません）');
  }
  if (process.env.DISABLE_DB === 'true') {
    console.warn('[env] ⚠ DISABLE_DB=true: DBモックモードのため、SSOユーザーは永続化されません');
  }
})();

// セキュリティミドルウェアをインポート
const { forceHTTPS, securityHeaders, secureCORS } = require('./middleware/security');
const { csrfResponseInterceptor, csrfConfigProvider } = require('./middleware/csrf-interceptor');

// データベース設定をインポート
const { connectDB } = require('./config/db');

// データベース接続
connectDB();

const app = express();

// サーバー実装の露出を防ぐ（X-Powered-By: Express を出さない）
app.disable('x-powered-by');

// HTTPS強制（最初に適用）
app.use(forceHTTPS);

// セキュリティヘッダーの設定
app.use(securityHeaders);

// セキュアなCORS設定
app.use(secureCORS());

// その他のミドルウェア
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false, limit: '20mb' }));

// Cookieパーサー（セッション管理用）
const cookieParser = require('cookie-parser');
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-secret-key'));

// CSRF coordination middleware
app.use(csrfResponseInterceptor);
app.use(csrfConfigProvider);

// リクエストログ用ミドルウェア（デバッグ用）
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// アップロードディレクトリを作成（起動時に1回）
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('アップロードディレクトリを作成しました:', uploadsDir);
  } catch (err) {
    console.error('アップロードディレクトリの作成に失敗しました:', err);
  }
}

// 出演者のアップロードディレクトリを作成
const performersUploadsDir = path.join(__dirname, 'uploads', 'performers');
if (!fs.existsSync(performersUploadsDir)) {
  try {
    fs.mkdirSync(performersUploadsDir, { recursive: true });
    console.log('出演者アップロードディレクトリを作成しました:', performersUploadsDir);
  } catch (err) {
    console.error('出演者アップロードディレクトリの作成に失敗しました:', err);
  }
}

// SECURITY: /uploads is NOT served as static files
// KYC documents must only be accessed via authenticated API endpoints
// e.g. GET /api/performers/:id/documents/:type

// APIルートを設定する前にCORSのpreflight requestを処理
app.options('*', cors());

// CSRF token endpoints
app.use('/api', require('./routes/csrf'));

// Sharegram Simple API disabled: contained hardcoded test API keys (security risk)
// app.use('/api', require('./routes/api-simple-auth'));

// ルート設定（重複を削除）
app.use('/api/auth', require('./routes/auth'));

// /auth/me and /api/auth/me are handled by proper auth routes with authentication middleware

app.use('/api/auth/sso', require('./routes/auth-sso'));

// Sharegram SSO認証ルート
app.use('/api/v1/auth', require('./routes/auth-sharegram-sso'));
// フロントエンドが期待する/api/authパスへのマウントも追加
app.use('/api/auth', require('./routes/auth-sharegram-sso'));

// 【緊急修正】フロントエンド互換性のため /auth パスも追加
app.use('/auth', require('./routes/auth'));
// Rate limiting for Firebase authentication endpoints
const rateLimit = require('express-rate-limit');
const firebaseAuthLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Firebase認証エンドポイント (with rate limiting)
app.use('/api/auth', firebaseAuthLimit, require('./routes/auth-firebase'));
app.use('/auth', firebaseAuthLimit, require('./routes/auth-firebase')); // /auth/firebase-sso でもアクセス可能に

// Firebase公式準拠SSO認証ルート（新実装）
app.use('/api/auth', firebaseAuthLimit, require('./routes/auth-firebase-sso'));
// app.use('/api/auth/firebase', require('./routes/auth-firebase-v2')); // Temporarily disabled due to middleware issues
app.use('/api/performers', require('./routes/performers'));
// 🔒 SECURITY FIX: 監査ログAPIに認証とロールチェックを追加（CVSS 8.8対応）
const auth = require('./middleware/auth');
const checkRole = require('./middleware/checkRole');
app.use('/api/audit-logs', auth, checkRole(['admin']), require('./routes/auditLogs'));
app.use('/api/admin/users', require('./routes/admin-users'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/documents', require('./routes/api/documents'));
app.use('/api/sharegram', require('./routes/sharegram'));

// 【修正】Sharegram専用Performersエンドポイント（Bearer認証対応）
app.use('/api/sharegram/performers', require('./routes/sharegram-performers'));
// app.use('/api/users', require('./routes/users'));
app.use('/test', require('./routes/test-file'));

// 緊急修正: 未マウントルートの追加（APIインフラ修正）
// app.use('/api/webhooks', require('./routes/webhooks')); // Temporarily disabled - missing controller
// app.use('/api/integration', require('./routes/api/integration')); // Temporarily disabled - middleware issues

// v1 API ルート（統合テスト対応）
// app.use('/api/v1', require('./routes/api/v1')); // Temporarily disabled - initialization errors

// Firebase認証仕様準拠ルート（CEOミッション第2段階）
// app.use('/auth', require('./routes/auth-firebase')); // Temporarily disabled - missing Firebase config

// Firebase標準SSO認証ルート（セキュア実装）
app.use('/api/auth', require('./routes/auth-firebase-standard'));

// ===== CEO直轄緊急実装 - Sharegramカスタムトークン API =====
app.use('/api/auth', require('./routes/auth-custom-token-simple'));

// SSO Redirect Test Routes - DISABLED: テストルートがフロントエンドSSOを妨げていたため無効化
// app.use('/', require('./routes/sso-redirect-test'));

// KYC承認Webhook（CEOミッション最終完遂）
// app.use('/api/webhooks', require('./routes/webhooks-kyc-approved')); // Temporarily disabled

// バッチドキュメントアップロード（CEO完全制覇）
// app.use('/api/documents', require('./routes/documents-batch')); // Temporarily disabled

// KYC状態管理エンドポイント（CEO完全制覇ミッション）
// app.use('/api/kyc', require('./routes/kyc-status')); // Temporarily disabled

// 詳細ヘルスチェックエンドポイント（CEO完全制覇ミッション・88%達成）
// app.use('/api/health', require('./routes/health-detailed')); // Temporarily disabled

// emergency-api disabled: contained unauthenticated mock endpoints (security risk)
// app.use('/api', require('./routes/emergency-api'));

// 静的ファイルの配信設定（React build）
const buildPath = path.join(__dirname, '..', 'build');
if (fs.existsSync(buildPath)) {
  console.log('Serving React build from:', buildPath);
  app.use(express.static(buildPath));
} else {
  console.log('React build directory not found:', buildPath);
}

// 簡単なテストエンドポイント
app.get('/', (req, res) => {
  // SPA のメインページをチェック
  const indexPath = path.join(__dirname, '..', 'build', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'SafeVideo API is running!' });
  }
});

// ヘルスチェックエンドポイント（認証不要）
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// SPA フォールバック設定（全てのAPIルート以外をindex.htmlにフォールバック）
app.get('*', (req, res, next) => {
  // APIルートはスキップ
  if (req.originalUrl.startsWith('/api/')) {
    return next();
  }
  
  // 静的ファイルリクエストもスキップ
  const staticExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot'];
  const hasStaticExtension = staticExtensions.some(ext => req.originalUrl.endsWith(ext));
  if (hasStaticExtension) {
    return next();
  }
  
  // React SPAのindex.htmlを返す
  const indexPath = path.join(__dirname, '..', 'build', 'index.html');
  if (fs.existsSync(indexPath)) {
    console.log(`SPA fallback: ${req.originalUrl} -> index.html`);
    res.sendFile(indexPath);
  } else {
    next();
  }
});

// 404エラーハンドラー（フォールバックで処理されなかった場合）
app.use((req, res, next) => {
  res.status(404).json({ message: `Not Found: ${req.originalUrl}` });
});

// multerによるファイルアップロードエラーを処理
app.use((err, req, res, next) => {
  // multerのエラーを特別に処理
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ 
      message: 'ファイルサイズが大きすぎます。5MB以下のファイルをアップロードしてください。' 
    });
  }
  
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ 
      message: '予期しないフィールド名でファイルがアップロードされました。' 
    });
  }
  
  next(err);
});

// CSRF エラーハンドラー
// app.use(csrfErrorHandler); // Temporarily disabled - not defined

// Firebase統合エラーハンドラー
// const { firebaseErrorHandler } = require('./middleware/firebase-error-handler');
// app.use(firebaseErrorHandler);

// 一般的なエラーハンドリングミドルウェア
app.use((err, req, res, next) => {
  console.error(`Error: ${err.message}`);
  console.error(err.stack);

  // 送信済みの場合は Express 既定のハンドラに委譲する
  // （二重送信で "Cannot set headers after they are sent" になるのを防ぐ）
  if (res.headersSent) {
    return next(err);
  }

  if (err.name === 'CorsError') {
    return res.status(403).json({ message: 'CORS error: ' + err.message });
  }

  // AppError は statusCode を、body-parser 等は status を持つ。
  // これを無視すると本来 400/401 であるべき応答が全て 500 になる。
  const declaredStatus = err.statusCode || err.status;
  const statusCode = Number.isInteger(declaredStatus) && declaredStatus >= 400 && declaredStatus < 600
    ? declaredStatus
    : 500;

  res.status(statusCode).json({
    // 4xx は呼び出し側に返す前提のメッセージ、5xx は内部情報を出さない
    message: statusCode >= 500 ? 'サーバーエラーが発生しました' : err.message,
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 5000;

// HTTP サーバーを作成
const server = http.createServer(app);

// WebSocket サーバーを作成
const wss = new WebSocket.Server({ 
  server, 
  path: process.env.WS_PATH || '/ws' 
});

// ヘルスチェックエンドポイント（WebSocket情報を含む）
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    websocket: {
      enabled: process.env.WS_ENABLED === 'true',
      path: process.env.WS_PATH || '/ws',
      connections: wss ? wss.clients.size : 0
    }
  });
});

// WebSocket 接続管理
wss.on('connection', (ws, req) => {
  console.log('WebSocket connection established from:', req.socket.remoteAddress);
  
  // 接続確認メッセージ
  ws.send(JSON.stringify({
    type: 'connection',
    message: 'WebSocket connection established',
    timestamp: new Date().toISOString()
  }));
  
  // メッセージハンドラー
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received WebSocket message:', data);
      
      // エコーレスポンス
      ws.send(JSON.stringify({
        type: 'echo',
        data: data,
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      console.error('WebSocket message parsing error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format',
        timestamp: new Date().toISOString()
      }));
    }
  });
  
  // 切断ハンドラー
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
  
  // エラーハンドラー
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// ヘルスチェック用のハートビート
if (process.env.WS_HEARTBEAT_INTERVAL) {
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      
      ws.isAlive = false;
      ws.ping();
    });
  }, parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000);
  
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });
}

// サーバー起動
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on ${process.env.WS_PATH || '/ws'}`);
  console.log(`CORS is enabled for all origins`);
});