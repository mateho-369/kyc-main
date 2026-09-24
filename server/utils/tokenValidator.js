/**
 * トークン検証ユーティリティ
 * JWT、Firebase、その他のトークン形式の検証と管理
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { promisify } = require('util');
const redis = require('redis');

// Redisクライアントの初期化（トークンブラックリスト用）
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.connect().catch(console.error);

// Promisify Redis commands
const redisGet = promisify(redisClient.get).bind(redisClient);
const redisSet = promisify(redisClient.set).bind(redisClient);
const redisExpire = promisify(redisClient.expire).bind(redisClient);
const redisDel = promisify(redisClient.del).bind(redisClient);

/**
 * トークンタイプを検出
 * @param {string} token - トークン文字列
 * @returns {string} トークンタイプ
 */
const detectTokenType = (token) => {
  if (!token || typeof token !== 'string') {
    return 'invalid';
  }

  // JWT形式のチェック（3つのドットで区切られた文字列）
  const jwtPattern = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
  if (jwtPattern.test(token)) {
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (decoded && decoded.header) {
        // Firebase JWTの特徴を確認
        if (decoded.payload.iss && decoded.payload.iss.includes('securetoken.google.com')) {
          return 'firebase';
        }
        return 'jwt';
      }
    } catch (error) {
      // デコードエラーの場合もJWT形式として扱う
      return 'jwt';
    }
  }

  // APIキー形式のチェック（プレフィックス付き）
  if (token.startsWith('sk_') || token.startsWith('pk_')) {
    return 'api_key';
  }

  // Bearer トークン形式
  if (token.startsWith('Bearer ')) {
    return 'bearer';
  }

  // その他のカスタムトークン
  return 'custom';
};

/**
 * JWTトークンを検証
 * @param {string} token - JWTトークン
 * @param {string} secret - シークレットキー
 * @returns {Object} デコードされたペイロード
 */
const validateJWT = async (token, secret = process.env.JWT_SECRET) => {
  try {
    // ブラックリストチェック
    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new Error('Token has been revoked');
    }

    // トークンを検証
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256', 'RS256'],
      clockTolerance: 10 // 10秒の時刻誤差を許容
    });

    return {
      valid: true,
      payload: decoded,
      type: 'jwt'
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      type: 'jwt'
    };
  }
};

/**
 * APIキーを検証
 * @param {string} apiKey - APIキー
 * @returns {Object} 検証結果
 */
const validateAPIKey = async (apiKey) => {
  try {
    // データベースまたはキャッシュからAPIキー情報を取得
    const keyInfo = await getAPIKeyInfo(apiKey);
    
    if (!keyInfo) {
      return {
        valid: false,
        error: 'Invalid API key',
        type: 'api_key'
      };
    }

    // 有効期限チェック
    if (keyInfo.expiresAt && new Date() > new Date(keyInfo.expiresAt)) {
      return {
        valid: false,
        error: 'API key has expired',
        type: 'api_key'
      };
    }

    // 使用制限チェック
    if (keyInfo.usageLimit && keyInfo.usageCount >= keyInfo.usageLimit) {
      return {
        valid: false,
        error: 'API key usage limit exceeded',
        type: 'api_key'
      };
    }

    return {
      valid: true,
      payload: keyInfo,
      type: 'api_key'
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      type: 'api_key'
    };
  }
};

/**
 * トークンを検証（汎用）
 * @param {string} token - トークン
 * @param {Object} options - 検証オプション
 * @returns {Object} 検証結果
 */
const validateToken = async (token, options = {}) => {
  const tokenType = detectTokenType(token);

  switch (tokenType) {
    case 'firebase':
      // Firebase認証ミドルウェアで処理されるため、ここではスキップ
      return {
        valid: true,
        type: 'firebase',
        message: 'Firebase token should be validated by Firebase middleware'
      };

    case 'jwt':
      return validateJWT(token, options.secret);

    case 'api_key':
      return validateAPIKey(token);

    case 'bearer':
      // Bearerプレフィックスを除去して再検証
      const actualToken = token.replace('Bearer ', '');
      return validateToken(actualToken, options);

    default:
      return {
        valid: false,
        error: 'Unknown token type',
        type: tokenType
      };
  }
};

/**
 * トークンをブラックリストに追加
 * @param {string} token - トークン
 * @param {number} ttl - 有効期限（秒）
 */
const blacklistToken = async (token, ttl = 86400) => {
  try {
    const key = `blacklist:${token}`;
    await redisSet(key, '1');
    await redisExpire(key, ttl);
    console.log(`Token blacklisted: ${token.substring(0, 20)}...`);
  } catch (error) {
    console.error('Error blacklisting token:', error);
    throw error;
  }
};

/**
 * トークンがブラックリストに存在するかチェック
 * @param {string} token - トークン
 * @returns {boolean} ブラックリストに存在するか
 */
const isTokenBlacklisted = async (token) => {
  try {
    const key = `blacklist:${token}`;
    const result = await redisGet(key);
    return result === '1';
  } catch (error) {
    console.error('Error checking token blacklist:', error);
    return false;
  }
};

/**
 * APIキー情報を取得（キャッシュ付き）
 * @param {string} apiKey - APIキー
 * @returns {Object} APIキー情報
 */
const getAPIKeyInfo = async (apiKey) => {
  try {
    // キャッシュから取得を試みる
    const cacheKey = `apikey:${apiKey}`;
    const cached = await redisGet(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    // データベースから取得（実装が必要）
    // const keyInfo = await APIKey.findOne({ where: { key: apiKey } });
    
    // ダミーデータ（実際の実装では削除）
    const keyInfo = {
      id: 'dummy',
      key: apiKey,
      userId: 'user123',
      name: 'Test API Key',
      permissions: ['read', 'write'],
      expiresAt: null,
      usageLimit: 1000,
      usageCount: 0
    };

    // キャッシュに保存
    if (keyInfo) {
      await redisSet(cacheKey, JSON.stringify(keyInfo));
      await redisExpire(cacheKey, 300); // 5分間キャッシュ
    }

    return keyInfo;
  } catch (error) {
    console.error('Error getting API key info:', error);
    return null;
  }
};

/**
 * トークンのクレームを抽出
 * @param {string} token - トークン
 * @returns {Object} クレーム
 */
const extractClaims = (token) => {
  try {
    const tokenType = detectTokenType(token);
    
    if (tokenType === 'jwt' || tokenType === 'firebase') {
      const decoded = jwt.decode(token);
      return decoded;
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting claims:', error);
    return null;
  }
};

/**
 * リフレッシュトークンを生成
 * @param {Object} payload - ペイロード
 * @returns {string} リフレッシュトークン
 */
const generateRefreshToken = (payload) => {
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
  
  // リフレッシュトークンをRedisに保存
  const key = `refresh:${hashedToken}`;
  const ttl = 30 * 24 * 60 * 60; // 30日
  
  redisSet(key, JSON.stringify({
    ...payload,
    createdAt: new Date().toISOString()
  }));
  redisExpire(key, ttl);
  
  return refreshToken;
};

/**
 * リフレッシュトークンを検証
 * @param {string} refreshToken - リフレッシュトークン
 * @returns {Object} 検証結果
 */
const validateRefreshToken = async (refreshToken) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const key = `refresh:${hashedToken}`;
    const data = await redisGet(key);
    
    if (!data) {
      return {
        valid: false,
        error: 'Invalid refresh token'
      };
    }
    
    const payload = JSON.parse(data);
    return {
      valid: true,
      payload
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
};

/**
 * アクセストークンを更新
 * @param {string} refreshToken - リフレッシュトークン
 * @returns {Object} 新しいトークン
 */
const refreshAccessToken = async (refreshToken) => {
  const validation = await validateRefreshToken(refreshToken);
  
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  
  const { userId, email, role } = validation.payload;
  
  // 新しいアクセストークンを生成
  const accessToken = jwt.sign(
    { userId, email, role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  
  return {
    accessToken,
    refreshToken, // 同じリフレッシュトークンを返す
    expiresIn: 3600
  };
};

module.exports = {
  detectTokenType,
  validateToken,
  validateJWT,
  validateAPIKey,
  blacklistToken,
  isTokenBlacklisted,
  extractClaims,
  generateRefreshToken,
  validateRefreshToken,
  refreshAccessToken
};