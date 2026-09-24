const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');

// Redis接続設定（修復済み）
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  enableOfflineQueue: true,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  retryStrategy: (times) => {
    if (times > 3) return null; // 3回で停止
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  connectTimeout: 10000,
  commandTimeout: 5000
});

// Redis接続エラーハンドリング
redisClient.on('error', (err) => {
  console.error('Redis RateLimiter connection error:', err);
});

redisClient.on('connect', () => {
  console.log('Redis RateLimiter connected successfully');
});

redisClient.on('ready', () => {
  console.log('Redis RateLimiter ready for commands');
});

// デフォルトのレート制限設定
const defaultLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:default:'
  }),
  windowMs: 15 * 60 * 1000, // 15分
  max: 100, // 最大100リクエスト
  message: {
    error: 'リクエスト数が制限を超えました',
    message: '15分後に再度お試しください'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'リクエスト数が制限を超えました',
      message: '15分後に再度お試しください',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

// バッチAPI用の厳格な制限
const batchLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:batch:'
  }),
  windowMs: 15 * 60 * 1000, // 15分
  max: 10, // 最大10リクエスト
  message: {
    error: 'バッチ処理の制限を超えました',
    message: 'バッチ処理は15分間に10回までです'
  }
});

// 認証API用の制限
const authLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:auth:'
  }),
  windowMs: 15 * 60 * 1000, // 15分
  max: 5, // 最大5回の試行
  skipSuccessfulRequests: true, // 成功したリクエストはカウントしない
  message: {
    error: '認証試行回数が制限を超えました',
    message: 'セキュリティのため、15分後に再度お試しください'
  }
});

// 検索API用の制限
const searchLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:search:'
  }),
  windowMs: 1 * 60 * 1000, // 1分
  max: 30, // 最大30リクエスト
  message: {
    error: '検索リクエストが多すぎます',
    message: '1分間に30回までの検索が可能です'
  }
});

// APIキーベースのレート制限
const apiKeyLimiter = (keyField = 'X-API-Key') => {
  return rateLimit({
    store: new RedisStore({
      client: redisClient,
      prefix: 'rl:apikey:'
    }),
    windowMs: 60 * 60 * 1000, // 1時間
    max: 1000, // デフォルト1000リクエスト/時間
    keyGenerator: (req) => {
      return req.headers[keyField.toLowerCase()] || req.ip;
    },
    skip: (req) => {
      // 管理者は制限をスキップ
      return req.user && req.user.role === 'admin';
    },
    handler: async (req, res) => {
      // APIキーの制限を動的に取得
      const apiKey = req.headers[keyField.toLowerCase()];
      if (apiKey) {
        // TODO: データベースからAPIキーの制限を取得
        const customLimit = await getApiKeyLimit(apiKey);
        if (customLimit && req.rateLimit.remaining < 0) {
          res.setHeader('X-RateLimit-Limit', customLimit);
        }
      }
      
      res.status(429).json({
        error: 'API利用制限を超えました',
        message: 'レート制限に達しました。しばらく待ってから再試行してください',
        limit: req.rateLimit.limit,
        remaining: Math.max(0, req.rateLimit.remaining),
        resetTime: new Date(req.rateLimit.resetTime).toISOString()
      });
    }
  });
};

// 動的レート制限（ユーザーのプランに基づく）
const dynamicLimiter = () => {
  return async (req, res, next) => {
    if (!req.user) {
      return defaultLimiter(req, res, next);
    }

    // ユーザーのプランに基づいて制限を設定
    let limit = 100; // デフォルト
    const userPlan = req.user.plan || 'basic';
    
    switch (userPlan) {
      case 'basic':
        limit = 100;
        break;
      case 'pro':
        limit = 500;
        break;
      case 'enterprise':
        limit = 2000;
        break;
    }

    const customLimiter = rateLimit({
      store: new RedisStore({
        client: redisClient,
        prefix: `rl:user:${req.user.id}:`
      }),
      windowMs: 15 * 60 * 1000,
      max: limit,
      keyGenerator: () => req.user.id
    });

    customLimiter(req, res, next);
  };
};

// ユーティリティ関数
async function getApiKeyLimit(apiKey) {
  // TODO: データベースからAPIキーの制限を取得
  return 1000;
}

// レート制限情報を取得
async function getRateLimitInfo(userId) {
  try {
    const key = `rl:user:${userId}:*`;
    const keys = await redisClient.keys(key);
    const info = {};
    
    for (const k of keys) {
      const ttl = await redisClient.ttl(k);
      const count = await redisClient.get(k);
      info[k] = {
        count: parseInt(count),
        resetIn: ttl
      };
    }
    
    return info;
  } catch (error) {
    console.error('レート制限情報取得エラー:', error);
    return null;
  }
}

// レート制限をリセット（管理者用）
async function resetRateLimit(identifier, type = 'user') {
  try {
    const pattern = `rl:${type}:${identifier}:*`;
    const keys = await redisClient.keys(pattern);
    
    if (keys.length > 0) {
      await redisClient.del(...keys);
      return { success: true, keysDeleted: keys.length };
    }
    
    return { success: true, keysDeleted: 0 };
  } catch (error) {
    console.error('レート制限リセットエラー:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  defaultLimiter,
  batchLimiter,
  authLimiter,
  searchLimiter,
  apiKeyLimiter,
  dynamicLimiter,
  getRateLimitInfo,
  resetRateLimit,
  redisClient
};