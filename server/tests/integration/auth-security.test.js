const request = require('supertest');
const app = require('../../server');
const { User } = require('../../models');
const tokenService = require('../../services/tokenService');
const Redis = require('ioredis');

describe('Authentication Security Integration Tests', () => {
  let redis;
  let testUser;
  let authToken;

  beforeAll(async () => {
    // Redis connection for testing
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: process.env.REDIS_TEST_DB || 5
    });

    // Create test user
    testUser = await User.create({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
      role: 'user'
    });

    // Generate auth token
    authToken = await tokenService.generateAccessToken(testUser);
  });

  afterAll(async () => {
    // Clean up
    await User.destroy({ where: { email: 'test@example.com' } });
    await redis.flushdb();
    await redis.quit();
  });

  describe('Rate Limiting', () => {
    it('should block excessive login attempts', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrongpassword'
      };

      // Make 6 failed login attempts
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/api/auth/login')
          .send(loginData);
      }

      // 7th attempt should be rate limited
      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData);

      expect(response.status).toBe(429);
      expect(response.body.error).toContain('Too many authentication attempts');
    });

    it('should block excessive SSO requests', async () => {
      const ssoData = {
        sharegram_user_id: 'test123',
        email: 'test@example.com',
        name: 'Test User',
        timestamp: new Date().toISOString(),
        signature: 'invalid_signature'
      };

      // Make 11 failed SSO attempts
      for (let i = 0; i < 11; i++) {
        await request(app)
          .post('/api/auth/sso')
          .send(ssoData);
      }

      // 12th attempt should be rate limited
      const response = await request(app)
        .post('/api/auth/sso')
        .send(ssoData);

      expect(response.status).toBe(429);
      expect(response.body.error).toContain('Too many authentication attempts');
    });
  });

  describe('Token Security', () => {
    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid_token');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('トークンが無効です');
    });

    it('should reject expired tokens', async () => {
      // Create an expired token
      const expiredToken = await tokenService.generateAccessToken(testUser, {
        expiresIn: '-1s' // Already expired
      });

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Token expired');
    });

    it('should reject revoked tokens', async () => {
      // Create a token and then revoke it
      const token = await tokenService.generateAccessToken(testUser);
      const decoded = await tokenService.verifyToken(token, 'access');
      await tokenService.revokeToken(decoded.jti);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Token has been revoked');
    });
  });

  describe('SSO Security', () => {
    it('should reject requests with invalid signatures', async () => {
      const ssoData = {
        sharegram_user_id: 'test123',
        email: 'test@example.com',
        name: 'Test User',
        timestamp: new Date().toISOString(),
        signature: 'invalid_signature'
      };

      const response = await request(app)
        .post('/api/auth/sso')
        .send(ssoData);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid signature');
    });

    it('should reject requests with expired timestamps', async () => {
      const expiredTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      const ssoData = {
        sharegram_user_id: 'test123',
        email: 'test@example.com',
        name: 'Test User',
        timestamp: expiredTimestamp,
        signature: 'test_signature'
      };

      const response = await request(app)
        .post('/api/auth/sso')
        .send(ssoData);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('timestamp is invalid or expired');
    });

    it('should prevent replay attacks', async () => {
      const crypto = require('crypto');
      const timestamp = new Date().toISOString();
      const signature = crypto
        .createHmac('sha256', process.env.SHAREGRAM_SECRET || 'test_secret')
        .update(`test123:test@example.com:${timestamp}`)
        .digest('hex');

      const ssoData = {
        sharegram_user_id: 'test123',
        email: 'test@example.com',
        name: 'Test User',
        timestamp,
        signature
      };

      // First request should succeed
      const response1 = await request(app)
        .post('/api/auth/sso')
        .send(ssoData);

      // Second request with same signature should fail
      const response2 = await request(app)
        .post('/api/auth/sso')
        .send(ssoData);

      expect(response2.status).toBe(401);
      expect(response2.body.error).toContain('Request has already been processed');
    });
  });

  describe('Account Security', () => {
    it('should lock account after failed login attempts', async () => {
      const testUser2 = await User.create({
        name: 'Test User 2',
        email: 'test2@example.com',
        password: 'password123',
        role: 'user'
      });

      const loginData = {
        email: 'test2@example.com',
        password: 'wrongpassword'
      };

      // Make 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send(loginData);
      }

      // 6th attempt should indicate account lock
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test2@example.com', password: 'password123' });

      expect(response.status).toBe(423);
      expect(response.body.error).toContain('アカウントがロックされています');

      // Clean up
      await User.destroy({ where: { email: 'test2@example.com' } });
    });
  });

  describe('Token Refresh Security', () => {
    it('should validate refresh tokens properly', async () => {
      const refreshToken = await tokenService.generateRefreshToken(testUser);

      const response = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refreshToken=${refreshToken}`);

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toBeDefined();
      expect(response.body.expiresIn).toBeDefined();
    });

    it('should reject invalid refresh tokens', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', 'refreshToken=invalid_token');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('認証エラーが発生しました');
    });
  });

  describe('Input Validation', () => {
    it('should validate email format in login', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid_email',
          password: 'password123'
        });

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });

    it('should validate required fields in SSO', async () => {
      const response = await request(app)
        .post('/api/auth/sso')
        .send({
          email: 'test@example.com'
          // Missing required fields
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Validation failed');
    });
  });

  describe('Session Management', () => {
    it('should create and verify SSO sessions', async () => {
      // This test would require proper SSO setup
      // For now, we'll test the session verification endpoint
      const response = await request(app)
        .get('/api/auth/sso/session/verify')
        .query({ sessionId: 'test_session_id' });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toContain('Invalid or expired session');
    });
  });

  describe('Audit Logging', () => {
    it('should log authentication events', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123'
        });

      expect(response.status).toBe(200);
      expect(response.body.requestId).toBeDefined();
      // In a real test, you would check the audit log entries
    });
  });

  describe('Token Management', () => {
    it('should provide token statistics', async () => {
      const response = await request(app)
        .get('/api/auth/sso/token/stats')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.totalTokens).toBeDefined();
    });

    it('should revoke tokens', async () => {
      const token = await tokenService.generateAccessToken(testUser);
      const decoded = await tokenService.verifyToken(token, 'access');

      const response = await request(app)
        .post('/api/auth/sso/token/revoke')
        .send({ tokenId: decoded.jti });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});