const tokenService = require('../services/tokenService');
const { logger } = require('./logger/logger');
const { setAuthCookies } = require('./auth');

const BEARER_PREFIX = 'Bearer ';

/**
 * リクエストに付いてくるアクセストークンを取り出す唯一の場所。
 *
 * 【なぜ共通化するか】
 * このサーバーには「Authorization ヘッダーだけを見る」認証
 * （middleware/auth.js → /api/performers, /api/dashboard, /api/admin/users …）と、
 * 「ヘッダー → Cookie → リフレッシュ」まで見る認証
 * （middleware/auth-enhanced.js → /api/auth/me）の 2 種類があった。
 *
 * その結果、Cookie（httpOnly session）だけでログインしている状態では
 *   GET /api/auth/me            → 200（認証済みと表示される）
 *   GET /api/dashboard/stats    → 401
 * という食い違いが起き、画面が「ログイン済みなのに全部 401」になっていた。
 *
 * 取り出し順:
 *   1. Authorization: Bearer <JWT>   … フロントが localStorage のトークンを付ける通常経路
 *   2. Cookie accessToken            … /auth/login, /auth/firebase-session, /auth/refresh が設定
 *   3. Cookie refreshToken           … アクセストークンが切れていれば交換して新しい Cookie を設定
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} [res] Cookie を更新してよい場合に渡す
 * @returns {Promise<{token: string|null, source: 'header'|'cookie'|'refreshed'|null}>}
 */
async function resolveRequestToken(req, res) {
  const authHeader = req.header('Authorization');
  if (authHeader && authHeader.startsWith(BEARER_PREFIX)) {
    const headerToken = authHeader.slice(BEARER_PREFIX.length).trim();
    if (headerToken) return { token: headerToken, source: 'header' };
  }

  if (req.cookies && req.cookies.accessToken) {
    return { token: req.cookies.accessToken, source: 'cookie' };
  }

  if (req.cookies && req.cookies.refreshToken) {
    try {
      const tokens = await tokenService.refreshTokens(req.cookies.refreshToken, {
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      // 交換に成功したら Cookie を更新する（次回以降のリクエストで使う）
      if (res) setAuthCookies(res, tokens);

      return { token: tokens.accessToken, source: 'refreshed' };
    } catch (error) {
      logger.warn('requestToken: refresh cookie からのトークン更新に失敗', {
        error: error.message,
        path: req.originalUrl
      });
    }
  }

  return { token: null, source: null };
}

module.exports = { resolveRequestToken };
