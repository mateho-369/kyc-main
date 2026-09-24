const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * JWTトークンを生成
 */
const generateTokens = (payload) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  const accessToken = jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const refreshToken = jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

/**
 * HTTPOnlyクッキーを設定
 */
const setAuthCookies = (res, { accessToken, refreshToken }) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // アクセストークン用クッキー
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000, // 1時間
    path: '/'
  });
  
  // リフレッシュトークン用クッキー
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7日間
    path: '/'
  });
};

/**
 * クッキーをクリア
 */
const clearAuthCookies = (res) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
};

/**
 * ワンタイムコードを生成
 */
const generateOneTimeCode = () => {
  return crypto.randomBytes(32).toString('base64url');
};

/**
 * セキュアなランダム文字列を生成
 */
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

module.exports = {
  generateTokens,
  setAuthCookies,
  clearAuthCookies,
  generateOneTimeCode,
  generateSecureToken
};