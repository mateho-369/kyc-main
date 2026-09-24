// セキュリティミドルウェア
const cors = require('cors');

// HTTPS強制ミドルウェア
const forceHTTPS = (req, res, next) => {
  // 本番環境でのみHTTPS強制を有効化
  if (process.env.NODE_ENV === 'production' || process.env.FORCE_HTTPS === 'true') {
    // プロトコルチェック（X-Forwarded-Protoヘッダーを確認）
    if (req.header('x-forwarded-proto') !== 'https') {
      // HTTPSへリダイレクト
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
  }
  next();
};

// セキュリティヘッダーの設定
const securityHeaders = (req, res, next) => {
  // Strict-Transport-Security (HSTS)
  if (process.env.NODE_ENV === 'production' || process.env.FORCE_HTTPS === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // その他のセキュリティヘッダー
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://*.googleapis.com https://*.google.com",
    "frame-src https://*.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests"
  ].join('; ');

  res.setHeader('Content-Security-Policy', cspDirectives);

  next();
};

// セキュアなCORS設定（拡張版）
const secureCORS = () => {
  // 環境変数から許可オリジンを取得
  const getAllowedOrigins = () => {
    const origins = new Set();

    // 環境変数から既存の設定を追加
    if (process.env.ALLOWED_ORIGINS) {
      process.env.ALLOWED_ORIGINS.split(',').forEach(origin => {
        origins.add(origin.trim());
      });
    }

    // 追加のオリジン（段階的に追加可能）
    const additionalOrigins = [
      'http://localhost:3300',
      'http://api.local-og.com:8000',
      'https://stg.id-manager.com',
      'http://stg.id-manager.com',
      'https://id-manager.com',
      'http://id-manager.com',
      // 旧サーバーのIP直指定の許可を削除。現行の本番とは別ホストであり、
      // IPが第三者に再割当された場合に CORS を許してしまうため。
      // Firebase SSO専用の許可オリジン
      'https://stg-kddi-user.share-gram.com',
      'https://share-gram.com',
      'https://app.share-gram.com',
      'https://kddi-user.share-gram.com',
      'null' // file:// プロトコル対応
    ];

    additionalOrigins.forEach(origin => origins.add(origin));
    return Array.from(origins);
  };

  return cors({
    origin: (origin, callback) => {
      const allowedOrigins = getAllowedOrigins();

      // 開発環境では全てのオリジンを許可
      if (process.env.NODE_ENV === 'development' && !process.env.STRICT_CORS) {
        callback(null, true);
        return;
      }

      // オリジンがない場合（同一オリジン）は許可
      if (!origin) {
        callback(null, true);
        return;
      }

      // 許可リストに完全一致するかチェック
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // サブドメインを含むドメインマッチング
      const isAllowedDomain = allowedOrigins.some(allowed => {
        const allowedDomain = allowed.replace(/^https?:\/\//, '');
        const originDomain = origin.replace(/^https?:\/\//, '');
        return originDomain === allowedDomain || originDomain.endsWith('.' + allowedDomain);
      });

      if (isAllowedDomain) {
        callback(null, true);
      } else {
        if (process.env.CORS_DEBUG) {
          console.log('[CORS] Rejected origin:', origin);
        }
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-CSRF-Token',
      // SecurityEnhancer.generateSecurityHeaders() headers
      'X-Session-Fingerprint',
      'X-Client-Timestamp',
      'X-Security-Version',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'X-XSS-Protection',
      'Strict-Transport-Security',
      // SecureApiClient interceptor headers
      'X-Request-Timestamp',
      'X-Auth-Layer',
      'X-Firebase-Token',
      'X-Client-Version',
      'X-Auth-Token',
      'X-Api-Client',
      'Cookie'
    ],
    exposedHeaders: [
      'X-CSRF-Token',
      'X-CSRF-Token-Refreshed',
      'X-Auth-Token',
      'Set-Cookie'
    ],
    maxAge: 86400,
    optionsSuccessStatus: 200
  });
};

// Cookie設定
const cookieConfig = {
  httpOnly: true,
  secure: false, // 一時的にHTTPでも動作させる（本番環境でHTTP通信のため）
  sameSite: 'lax', // 'strict'から'lax'に変更してクロスサイトでの動作を改善
  path: '/',
  domain: process.env.COOKIE_DOMAIN || '.id-manager.com', // 明示的なドメイン設定
  maxAge: 24 * 60 * 60 * 1000 // 24時間の有効期限を明示
};

// Firebase SSO専用のCORS設定（より厳密）
const firebaseSSO_CORS = () => {
  const firebaseAllowedOrigins = [
    // SharegramのFirebase認証済みドメイン
    'https://stg-kddi-user.share-gram.com',
    'https://share-gram.com',
    'https://app.share-gram.com',
    'https://kddi-user.share-gram.com',
    // KYCサイト自体
    'https://stg.id-manager.com',
    'https://id-manager.com',
    // 開発環境
    'http://localhost:3300',
    'http://api.local-og.com:8000'
  ];

  return cors({
    origin: (origin, callback) => {
      // Firebase SSO専用の厳格なオリジン検証
      if (!origin) {
        // 同一オリジンの場合は許可
        callback(null, true);
        return;
      }

      if (firebaseAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // 開発環境では追加の柔軟性
      if (process.env.NODE_ENV === 'development') {
        callback(null, true);
        return;
      }

      callback(new Error(`Firebase SSO: Origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['POST', 'OPTIONS'], // Firebase SSOは主にPOSTメソッド
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-CSRF-Token'
    ],
    exposedHeaders: ['X-CSRF-Token'],
    maxAge: 300, // 5分（短めに設定）
    optionsSuccessStatus: 200
  });
};

module.exports = {
  forceHTTPS,
  securityHeaders,
  secureCORS,
  firebaseSSO_CORS,
  cookieConfig
};