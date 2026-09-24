const Redis = require('ioredis');
const crypto = require('crypto');

class CacheService {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_CACHE_DB || 1,
      keyPrefix: 'cache:',
      enableOfflineQueue: true,
      maxRetriesPerRequest: null, // 無制限リトライ
      retryDelayOnFailover: 100,
      retryStrategy: (times) => {
        // Redis障害時の耐障害性向上
        if (times > 10) return null; // 10回で停止
        const delay = Math.min(times * 100, 5000); // 最大5秒待機
        console.log(`Redis接続リトライ ${times}回目 (${delay}ms後)`);
        return delay;
      },
      lazyConnect: true, // 遅延接続
      enableReadyCheck: false, // 準備確認を無効化
      connectTimeout: 10000,
      commandTimeout: 5000
    });

    this.defaultTTL = 300; // 5分
    this.isConnected = false;

    this.redis.on('connect', () => {
      this.isConnected = true;
      console.log('キャッシュサービスがRedisに接続されました');
    });

    this.redis.on('error', (err) => {
      console.error('Redisエラー:', err.message);
      this.isConnected = false;
      // Redis障害時はキャッシュ機能を無効化してアプリケーション継続
      console.log('Redis障害のためキャッシュ機能を無効化。アプリケーションは継続動作します。');
    });

    this.redis.on('disconnect', () => {
      console.log('Redis接続が切断されました');
      this.isConnected = false;
    });

    this.redis.on('reconnecting', () => {
      console.log('Redis再接続を試行中...');
    });
  }

  /**
   * キーの生成
   */
  generateKey(namespace, params) {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {});
    
    const paramString = JSON.stringify(sortedParams);
    const hash = crypto.createHash('md5').update(paramString).digest('hex');
    
    return `${namespace}:${hash}`;
  }

  /**
   * キャッシュから取得
   */
  async get(key) {
    if (!this.isConnected) return null;

    try {
      const data = await this.redis.get(key);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('キャッシュ取得エラー:', error);
      return null;
    }
  }

  /**
   * キャッシュに保存
   */
  async set(key, value, ttl = this.defaultTTL) {
    if (!this.isConnected) return false;

    try {
      const serialized = JSON.stringify(value);
      if (ttl > 0) {
        await this.redis.setex(key, ttl, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
      return true;
    } catch (error) {
      console.error('キャッシュ保存エラー:', error);
      return false;
    }
  }

  /**
   * キャッシュを削除
   */
  async del(key) {
    if (!this.isConnected) return false;

    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      console.error('キャッシュ削除エラー:', error);
      return false;
    }
  }

  /**
   * パターンマッチでキャッシュを削除
   */
  async delPattern(pattern) {
    if (!this.isConnected) return 0;

    try {
      const keys = await this.redis.keys(`cache:${pattern}`);
      if (keys.length > 0) {
        // cache:プレフィックスを削除
        const keysWithoutPrefix = keys.map(k => k.replace('cache:', ''));
        const deleted = await this.redis.del(...keysWithoutPrefix);
        return deleted;
      }
      return 0;
    } catch (error) {
      console.error('パターン削除エラー:', error);
      return 0;
    }
  }

  /**
   * キャッシュのTTLを取得
   */
  async ttl(key) {
    if (!this.isConnected) return -1;

    try {
      const ttl = await this.redis.ttl(key);
      return ttl;
    } catch (error) {
      console.error('TTL取得エラー:', error);
      return -1;
    }
  }

  /**
   * キャッシュの存在確認
   */
  async exists(key) {
    if (!this.isConnected) return false;

    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      console.error('存在確認エラー:', error);
      return false;
    }
  }

  /**
   * キャッシュミドルウェア
   */
  middleware(namespace, ttl = 300, keyGenerator) {
    return async (req, res, next) => {
      if (!this.isConnected) {
        return next();
      }

      // キャッシュキーの生成
      const cacheKey = keyGenerator 
        ? keyGenerator(req)
        : this.generateKey(namespace, {
            method: req.method,
            url: req.originalUrl,
            query: req.query,
            userId: req.user?.id
          });

      // キャッシュから取得を試みる
      const cached = await this.get(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-TTL', await this.ttl(cacheKey));
        return res.json(cached);
      }

      // キャッシュミス
      res.setHeader('X-Cache', 'MISS');

      // レスポンスをインターセプトしてキャッシュに保存
      const originalJson = res.json;
      res.json = (body) => {
        res.json = originalJson;
        
        // 成功レスポンスのみキャッシュ
        if (res.statusCode >= 200 && res.statusCode < 300) {
          this.set(cacheKey, body, ttl).catch(console.error);
        }
        
        return originalJson.call(res, body);
      };

      next();
    };
  }

  /**
   * キャッシュ統計の取得
   */
  async getStats() {
    if (!this.isConnected) {
      return { connected: false };
    }

    try {
      const info = await this.redis.info('stats');
      const dbSize = await this.redis.dbsize();
      
      // infoパース
      const stats = {};
      info.split('\n').forEach(line => {
        const [key, value] = line.split(':');
        if (key && value) {
          stats[key.trim()] = value.trim();
        }
      });

      return {
        connected: true,
        dbSize,
        hits: parseInt(stats.keyspace_hits || 0),
        misses: parseInt(stats.keyspace_misses || 0),
        hitRate: stats.keyspace_hits && stats.keyspace_misses
          ? (parseInt(stats.keyspace_hits) / (parseInt(stats.keyspace_hits) + parseInt(stats.keyspace_misses)) * 100).toFixed(2) + '%'
          : 'N/A',
        usedMemory: stats.used_memory_human,
        uptime: parseInt(stats.uptime_in_seconds || 0)
      };
    } catch (error) {
      console.error('統計取得エラー:', error);
      return { connected: false, error: error.message };
    }
  }

  /**
   * キャッシュのクリア
   */
  async flush() {
    if (!this.isConnected) return false;

    try {
      await this.redis.flushdb();
      return true;
    } catch (error) {
      console.error('キャッシュクリアエラー:', error);
      return false;
    }
  }

  /**
   * 接続を閉じる
   */
  async close() {
    await this.redis.quit();
    this.isConnected = false;
  }
}

// シングルトンインスタンス
const cacheService = new CacheService();

// キャッシュ戦略
const CacheStrategies = {
  // 検索結果キャッシュ（5分）
  SEARCH_RESULTS: {
    namespace: 'search',
    ttl: 300
  },
  
  // 統計データキャッシュ（15分）
  ANALYTICS: {
    namespace: 'analytics',
    ttl: 900
  },
  
  // ユーザー情報キャッシュ（10分）
  USER_DATA: {
    namespace: 'user',
    ttl: 600
  },
  
  // パフォーマー詳細キャッシュ（5分）
  PERFORMER_DETAIL: {
    namespace: 'performer',
    ttl: 300
  },
  
  // ダッシュボードキャッシュ（2分）
  DASHBOARD: {
    namespace: 'dashboard',
    ttl: 120
  }
};

module.exports = {
  cacheService,
  CacheStrategies
};