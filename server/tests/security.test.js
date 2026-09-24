// セキュリティテスト
const request = require('supertest');
const jwt = require('jsonwebtoken');

// テスト環境の設定
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.FORCE_HTTPS = 'false'; // テスト環境ではHTTPS強制を無効化

describe('セキュリティテスト', () => {
  let app;
  let testUser;

  beforeAll(async () => {
    // サーバーアプリケーションを動的にロード
    app = require('../server');
    
    // テストユーザーを作成
    testUser = {
      email: 'security-test@example.com',
      password: 'SecurePass123!@#',
      name: 'Security Test User'
    };
  });

  describe('1. 認証セキュリティテスト', () => {
    test('無効なパスワードでログインできないこと', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'invalid-password'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('メールアドレスまたはパスワードが正しくありません');
    });

    test('存在しないユーザーでログインできないこと', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('メールアドレスまたはパスワードが正しくありません');
    });
  });

  describe('2. HTTPOnly Cookie実装テスト', () => {
    test('ログイン時にhttpOnly cookieが設定されること', async () => {
      // まずユーザーを登録
      await request(app)
        .post('/api/auth/register')
        .send(testUser);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        });

      expect(response.status).toBe(200);
      
      // レスポンスヘッダーのCookieを確認
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      
      // refreshTokenクッキーの確認
      const refreshTokenCookie = cookies.find(cookie => cookie.includes('refreshToken='));
      expect(refreshTokenCookie).toBeDefined();
      expect(refreshTokenCookie).toContain('HttpOnly');
      expect(refreshTokenCookie).toContain('SameSite=Strict');

      // CSRFトークンクッキーの確認
      const csrfTokenCookie = cookies.find(cookie => cookie.includes('csrfToken='));
      expect(csrfTokenCookie).toBeDefined();
      expect(csrfTokenCookie).not.toContain('HttpOnly'); // JavaScriptから読める

      // レスポンスボディにアクセストークンが含まれていること
      expect(response.body.accessToken).toBeDefined();
      expect(response.body.csrfToken).toBeDefined();
      
      // レスポンスボディにリフレッシュトークンが含まれていないこと（Cookieのみ）
      expect(response.body.refreshToken).toBeUndefined();
    });

    test('アクセストークンの有効期限が短いこと（15分）', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        });

      const token = response.body.accessToken;
      const decoded = jwt.decode(token);
      
      const expiresIn = decoded.exp - decoded.iat;
      expect(expiresIn).toBe(15 * 60); // 15分 = 900秒
    });

    test('トークンリフレッシュが正しく動作すること', async () => {
      // ログインしてリフレッシュトークンを取得
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        });

      const cookies = loginResponse.headers['set-cookie'];
      
      // リフレッシュエンドポイントを呼ぶ
      const refreshResponse = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookies);

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.accessToken).toBeDefined();
      
      // 新しいアクセストークンが以前と異なること
      expect(refreshResponse.body.accessToken).not.toBe(loginResponse.body.accessToken);
    });
  });

  describe('3. HTTPS強制テスト', () => {
    test('セキュリティヘッダーが正しく設定されること', async () => {
      const response = await request(app)
        .get('/');

      // セキュリティヘッダーの確認
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
      expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(response.headers['permissions-policy']).toBe('geolocation=(), microphone=(), camera=()');
      expect(response.headers['content-security-policy']).toBeDefined();
    });

    test('本番環境でHTTPSへのリダイレクトが動作すること', async () => {
      // 本番環境をシミュレート
      process.env.FORCE_HTTPS = 'true';
      
      const response = await request(app)
        .get('/')
        .set('x-forwarded-proto', 'http');

      expect(response.status).toBe(301);
      expect(response.headers.location).toMatch(/^https:\/\//);
      
      // テスト後に環境を戻す
      process.env.FORCE_HTTPS = 'false';
    });

    test('CSP（Content Security Policy）が適切に設定されること', async () => {
      const response = await request(app)
        .get('/');

      const csp = response.headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain('upgrade-insecure-requests');
    });
  });

  describe('4. CORS設定テスト', () => {
    test('許可されたオリジンからのリクエストが受け入れられること', async () => {
      process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://safevideo.com';
      
      const response = await request(app)
        .get('/')
        .set('Origin', 'http://localhost:3000');

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    test('許可されていないオリジンからのリクエストが拒否されること（本番モード）', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://safevideo.com';
      process.env.STRICT_CORS = 'true';
      
      const response = await request(app)
        .get('/')
        .set('Origin', 'http://malicious-site.com');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      
      // テスト環境に戻す
      process.env.NODE_ENV = 'test';
    });
  });

  describe('5. その他のセキュリティテスト', () => {
    test('大きすぎるリクエストボディが拒否されること', async () => {
      const largeData = 'x'.repeat(11 * 1024 * 1024); // 11MB
      
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: largeData
        });

      expect(response.status).toBe(413); // Payload Too Large
    });

    test('CSRFトークンなしのリクエストが拒否されること', async () => {
      // ログインしてトークンを取得
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        });

      const { accessToken } = loginResponse.body;

      // CSRFトークンなしで保護されたエンドポイントにアクセス
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);
      
      // CSRFトークンが必要なエンドポイントでは401または403が返される
      expect([401, 403]).toContain(response.status);
    });
  });
});

// テスト結果のサマリー
afterAll(() => {
  console.log('\n========================================');
  console.log('セキュリティテスト実行完了');
  console.log('========================================\n');
});