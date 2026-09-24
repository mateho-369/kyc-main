const redis = require('redis');
const NodeCache = require('node-cache');
const { promisify } = require('util');
const crypto = require('crypto');

/**
 * 多層キャッシュ戦略実装
 * L1: メモリキャッシュ（NodeCache）- 超高速アクセス
 * L2: Redis - 分散キャッシュ
 * L3: データベース - 永続化層
 */
class CacheStrategy {
  constructor() {
    // L1キャッシュ: インメモリ
    this.memoryCache = new NodeCache({
      stdTTL: 60, // デフォルト60秒
      checkperiod: 120, // 120秒ごとに期限切れチェック
      maxKeys: 10000, // 最大10000キー
      useClones: false // パフォーマンス向上のためクローンを無効化
    });

    // L2キャッシュ: Redis
    this.redisClient = redis.createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          console.error('Redis接続エラー');
          return new Error('Redis接続失敗');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          return new Error('Redis再試行タイムアウト');
        }
        if (options.attempt > 10) {
          return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
      }
    });

    // Redis操作のPromise化
    this.redisGet = promisify(this.redisClient.get).bind(this.redisClient);
    this.redisSet = promisify(this.redisClient.set).bind(this.redisClient);
    this.redisDel = promisify(this.redisClient.del).bind(this.redisClient);
    this.redisExists = promisify(this.redisClient.exists).bind(this.redisClient);
    this.redisTTL = promisify(this.redisClient.ttl).bind(this.redisClient);
    this.redisMulti = this.redisClient.multi.bind(this.redisClient);

    // キャッシュ統計
    this.stats = {
      hits: { l1: 0, l2: 0 },
      misses: { l1: 0, l2: 0 },
      sets: { l1: 0, l2: 0 },
      deletes: { l1: 0, l2: 0 },
      errors: { l1: 0, l2: 0 }
    };

    // エラーハンドリング
    this.redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
      this.stats.errors.l2++;
    });

    this.memoryCache.on('error', (err) => {
      console.error('Memory Cache Error:', err);
      this.stats.errors.l1++;
    });
  }

  /**
   * キャッシュキーの生成
   */
  generateKey(prefix, ...parts) {
    const keyParts = [prefix, ...parts.map(p => String(p))].filter(Boolean);
    return keyParts.join(':');
  }

  /**
   * キャッシュキーのハッシュ化（長いキー対策）
   */
  hashKey(key) {
    if (key.length > 250) { // Redisキー制限対策
      const hash = crypto.createHash('sha256').update(key).digest('hex');
      return `hashed:${hash}`;
    }
    return key;
  }

  /**
   * 多層キャッシュから値を取得
   */
  async get(key, options = {}) {
    const hashedKey = this.hashKey(key);
    
    // L1: メモリキャッシュチェック
    try {
      const memValue = this.memoryCache.get(hashedKey);
      if (memValue !== undefined) {
        this.stats.hits.l1++;
        return memValue;
      }
      this.stats.misses.l1++;
    } catch (err) {
      console.error('L1キャッシュエラー:', err);
      this.stats.errors.l1++;
    }

    // L2: Redisキャッシュチェック
    try {
      const redisValue = await this.redisGet(hashedKey);
      if (redisValue) {
        this.stats.hits.l2++;
        const parsed = JSON.parse(redisValue);
        
        // L1にも保存（Read-through）
        if (options.cacheToL1 !== false) {
          this.memoryCache.set(hashedKey, parsed, options.l1TTL || 60);
          this.stats.sets.l1++;
        }
        
        return parsed;
      }
      this.stats.misses.l2++;
    } catch (err) {
      console.error('L2キャッシュエラー:', err);
      this.stats.errors.l2++;
    }

    return null;
  }

  /**
   * 多層キャッシュに値を設定
   */
  async set(key, value, options = {}) {
    const hashedKey = this.hashKey(key);
    const ttl = options.ttl || 300; // デフォルト5分

    // L1: メモリキャッシュに保存
    if (options.cacheToL1 !== false) {
      try {
        this.memoryCache.set(hashedKey, value, options.l1TTL || Math.min(ttl, 60));
        this.stats.sets.l1++;
      } catch (err) {
        console.error('L1キャッシュ設定エラー:', err);
        this.stats.errors.l1++;
      }
    }

    // L2: Redisに保存
    if (options.cacheToL2 !== false) {
      try {
        await this.redisSet(hashedKey, JSON.stringify(value), 'EX', ttl);
        this.stats.sets.l2++;
      } catch (err) {
        console.error('L2キャッシュ設定エラー:', err);
        this.stats.errors.l2++;
      }
    }

    return true;
  }

  /**
   * キャッシュから値を削除
   */
  async delete(key) {
    const hashedKey = this.hashKey(key);

    // L1から削除
    try {
      this.memoryCache.del(hashedKey);
      this.stats.deletes.l1++;
    } catch (err) {
      console.error('L1キャッシュ削除エラー:', err);
      this.stats.errors.l1++;
    }

    // L2から削除
    try {
      await this.redisDel(hashedKey);
      this.stats.deletes.l2++;
    } catch (err) {
      console.error('L2キャッシュ削除エラー:', err);
      this.stats.errors.l2++;
    }

    return true;
  }

  /**
   * パターンマッチングでキャッシュを削除
   */
  async deletePattern(pattern) {
    // L1: メモリキャッシュから削除
    const memKeys = this.memoryCache.keys();
    const matchedMemKeys = memKeys.filter(key => key.match(pattern));
    matchedMemKeys.forEach(key => {
      this.memoryCache.del(key);
      this.stats.deletes.l1++;
    });

    // L2: Redisから削除（SCAN使用）
    return new Promise((resolve, reject) => {
      const stream = this.redisClient.scanStream({
        match: pattern,
        count: 100
      });

      stream.on('data', async (keys) => {
        if (keys.length) {
          const pipeline = this.redisClient.pipeline();
          keys.forEach(key => {
            pipeline.del(key);
            this.stats.deletes.l2++;
          });
          await pipeline.exec();
        }
      });

      stream.on('end', () => resolve(true));
      stream.on('error', (err) => {
        console.error('Redis SCAN エラー:', err);
        reject(err);
      });
    });
  }

  /**
   * キャッシュの自動読み込み
   */
  async getOrSet(key, fetchFunction, options = {}) {
    // キャッシュから取得試行
    const cached = await this.get(key, options);
    if (cached !== null) {
      return cached;
    }

    // キャッシュミスの場合、データを取得
    try {
      const data = await fetchFunction();
      
      // 取得したデータをキャッシュに保存
      if (data !== null && data !== undefined) {
        await this.set(key, data, options);
      }
      
      return data;
    } catch (err) {
      console.error('データ取得エラー:', err);
      throw err;
    }
  }

  /**
   * バッチキャッシュ取得
   */
  async mget(keys) {
    const results = {};
    const missingKeys = [];

    // L1チェック
    for (const key of keys) {
      const hashedKey = this.hashKey(key);
      try {
        const value = this.memoryCache.get(hashedKey);
        if (value !== undefined) {
          results[key] = value;
          this.stats.hits.l1++;
        } else {
          missingKeys.push(key);
          this.stats.misses.l1++;
        }
      } catch (err) {
        missingKeys.push(key);
        this.stats.errors.l1++;
      }
    }

    // L2チェック（L1でミスしたキーのみ）
    if (missingKeys.length > 0) {
      const hashedMissingKeys = missingKeys.map(k => this.hashKey(k));
      
      try {
        const pipeline = this.redisClient.pipeline();
        hashedMissingKeys.forEach(key => pipeline.get(key));
        const redisResults = await pipeline.exec();
        
        redisResults.forEach((result, index) => {
          const [err, value] = result;
          const originalKey = missingKeys[index];
          
          if (!err && value) {
            const parsed = JSON.parse(value);
            results[originalKey] = parsed;
            this.stats.hits.l2++;
            
            // L1にも保存
            this.memoryCache.set(hashedMissingKeys[index], parsed, 60);
            this.stats.sets.l1++;
          } else {
            this.stats.misses.l2++;
          }
        });
      } catch (err) {
        console.error('L2バッチ取得エラー:', err);
        this.stats.errors.l2++;
      }
    }

    return results;
  }

  /**
   * キャッシュウォーミング
   */
  async warmUp(keys, fetchFunction) {
    const batchSize = 50;
    const results = [];

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      const promises = batch.map(async (key) => {
        try {
          const data = await fetchFunction(key);
          if (data) {
            await this.set(key, data, { ttl: 3600 }); // 1時間
            return { key, status: 'success' };
          }
          return { key, status: 'no-data' };
        } catch (err) {
          return { key, status: 'error', error: err.message };
        }
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * キャッシュ統計の取得
   */
  getStats() {
    const l1HitRate = this.stats.hits.l1 / (this.stats.hits.l1 + this.stats.misses.l1) || 0;
    const l2HitRate = this.stats.hits.l2 / (this.stats.hits.l2 + this.stats.misses.l2) || 0;

    return {
      ...this.stats,
      hitRates: {
        l1: (l1HitRate * 100).toFixed(2) + '%',
        l2: (l2HitRate * 100).toFixed(2) + '%'
      },
      memoryUsage: this.memoryCache.getStats()
    };
  }

  /**
   * キャッシュ統計のリセット
   */
  resetStats() {
    this.stats = {
      hits: { l1: 0, l2: 0 },
      misses: { l1: 0, l2: 0 },
      sets: { l1: 0, l2: 0 },
      deletes: { l1: 0, l2: 0 },
      errors: { l1: 0, l2: 0 }
    };
  }

  /**
   * クリーンアップ
   */
  async cleanup() {
    this.memoryCache.flushAll();
    this.redisClient.quit();
  }
}

// シングルトンインスタンス
const cacheStrategy = new CacheStrategy();

module.exports = {
  cacheStrategy,
  CacheStrategy
};