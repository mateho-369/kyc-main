const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Redis = require('ioredis');
const { User } = require('../models');
const { logger } = require('../utils/logger/logger');
const { auditLogger } = require('../utils/logger/auditLogger');
const { AppError } = require('../utils/errors/AppError');

// Redis接続 (オプショナル - 開発環境では無効化可能)
let redis = null;
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_REDIS === 'true') {
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    db: process.env.REDIS_TOKEN_DB || 3,
    retryDelayOnFailover: 100,
    lazyConnect: true,
    maxRetriesPerRequest: 3
  });
  
  redis.on('error', (err) => {
    console.warn('TokenService Redis connection error:', err.message);
  });
}

class TokenService {
  constructor() {
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    this.JWT_ISSUER = process.env.JWT_ISSUER || 'safevideo-kyc';
    this.JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'safevideo-app';
    
    if (!this.JWT_SECRET) {
      throw new Error('JWT_SECRET is required');
    }
  }

  // Redis操作のヘルパーメソッド（Redisが無効の場合はノーオペレーション）
  async redisOperation(operation) {
    if (!redis) {
      return null; // Redis無効時は何もしない
    }
    try {
      return await operation(redis);
    } catch (error) {
      console.warn('Redis operation failed:', error.message);
      return null;
    }
  }

  /**
   * アクセストークンを生成
   * @param {Object} user - ユーザーオブジェクト
   * @param {Object} options - 追加オプション
   * @returns {string} JWT トークン
   */
  async generateAccessToken(user, options = {}) {
    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        ...(user.sharegramUserId && { sharegramUserId: user.sharegramUserId }),
        ...(user.firebaseUid && { firebaseUid: user.firebaseUid })
      },
      iat: now,
      jti,
      type: 'access',
      ...(options.sso && { sso: true, provider: options.provider })
    };

    const token = jwt.sign(payload, this.JWT_SECRET, {
      expiresIn: options.expiresIn || '15m',
      issuer: this.JWT_ISSUER,
      audience: this.JWT_AUDIENCE
    });

    // トークンメタデータをRedisに保存
    await this.storeTokenMetadata(jti, {
      userId: user.id,
      type: 'access',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(now * 1000 + (options.expiresIn ? this.parseExpiresIn(options.expiresIn) : 15 * 60 * 1000)).toISOString(),
      ip: options.ip,
      userAgent: options.userAgent,
      provider: options.provider
    });

    return token;
  }

  /**
   * リフレッシュトークンを生成
   * @param {Object} user - ユーザーオブジェクト
   * @param {Object} options - 追加オプション
   * @returns {string} JWT リフレッシュトークン
   */
  async generateRefreshToken(user, options = {}) {
    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
      userId: user.id,
      jti,
      type: 'refresh',
      iat: now,
      ...(options.sso && { sso: true, provider: options.provider })
    };

    const token = jwt.sign(payload, this.JWT_REFRESH_SECRET, {
      expiresIn: options.expiresIn || '7d',
      issuer: this.JWT_ISSUER,
      audience: this.JWT_AUDIENCE
    });

    // リフレッシュトークンメタデータをRedisに保存
    await this.storeTokenMetadata(jti, {
      userId: user.id,
      type: 'refresh',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(now * 1000 + (options.expiresIn ? this.parseExpiresIn(options.expiresIn) : 7 * 24 * 60 * 60 * 1000)).toISOString(),
      ip: options.ip,
      userAgent: options.userAgent,
      provider: options.provider
    });

    return token;
  }

  /**
   * トークンを検証
   * @param {string} token - 検証するトークン
   * @param {string} type - トークンタイプ (access/refresh)
   * @returns {Object} デコードされたトークン
   */
  async verifyToken(token, type = 'access') {
    try {
      const secret = type === 'refresh' ? this.JWT_REFRESH_SECRET : this.JWT_SECRET;
      
      const decoded = jwt.verify(token, secret, {
        issuer: this.JWT_ISSUER,
        audience: this.JWT_AUDIENCE
      });

      // トークンタイプ確認
      if (decoded.type !== type) {
        throw new AppError(`Invalid token type. Expected: ${type}, Got: ${decoded.type}`, 401);
      }

      // ブラックリスト確認
      const isBlacklisted = await this.isTokenBlacklisted(decoded.jti);
      if (isBlacklisted) {
        throw new AppError('Token has been revoked', 401);
      }

      // トークンメタデータ確認
      const metadata = await this.getTokenMetadata(decoded.jti);
      // Redis無効時はメタデータなしでも許可（JWT署名検証は済んでいる）
      if (!metadata && redis) {
        throw new AppError('Token metadata not found', 401);
      } else if (!metadata) {
        console.warn(`Token metadata not found for jti: ${decoded.jti} (Redis disabled)`);
      }

      return { ...decoded, metadata };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError('Invalid token', 401);
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError('Token expired', 401);
      }
      throw error;
    }
  }

  /**
   * トークンをリフレッシュ
   * @param {string} refreshToken - リフレッシュトークン
   * @param {Object} options - 追加オプション
   * @returns {Object} 新しいトークンペア
   */
  async refreshTokens(refreshToken, options = {}) {
    try {
      const decoded = await this.verifyToken(refreshToken, 'refresh');
      
      // ユーザー存在確認
      const user = await User.findByPk(decoded.userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // 古いリフレッシュトークンを無効化
      await this.revokeToken(decoded.jti);

      // 新しいトークンペアを生成
      const accessToken = await this.generateAccessToken(user, {
        sso: decoded.sso,
        provider: decoded.provider,
        ip: options.ip,
        userAgent: options.userAgent
      });

      const newRefreshToken = await this.generateRefreshToken(user, {
        sso: decoded.sso,
        provider: decoded.provider,
        ip: options.ip,
        userAgent: options.userAgent
      });

      // 監査ログ
      await auditLogger.log('token_refresh', user.id, options.ip, {
        oldTokenId: decoded.jti,
        provider: decoded.provider,
        userAgent: options.userAgent
      });

      return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: 15 * 60 // 15分
      };
    } catch (error) {
      logger.error('Token refresh error', {
        error: error.message,
        ip: options.ip,
        userAgent: options.userAgent
      });
      throw error;
    }
  }

  /**
   * トークンを取り消し
   * @param {string} tokenId - トークンID (jti)
   * @returns {boolean} 成功フラグ
   */
  async revokeToken(tokenId) {
    try {
      const metadata = await this.getTokenMetadata(tokenId);
      if (!metadata) {
        return false;
      }

      // ブラックリストに追加
      const ttl = Math.floor((new Date(metadata.expiresAt) - new Date()) / 1000);
      if (ttl > 0) {
        await this.redisOperation(r => r.setex(`blacklist:${tokenId}`, ttl, '1'));
      }

      // メタデータ削除
      await this.redisOperation(r => r.del(`token:${tokenId}`));

      return true;
    } catch (error) {
      logger.error('Token revocation error', {
        tokenId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * ユーザーの全トークンを取り消し
   * @param {number} userId - ユーザーID
   * @returns {number} 取り消したトークン数
   */
  async revokeAllUserTokens(userId) {
    try {
      const pattern = `token:*`;
      const keys = await this.redisOperation(r => r.keys(pattern)) || [];
      
      let revokedCount = 0;
      
      for (const key of keys) {
        const metadata = await this.redisOperation(r => r.get(key));
        if (metadata) {
          const data = JSON.parse(metadata);
          if (data.userId === userId) {
            const tokenId = key.replace('token:', '');
            await this.revokeToken(tokenId);
            revokedCount++;
          }
        }
      }

      return revokedCount;
    } catch (error) {
      logger.error('Revoke all user tokens error', {
        userId,
        error: error.message
      });
      return 0;
    }
  }

  /**
   * トークンメタデータを保存
   * @param {string} tokenId - トークンID
   * @param {Object} metadata - メタデータ
   */
  async storeTokenMetadata(tokenId, metadata) {
    const key = `token:${tokenId}`;
    const ttl = Math.floor((new Date(metadata.expiresAt) - new Date()) / 1000);
    
    if (ttl > 0) {
      await this.redisOperation(r => r.setex(key, ttl, JSON.stringify(metadata)));
    }
  }

  /**
   * トークンメタデータを取得
   * @param {string} tokenId - トークンID
   * @returns {Object|null} メタデータ
   */
  async getTokenMetadata(tokenId) {
    const key = `token:${tokenId}`;
    const metadata = await this.redisOperation(r => r.get(key));
    
    return metadata ? JSON.parse(metadata) : null;
  }

  /**
   * トークンがブラックリストに登録されているかチェック
   * @param {string} tokenId - トークンID
   * @returns {boolean} ブラックリスト登録フラグ
   */
  async isTokenBlacklisted(tokenId) {
    const key = `blacklist:${tokenId}`;
    const result = await this.redisOperation(r => r.get(key));
    
    return result === '1';
  }

  /**
   * 有効期限文字列を秒数に変換
   * @param {string} expiresIn - 有効期限文字列 (e.g., '15m', '1h', '7d')
   * @returns {number} 秒数
   */
  parseExpiresIn(expiresIn) {
    const units = {
      's': 1000,
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000
    };

    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error('Invalid expiresIn format');
    }

    const [, amount, unit] = match;
    return parseInt(amount) * units[unit];
  }

  /**
   * トークン統計情報を取得
   * @param {number} userId - ユーザーID
   * @returns {Object} 統計情報
   */
  async getTokenStats(userId) {
    try {
      const pattern = `token:*`;
      const keys = await this.redisOperation(r => r.keys(pattern)) || [];
      
      let accessTokens = 0;
      let refreshTokens = 0;
      let activeTokens = 0;
      
      for (const key of keys) {
        const metadata = await this.redisOperation(r => r.get(key));
        if (metadata) {
          const data = JSON.parse(metadata);
          if (data.userId === userId) {
            if (data.type === 'access') accessTokens++;
            if (data.type === 'refresh') refreshTokens++;
            
            if (new Date(data.expiresAt) > new Date()) {
              activeTokens++;
            }
          }
        }
      }

      return {
        accessTokens,
        refreshTokens,
        activeTokens,
        totalTokens: accessTokens + refreshTokens
      };
    } catch (error) {
      logger.error('Token stats error', {
        userId,
        error: error.message
      });
      return {
        accessTokens: 0,
        refreshTokens: 0,
        activeTokens: 0,
        totalTokens: 0
      };
    }
  }
}

module.exports = new TokenService();