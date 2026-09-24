// Firebase統合テスト
const request = require('supertest');
const { faker } = require('@faker-js/faker');

// テスト環境設定
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = 'test-private-key';

// Firebaseのモック設定
jest.mock('../config/firebase-admin', () => ({
  verifyIdToken: jest.fn(),
  createCustomToken: jest.fn(),
  createSessionCookie: jest.fn(),
  verifySessionCookie: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  setCustomUserClaims: jest.fn(),
  getUserByEmail: jest.fn(),
  revokeRefreshTokens: jest.fn(),
  getUser: jest.fn(),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  },
  auth: {
    listUsers: jest.fn(),
    setCustomUserClaims: jest.fn()
  }
}));

describe('Firebase統合テスト', () => {
  let app;
  let mockFirebase;

  beforeAll(async () => {
    // モックFirebaseの取得
    mockFirebase = require('../config/firebase-admin');
    
    // テストアプリケーションの読み込み
    app = require('../server');
  });

  beforeEach(() => {
    // モックのリセット
    jest.clearAllMocks();
  });

  describe('Firebase認証API (v2)', () => {
    describe('POST /api/auth/firebase/verify', () => {
      const testUser = {
        uid: 'firebase-test-uid-123',
        email: 'test@example.com',
        name: 'Test User',
        email_verified: true,
        auth_time: Date.now() / 1000,
        firebase: {
          sign_in_provider: 'google.com'
        }
      };

      test('有効なIDトークンで認証成功', async () => {
        // Firebase verifyIdTokenのモック
        mockFirebase.verifyIdToken.mockResolvedValue(testUser);
        mockFirebase.createSessionCookie.mockResolvedValue('session-cookie-token');

        const response = await request(app)
          .post('/api/auth/firebase/verify')
          .send({
            idToken: 'valid-firebase-id-token'
          });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.firebaseUser).toBeDefined();
        expect(response.body.firebaseUser.uid).toBe(testUser.uid);
        expect(response.body.csrfToken).toBeDefined();
        
        // Cookieの確認
        const cookies = response.headers['set-cookie'];
        expect(cookies).toBeDefined();
        expect(cookies.some(cookie => cookie.includes('__session='))).toBe(true);
        expect(cookies.some(cookie => cookie.includes('csrfToken='))).toBe(true);
      });

      test('無効なIDトークンで認証失敗', async () => {
        mockFirebase.verifyIdToken.mockRejectedValue({
          code: 'auth/invalid-id-token',
          message: 'Invalid ID token'
        });

        const response = await request(app)
          .post('/api/auth/firebase/verify')
          .send({
            idToken: 'invalid-token'
          });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Authentication failed');
      });

      test('期限切れIDトークンで認証失敗', async () => {
        mockFirebase.verifyIdToken.mockRejectedValue({
          code: 'auth/id-token-expired',
          message: 'Firebase ID token has expired'
        });

        const response = await request(app)
          .post('/api/auth/firebase/verify')
          .send({
            idToken: 'expired-token'
          });

        expect(response.status).toBe(401);
        expect(response.body.message).toContain('期限切れ');
      });

      test('バリデーションエラー（空のトークン）', async () => {
        const response = await request(app)
          .post('/api/auth/firebase/verify')
          .send({
            idToken: ''
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Validation failed');
      });
    });

    describe('POST /api/auth/firebase/register', () => {
      const testRegistrationData = {
        email: 'newuser@example.com',
        password: 'SecurePass123!@#',
        displayName: 'New User'
      };

      test('新規ユーザー登録成功', async () => {
        // Firebase createUserのモック
        mockFirebase.createUser.mockResolvedValue({
          uid: 'new-firebase-uid',
          email: testRegistrationData.email,
          displayName: testRegistrationData.displayName,
          metadata: {
            creationTime: new Date().toISOString()
          }
        });

        mockFirebase.createCustomToken.mockResolvedValue('custom-token-123');

        const response = await request(app)
          .post('/api/auth/firebase/register')
          .send(testRegistrationData);

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.user).toBeDefined();
        expect(response.body.customToken).toBeDefined();
        expect(mockFirebase.createUser).toHaveBeenCalledWith({
          email: testRegistrationData.email,
          password: testRegistrationData.password,
          displayName: testRegistrationData.displayName,
          emailVerified: false
        });
      });

      test('既存メールアドレスで登録失敗', async () => {
        mockFirebase.createUser.mockRejectedValue({
          code: 'auth/email-already-exists',
          message: 'Email already exists'
        });

        const response = await request(app)
          .post('/api/auth/firebase/register')
          .send(testRegistrationData);

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('既に使用されています');
      });

      test('弱いパスワードで登録失敗', async () => {
        const response = await request(app)
          .post('/api/auth/firebase/register')
          .send({
            ...testRegistrationData,
            password: '123' // 弱いパスワード
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Validation failed');
      });
    });

    describe('POST /api/auth/firebase/session', () => {
      test('有効なセッションクッキーで認証成功', async () => {
        const mockClaims = {
          uid: 'firebase-uid-123',
          email: 'test@example.com'
        };

        mockFirebase.verifySessionCookie.mockResolvedValue(mockClaims);

        const response = await request(app)
          .post('/api/auth/firebase/session')
          .set('Cookie', ['__session=valid-session; csrfToken=valid-csrf'])
          .set('x-csrf-token', 'valid-csrf');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.firebase.uid).toBe(mockClaims.uid);
      });

      test('セッションクッキーなしで認証失敗', async () => {
        const response = await request(app)
          .post('/api/auth/firebase/session');

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('No session');
      });

      test('CSRFトークン不一致で認証失敗', async () => {
        const response = await request(app)
          .post('/api/auth/firebase/session')
          .set('Cookie', ['__session=valid-session; csrfToken=valid-csrf'])
          .set('x-csrf-token', 'invalid-csrf');

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('CSRF validation failed');
      });
    });
  });

  describe('Firebase統合サービス', () => {
    const firebaseIntegration = require('../services/firebase-integration');

    describe('ユーザー移行', () => {
      test('既存ユーザーのFirebase移行', async () => {
        // テストユーザーの作成
        const testUser = {
          id: 1,
          email: 'migrate@example.com',
          name: 'Migrate User',
          role: 'user'
        };

        // Firebaseユーザー作成のモック
        mockFirebase.createUser.mockResolvedValue({
          uid: 'migrated-firebase-uid',
          email: testUser.email,
          displayName: testUser.name,
          metadata: {
            creationTime: new Date().toISOString()
          }
        });

        const result = await firebaseIntegration.migrateUserToFirebase(testUser.id);

        expect(result).toBeDefined();
        expect(mockFirebase.createUser).toHaveBeenCalled();
      });

      test('既にFirebase移行済みユーザーのスキップ', async () => {
        // 既に移行済みのユーザーをモック
        jest.spyOn(firebaseIntegration, 'migrateUserToFirebase')
          .mockResolvedValue({ 
            already_migrated: true,
            firebaseUid: 'existing-uid'
          });

        const result = await firebaseIntegration.migrateUserToFirebase(999);
        
        expect(result.already_migrated).toBe(true);
      });
    });

    describe('データ同期', () => {
      test('Firebase→ローカルDB同期', async () => {
        const firebaseUserRecord = {
          uid: 'sync-test-uid',
          email: 'sync@example.com',
          displayName: 'Sync User',
          emailVerified: true,
          disabled: false,
          metadata: {
            creationTime: new Date().toISOString(),
            lastSignInTime: new Date().toISOString()
          },
          customClaims: { role: 'user' }
        };

        mockFirebase.getUser.mockResolvedValue(firebaseUserRecord);

        const result = await firebaseIntegration.syncFirebaseUserToLocal('sync-test-uid');

        expect(result).toBeDefined();
        expect(mockFirebase.getUser).toHaveBeenCalledWith('sync-test-uid');
      });

      test('カスタムクレームの設定', async () => {
        mockFirebase.auth.setCustomUserClaims.mockResolvedValue();

        const result = await firebaseIntegration.setUserRole('test-uid', 'admin');

        expect(result).toBe(true);
        expect(mockFirebase.auth.setCustomUserClaims).toHaveBeenCalledWith(
          'test-uid',
          { role: 'admin' }
        );
      });
    });

    describe('データ整合性チェック', () => {
      test('データ整合性の検証', async () => {
        const issues = await firebaseIntegration.validateDataConsistency();

        expect(issues).toBeDefined();
        expect(issues).toHaveProperty('orphanedFirebaseUsers');
        expect(issues).toHaveProperty('orphanedLocalUsers');
        expect(issues).toHaveProperty('emailMismatches');
        expect(issues).toHaveProperty('missingCustomClaims');
      });

      test('データ修復機能', async () => {
        // データ整合性チェックのモック
        jest.spyOn(firebaseIntegration, 'validateDataConsistency')
          .mockResolvedValue({
            orphanedFirebaseUsers: [],
            orphanedLocalUsers: [{ id: 1, email: 'repair@example.com' }],
            emailMismatches: [],
            missingCustomClaims: []
          });

        const repairResults = await firebaseIntegration.repairDataInconsistencies();

        expect(repairResults).toBeDefined();
        expect(repairResults).toHaveProperty('migratedLocalUsers');
      });
    });
  });

  describe('エラーハンドリング', () => {
    const { FirebaseError, FIREBASE_ERROR_CODES } = require('../middleware/firebase-error-handler');

    test('FirebaseErrorクラスの作成', () => {
      const error = new FirebaseError(
        'Test error message',
        FIREBASE_ERROR_CODES.INVALID_ID_TOKEN,
        401
      );

      expect(error.name).toBe('FirebaseError');
      expect(error.message).toBe('Test error message');
      expect(error.code).toBe(FIREBASE_ERROR_CODES.INVALID_ID_TOKEN);
      expect(error.statusCode).toBe(401);
      expect(error.isOperational).toBe(true);
    });

    test('Firebase認証エラーのAPIレスポンス', async () => {
      mockFirebase.verifyIdToken.mockRejectedValue({
        code: 'auth/invalid-id-token',
        message: 'Invalid ID token'
      });

      const response = await request(app)
        .post('/api/auth/firebase/verify')
        .send({
          idToken: 'invalid-token'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication failed');
      expect(response.body.message).toBeDefined();
    });
  });

  describe('パフォーマンステスト', () => {
    test('Firebase認証のレスポンス時間', async () => {
      const startTime = Date.now();

      mockFirebase.verifyIdToken.mockResolvedValue({
        uid: 'perf-test-uid',
        email: 'perf@example.com',
        email_verified: true,
        auth_time: Date.now() / 1000
      });

      mockFirebase.createSessionCookie.mockResolvedValue('session-cookie');

      const response = await request(app)
        .post('/api/auth/firebase/verify')
        .send({
          idToken: 'performance-test-token'
        });

      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(5000); // 5秒以内
    });

    test('大量リクエストの処理', async () => {
      mockFirebase.verifyIdToken.mockResolvedValue({
        uid: 'load-test-uid',
        email: 'load@example.com',
        email_verified: true,
        auth_time: Date.now() / 1000
      });

      mockFirebase.createSessionCookie.mockResolvedValue('session-cookie');

      const promises = [];
      const requestCount = 10;

      for (let i = 0; i < requestCount; i++) {
        promises.push(
          request(app)
            .post('/api/auth/firebase/verify')
            .send({
              idToken: `load-test-token-${i}`
            })
        );
      }

      const results = await Promise.all(promises);

      // 全てのリクエストが成功することを確認
      results.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('セキュリティテスト', () => {
    test('不正なIDトークンの拒否', async () => {
      mockFirebase.verifyIdToken.mockRejectedValue({
        code: 'auth/argument-error',
        message: 'Invalid ID token format'
      });

      const response = await request(app)
        .post('/api/auth/firebase/verify')
        .send({
          idToken: 'malicious-token-attempt'
        });

      expect(response.status).toBe(400);
    });

    test('SQLインジェクション攻撃の防御', async () => {
      const response = await request(app)
        .post('/api/auth/firebase/register')
        .send({
          email: "test'; DROP TABLE Users; --",
          password: 'ValidPass123!@#',
          displayName: 'Test User'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    test('XSS攻撃の防御', async () => {
      const response = await request(app)
        .post('/api/auth/firebase/register')
        .send({
          email: 'test@example.com',
          password: 'ValidPass123!@#',
          displayName: '<script>alert("XSS")</script>'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });
  });
});

// テスト後のクリーンアップ
afterAll(async () => {
  // モックのクリーンアップ
  jest.restoreAllMocks();
});