const { sequelize } = require('../models');
const Redis = require('ioredis');

// テスト環境変数設定
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@localhost:3306/safevideo_test';
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.REDIS_DB = '15'; // テスト用DB

// Redis接続（テスト用）
let redisClient;

// グローバルセットアップ
beforeAll(async () => {
  // Redis接続
  redisClient = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    db: process.env.REDIS_DB,
    enableOfflineQueue: false
  });

  // データベース同期（テスト用）
  try {
    await sequelize.authenticate();
    console.log('✅ データベース接続成功（テスト環境）');
    
    // テーブル作成（テスト環境では強制リセット）
    await sequelize.sync({ force: true });
    console.log('✅ テストデータベース初期化完了');
  } catch (error) {
    console.error('❌ データベース接続エラー:', error);
    throw error;
  }
});

// グローバルクリーンアップ
afterAll(async () => {
  // Redis クリーンアップ
  if (redisClient) {
    await redisClient.flushdb();
    await redisClient.quit();
  }

  // データベース接続クローズ
  await sequelize.close();
});

// 各テスト後のクリーンアップ
afterEach(async () => {
  // Redis テストデータクリア
  if (redisClient && redisClient.status === 'ready') {
    await redisClient.flushdb();
  }
});

// カスタムマッチャー
expect.extend({
  toBeValidDate(received) {
    const pass = received instanceof Date && !isNaN(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid date`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid date`,
        pass: false,
      };
    }
  },

  toBeValidUUID(received) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = typeof received === 'string' && uuidRegex.test(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid UUID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid UUID`,
        pass: false,
      };
    }
  },

  toHaveValidationError(received, field) {
    const pass = received.status === 400 && 
                  received.body.error && 
                  received.body.error.code === 'VALIDATION_ERROR' &&
                  received.body.error.details.errors.some(err => err.field === field);
    if (pass) {
      return {
        message: () => `expected response not to have validation error for field ${field}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected response to have validation error for field ${field}`,
        pass: false,
      };
    }
  }
});

// テストユーティリティ関数
global.testUtils = {
  // ランダム文字列生成
  randomString: (length = 10) => {
    return Math.random().toString(36).substring(2, length + 2);
  },

  // ランダムメールアドレス生成
  randomEmail: () => {
    return `test_${global.testUtils.randomString()}@example.com`;
  },

  // テスト用遅延
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // レスポンス検証ヘルパー
  expectValidApiResponse: (response, expectedStatus = 200) => {
    expect(response.status).toBe(expectedStatus);
    expect(response.headers['content-type']).toMatch(/json/);
    if (expectedStatus >= 400) {
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
    }
  },

  // JWTトークン生成（テスト用）
  generateTestToken: (payload = {}) => {
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      { id: 1, email: 'test@example.com', role: 'user', ...payload },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  },

  // 管理者トークン生成
  generateAdminToken: (payload = {}) => {
    return global.testUtils.generateTestToken({ role: 'admin', ...payload });
  }
};

// エラーハンドリング
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('🧪 テスト環境セットアップ完了');