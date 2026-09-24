const request = require('supertest');
const app = require('../../server');
const { User } = require('../../models');
const TestDataGenerator = require('../utils/testDataGenerator');

describe('Authentication Integration Tests', () => {
  let testDataGenerator;

  beforeAll(async () => {
    testDataGenerator = new TestDataGenerator();
  });

  afterEach(async () => {
    await testDataGenerator.cleanup();
  });

  describe('POST /api/auth/register', () => {
    it('新規ユーザー登録が成功する', async () => {
      const userData = testDataGenerator.generateUserData({
        email: 'newuser@example.com',
        password: 'SecurePassword123!'
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData);

      testUtils.expectValidApiResponse(response, 201);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.user).not.toHaveProperty('password');

      // データベース確認
      const user = await User.findOne({ where: { email: userData.email } });
      expect(user).toBeTruthy();
      testDataGenerator.createdRecords.users.push(user.id);
    });

    it('重複メールアドレスで登録に失敗する', async () => {
      const userData = testDataGenerator.generateUserData({
        email: 'duplicate@example.com'
      });

      // 最初のユーザー作成
      await testDataGenerator.createUsers(1, { email: 'duplicate@example.com' });

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData);

      testUtils.expectValidApiResponse(response, 409);
      expect(response.body.error.code).toBe('DUPLICATE_ERROR');
    });

    it('無効なパスワードで登録に失敗する', async () => {
      const userData = testDataGenerator.generateUserData({
        password: '123' // 短すぎるパスワード
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData);

      expect(response).toHaveValidationError('password');
    });

    it('無効なメールアドレスで登録に失敗する', async () => {
      const userData = testDataGenerator.generateUserData({
        email: 'invalid-email'
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData);

      expect(response).toHaveValidationError('email');
    });
  });

  describe('POST /api/auth/login', () => {
    let testUser;

    beforeEach(async () => {
      const users = await testDataGenerator.createUsers(1, {
        email: 'logintest@example.com',
        password: 'TestPassword123!',
        status: 'active'
      });
      testUser = users[0];
    });

    it('正しい認証情報でログインが成功する', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'logintest@example.com',
          password: 'TestPassword123!'
        });

      testUtils.expectValidApiResponse(response, 200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.id).toBe(testUser.id);
      expect(response.body.user).not.toHaveProperty('password');

      // JWTトークンの検証
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(response.body.token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(testUser.id);
      expect(decoded.email).toBe(testUser.email);
    });

    it('間違ったパスワードでログインに失敗する', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'logintest@example.com',
          password: 'WrongPassword'
        });

      testUtils.expectValidApiResponse(response, 401);
      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('存在しないメールアドレスでログインに失敗する', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'TestPassword123!'
        });

      testUtils.expectValidApiResponse(response, 401);
      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('無効化されたユーザーでログインに失敗する', async () => {
      // ユーザーを無効化
      await testUser.update({ status: 'inactive' });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'logintest@example.com',
          password: 'TestPassword123!'
        });

      testUtils.expectValidApiResponse(response, 401);
      expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
    });
  });

  describe('GET /api/auth/me', () => {
    let testUser;
    let authToken;

    beforeEach(async () => {
      const users = await testDataGenerator.createUsers(1, {
        email: 'metest@example.com',
        role: 'user'
      });
      testUser = users[0];
      authToken = testUtils.generateTestToken({
        id: testUser.id,
        email: testUser.email,
        role: testUser.role
      });
    });

    it('認証トークンでユーザー情報を取得できる', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      testUtils.expectValidApiResponse(response, 200);
      expect(response.body.id).toBe(testUser.id);
      expect(response.body.email).toBe(testUser.email);
      expect(response.body).not.toHaveProperty('password');
    });

    it('無効なトークンでユーザー情報取得に失敗する', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      testUtils.expectValidApiResponse(response, 401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('トークンなしでユーザー情報取得に失敗する', async () => {
      const response = await request(app)
        .get('/api/auth/me');

      testUtils.expectValidApiResponse(response, 401);
      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('期限切れトークンでユーザー情報取得に失敗する', async () => {
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        { id: testUser.id, email: testUser.email },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' } // 1時間前に期限切れ
      );

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      testUtils.expectValidApiResponse(response, 401);
      expect(response.body.error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('POST /api/auth/refresh', () => {
    let testUser;
    let refreshToken;

    beforeEach(async () => {
      const users = await testDataGenerator.createUsers(1);
      testUser = users[0];
      
      // リフレッシュトークン生成
      const jwt = require('jsonwebtoken');
      refreshToken = jwt.sign(
        { id: testUser.id, type: 'refresh' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
    });

    it('有効なリフレッシュトークンで新しいアクセストークンを取得できる', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });

      testUtils.expectValidApiResponse(response, 200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('refreshToken');

      // 新しいトークンの検証
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(response.body.token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(testUser.id);
    });

    it('無効なリフレッシュトークンで失敗する', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-refresh-token' });

      testUtils.expectValidApiResponse(response, 401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('POST /api/auth/logout', () => {
    let testUser;
    let authToken;

    beforeEach(async () => {
      const users = await testDataGenerator.createUsers(1);
      testUser = users[0];
      authToken = testUtils.generateTestToken({ id: testUser.id });
    });

    it('認証済みユーザーがログアウトできる', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`);

      testUtils.expectValidApiResponse(response, 200);
      expect(response.body).toHaveProperty('message');
    });

    it('未認証ユーザーはログアウトできない', async () => {
      const response = await request(app)
        .post('/api/auth/logout');

      testUtils.expectValidApiResponse(response, 401);
    });
  });

  describe('Rate Limiting', () => {
    it('ログイン試行回数制限が機能する', async () => {
      const userData = {
        email: 'ratetest@example.com',
        password: 'WrongPassword'
      };

      // 制限回数まで失敗試行
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send(userData);
      }

      // 6回目でレート制限に引っかかる
      const response = await request(app)
        .post('/api/auth/login')
        .send(userData);

      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('Password Security', () => {
    it('パスワードがハッシュ化されて保存される', async () => {
      const userData = testDataGenerator.generateUserData({
        password: 'PlainTextPassword123!'
      });

      await request(app)
        .post('/api/auth/register')
        .send(userData);

      const user = await User.findOne({ where: { email: userData.email } });
      expect(user.password).not.toBe(userData.password);
      expect(user.password).toMatch(/^\$2[aby]\$\d+\$.{53}$/); // bcryptハッシュ形式
      testDataGenerator.createdRecords.users.push(user.id);
    });
  });
});