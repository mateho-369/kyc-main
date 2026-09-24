/**
 * キャッシュミドルウェア
 * ドキュメント共有APIのレスポンスをキャッシュして、パフォーマンスを向上させる
 */

const NodeCache = require('node-cache');
const crypto = require('crypto');

// キャッシュインスタンスの作成（TTL: 5分）
const cache = new NodeCache({ 
  stdTTL: 300, 
  checkperiod: 60,
  useClones: false 
});

/**
 * キャッシュキーを生成する
 * @param {Object} req - Expressリクエストオブジェクト
 * @returns {string} キャッシュキー
 */
const generateCacheKey = (req) => {
  const { originalUrl, method } = req;
  const userId = req.user?.id || 'anonymous';
  
  // URL、メソッド、ユーザーIDを組み合わせてハッシュ化
  const keyString = `${method}:${originalUrl}:${userId}`;
  return crypto.createHash('md5').update(keyString).digest('hex');
};

/**
 * キャッシュミドルウェア
 * @param {number} ttl - キャッシュの有効期限（秒）
 * @returns {Function} Expressミドルウェア
 */
const cacheMiddleware = (ttl = 300) => {
  return (req, res, next) => {
    // GETリクエストのみキャッシュ対象
    if (req.method !== 'GET') {
      return next();
    }

    const key = generateCacheKey(req);
    
    // キャッシュからデータを取得
    const cachedData = cache.get(key);
    
    if (cachedData) {
      console.log(`Cache hit for key: ${key}`);
      return res.json(cachedData);
    }

    // オリジナルのres.jsonをオーバーライド
    const originalJson = res.json.bind(res);
    
    res.json = (data) => {
      // 成功レスポンスのみキャッシュ
      if (res.statusCode === 200) {
        cache.set(key, data, ttl);
        console.log(`Cache set for key: ${key}`);
      }
      
      return originalJson(data);
    };

    next();
  };
};

/**
 * 特定のキャッシュをクリアする
 * @param {string} pattern - クリアするキャッシュのパターン
 */
const clearCache = (pattern = null) => {
  if (pattern) {
    const keys = cache.keys();
    const keysToDelete = keys.filter(key => key.includes(pattern));
    cache.del(keysToDelete);
    console.log(`Cleared ${keysToDelete.length} cache entries matching pattern: ${pattern}`);
  } else {
    cache.flushAll();
    console.log('Cleared all cache entries');
  }
};

/**
 * キャッシュ統計情報を取得
 * @returns {Object} キャッシュ統計情報
 */
const getCacheStats = () => {
  return {
    keys: cache.keys().length,
    hits: cache.getStats().hits,
    misses: cache.getStats().misses,
    ksize: cache.getStats().ksize,
    vsize: cache.getStats().vsize
  };
};

module.exports = {
  cacheMiddleware,
  clearCache,
  getCacheStats
};