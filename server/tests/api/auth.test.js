const request = require('supertest');
const app = require('../../server');
const { User } = require('../../models');
const jwt = require('jsonwebtoken');

describe('Auth API Tests', () => {
  let testUser;
  let authToken;

  beforeAll(async () => {
    // テスト用ユーザー作成
    testUser = await User.create({
      email: 'test@example.com',
      password: 'testPassword123',
      name: 'Test User',
      role: 'user'
    });
  });

  afterAll(async () => {
    // クリーンアップ
    if (testUser) {
      await User.destroy({ where: { id: testUser.id } });
    }
  });

  describe('POST /api/auth/login', () => {
    it('正しい認証情報でログイン成功', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'testPassword123'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe('test@example.com');

      authToken = response.body.token;
    });

    it('間違ったパスワードでログイン失敗', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongPassword'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message', 'メールアドレスまたはパスワードが正しくありません');
    });

    it('存在しないユーザーでログイン失敗', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'anyPassword'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message', 'メールアドレスまたはパスワードが正しくありません');
    });
  });

  describe('GET /api/auth/me', () => {
    it('有効なトークンで認証ユーザー情報取得', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', testUser.id);
      expect(response.body).toHaveProperty('email', 'test@example.com');
      expect(response.body).not.toHaveProperty('password');
    });

    it('トークンなしでアクセス失敗', async () => {
      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('message', '認証トークンがありません。アクセスが拒否されました。');
    });

    it('無効なトークンでアクセス失敗', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('message', 'トークンが無効です');
    });
  });

  describe('Hybrid Auth Middleware', () => {
    it('JWTトークンで認証成功', async () => {
      const response = await request(app)
        .get('/api/v1/analytics/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).not.toBe(401);
    });

    it('Firebase Token ヘッダーを認識', async () => {
      // Firebase Tokenのモック（実際のテストでは有効なトークンが必要）
      const mockFirebaseToken = 'mock-firebase-token';
      
      const response = await request(app)
        .get('/api/v1/analytics/stats')
        .set('Firebase-Token', mockFirebaseToken);

      // Firebase Admin SDKが初期化されていない場合はエラーになる
      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });
  });
});

describe('API Rate Limiting', () => {
  it('レート制限が機能することを確認', async () => {
    // 短時間に大量のリクエストを送信
    const requests = [];
    for (let i = 0; i < 150; i++) {
      requests.push(
        request(app)
          .get('/api/v1/webhooks/events/list')
      );
    }

    const responses = await Promise.all(requests);
    
    // 一部のリクエストがレート制限に引っかかることを確認
    const rateLimitedResponses = responses.filter(r => r.status === 429);
    expect(rateLimitedResponses.length).toBeGreaterThan(0);
  });
});