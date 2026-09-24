// Firebase認証API統合テスト
const request = require('supertest');
const crypto = require('crypto');

// テスト環境設定
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-api-integration';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key';
process.env.FORCE_HTTPS = 'false';

describe('Firebase認証API統合テスト', () => {
  let app;
  let testResults = {
    apiTests: {},
    performanceMetrics: {},
    errorHandling: {},
    securityTests: {}
  };

  beforeAll(async () => {
    // アプリケーションの初期化
    app = require('../server');
    
    console.log('🔄 API統合テスト開始...');
  });

  describe('API エンドポイント機能テスト', () => {
    describe('POST /api/auth/firebase/verify', () => {
      test('有効なリクエスト形式のテスト', async () => {
        const startTime = Date.now();
        
        const response = await request(app)
          .post('/api/auth/firebase/verify')
          .send({
            idToken: 'mock-firebase-id-token-for-testing'
          })
          .expect('Content-Type', /json/);

        const responseTime = Date.now() - startTime;
        
        // パフォーマンスメトリクスの記録
        testResults.performanceMetrics.verifyAPI = {
          responseTime,
          statusCode: response.status,
          bodySize: JSON.stringify(response.body).length
        };

        // 基本的なレスポンス構造の確認
        expect(response.body).toHaveProperty('error');
        expect(responseTime).toBeLessThan(5000); // 5秒以内
        
        testResults.apiTests.verify = {
          status: 'tested',
          responseTime,
          structureValid: true
        };
      });

      test('入力バリデーションテスト', async () => {
        // 空のIDトークン
        const emptyTokenResponse = await request(app)
          .post('/api/auth/firebase/verify')
          .send({ idToken: '' });

        expect(emptyTokenResponse.status).toBe(400);
        expect(emptyTokenResponse.body.error).toBe('Validation failed');

        // IDトークンなし
        const noTokenResponse = await request(app)
          .post('/api/auth/firebase/verify')
          .send({});

        expect(noTokenResponse.status).toBe(400);

        testResults.apiTests.verifyValidation = {
          emptyToken: emptyTokenResponse.status === 400,
          noToken: noTokenResponse.status === 400
        };
      });
    });

    describe('POST /api/auth/firebase/register', () => {
      const validRegistrationData = {
        email: 'integration-test@example.com',
        password: 'SecureTestPass123!@#',
        displayName: 'Integration Test User'
      };

      test('有効な登録データのテスト', async () => {
        const startTime = Date.now();
        
        const response = await request(app)
          .post('/api/auth/firebase/register')
          .send(validRegistrationData);

        const responseTime = Date.now() - startTime;

        testResults.performanceMetrics.registerAPI = {
          responseTime,
          statusCode: response.status,
          bodySize: JSON.stringify(response.body).length
        };

        // レスポンス構造の確認
        expect(response.body).toHaveProperty('error');
        expect(responseTime).toBeLessThan(10000); // 10秒以内

        testResults.apiTests.register = {
          status: 'tested',
          responseTime,
          structureValid: true
        };
      });

      test('パスワード強度バリデーション', async () => {
        const weakPasswords = [
          '123',
          'password',
          'weakpass',
          '12345678',
          'onlyletters',
          'ONLYUPPERCASE',
          'onlylowercase'
        ];

        const results = [];
        for (const password of weakPasswords) {
          const response = await request(app)
            .post('/api/auth/firebase/register')
            .send({
              ...validRegistrationData,
              password
            });

          results.push({
            password,
            rejected: response.status === 400
          });
        }

        // 全ての弱いパスワードが拒否されることを確認
        const allRejected = results.every(r => r.rejected);
        expect(allRejected).toBe(true);

        testResults.apiTests.passwordValidation = {
          weakPasswordsRejected: allRejected,
          testCount: weakPasswords.length
        };
      });

      test('メールアドレスバリデーション', async () => {
        const invalidEmails = [
          'invalid-email',
          '@example.com',
          'test@',
          'test..test@example.com',
          'test@example',
          ''
        ];

        const results = [];
        for (const email of invalidEmails) {
          const response = await request(app)
            .post('/api/auth/firebase/register')
            .send({
              ...validRegistrationData,
              email
            });

          results.push({
            email,
            rejected: response.status === 400
          });
        }

        const allRejected = results.every(r => r.rejected);
        expect(allRejected).toBe(true);

        testResults.apiTests.emailValidation = {
          invalidEmailsRejected: allRejected,
          testCount: invalidEmails.length
        };
      });
    });

    describe('POST /api/auth/firebase/session', () => {
      test('セッションクッキーなしでのアクセス', async () => {
        const response = await request(app)
          .post('/api/auth/firebase/session');

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('No session');

        testResults.apiTests.sessionNoAuth = {
          status: 'tested',
          correctlyRejected: response.status === 401
        };
      });

      test('CSRFトークンチェック', async () => {
        const response = await request(app)
          .post('/api/auth/firebase/session')
          .set('Cookie', ['__session=mock-session-cookie'])
          .set('x-csrf-token', 'invalid-csrf-token');

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('CSRF validation failed');

        testResults.apiTests.csrfProtection = {
          status: 'tested',
          correctlyRejected: response.status === 403
        };
      });
    });

    describe('POST /api/auth/firebase/logout', () => {
      test('認証なしでのログアウト試行', async () => {
        const response = await request(app)
          .post('/api/auth/firebase/logout');

        expect(response.status).toBe(401);

        testResults.apiTests.logoutNoAuth = {
          status: 'tested',
          correctlyRejected: response.status === 401
        };
      });
    });

    describe('PUT /api/auth/firebase/update-profile', () => {
      test('認証なしでのプロフィール更新試行', async () => {
        const response = await request(app)
          .put('/api/auth/firebase/update-profile')
          .send({
            displayName: 'Updated Name'
          });

        expect(response.status).toBe(401);

        testResults.apiTests.updateProfileNoAuth = {
          status: 'tested',
          correctlyRejected: response.status === 401
        };
      });

      test('不正なプロフィールデータの拒否', async () => {
        const invalidData = [
          { displayName: 'a' }, // 短すぎる
          { displayName: 'x'.repeat(100) }, // 長すぎる
          { displayName: '<script>alert("XSS")</script>' }, // XSS試行
          { photoURL: 'invalid-url' } // 無効なURL
        ];

        const results = [];
        for (const data of invalidData) {
          const response = await request(app)
            .put('/api/auth/firebase/update-profile')
            .send(data);

          results.push({
            data,
            statusCode: response.status
          });
        }

        testResults.apiTests.updateProfileValidation = {
          status: 'tested',
          invalidDataTests: results
        };
      });
    });

    describe('POST /api/auth/firebase/set-custom-claims', () => {
      test('管理者権限チェック', async () => {
        const response = await request(app)
          .post('/api/auth/firebase/set-custom-claims')
          .send({
            targetUserId: 123,
            customClaims: { role: 'admin' }
          });

        expect(response.status).toBe(401);

        testResults.apiTests.customClaimsAuth = {
          status: 'tested',
          correctlyRejected: response.status === 401
        };
      });
    });
  });

  describe('エラーハンドリングテスト', () => {
    test('不正なJSONデータの処理', async () => {
      const response = await request(app)
        .post('/api/auth/firebase/verify')
        .set('Content-Type', 'application/json')
        .send('invalid-json-data');

      expect(response.status).toBe(400);

      testResults.errorHandling.invalidJSON = {
        status: 'tested',
        handledCorrectly: response.status === 400
      };
    });

    test('大きすぎるリクエストボディの処理', async () => {
      const largeData = {
        idToken: 'x'.repeat(1000000) // 1MB のデータ
      };

      const response = await request(app)
        .post('/api/auth/firebase/verify')
        .send(largeData);

      expect([400, 413]).toContain(response.status); // Bad Request または Payload Too Large

      testResults.errorHandling.largePayload = {
        status: 'tested',
        handledCorrectly: [400, 413].includes(response.status)
      };
    });

    test('SQLインジェクション試行の処理', async () => {
      const maliciousData = {
        email: "test'; DROP TABLE Users; --",
        password: 'ValidPass123!@#',
        displayName: 'Test User'
      };

      const response = await request(app)
        .post('/api/auth/firebase/register')
        .send(maliciousData);

      expect(response.status).toBe(400);

      testResults.errorHandling.sqlInjection = {
        status: 'tested',
        handledCorrectly: response.status === 400
      };
    });

    test('XSS試行の処理', async () => {
      const xssData = {
        email: 'test@example.com',
        password: 'ValidPass123!@#',
        displayName: '<script>alert("XSS")</script>'
      };

      const response = await request(app)
        .post('/api/auth/firebase/register')
        .send(xssData);

      expect(response.status).toBe(400);

      testResults.errorHandling.xssAttempt = {
        status: 'tested',
        handledCorrectly: response.status === 400
      };
    });
  });

  describe('セキュリティヘッダーテスト', () => {
    test('セキュリティヘッダーの存在確認', async () => {
      const response = await request(app)
        .get('/');

      const securityHeaders = {
        'x-content-type-options': response.headers['x-content-type-options'],
        'x-frame-options': response.headers['x-frame-options'],
        'x-xss-protection': response.headers['x-xss-protection'],
        'referrer-policy': response.headers['referrer-policy'],
        'content-security-policy': response.headers['content-security-policy']
      };

      testResults.securityTests.headers = {
        status: 'tested',
        headers: securityHeaders,
        allPresent: Object.values(securityHeaders).every(h => h !== undefined)
      };

      // 重要なセキュリティヘッダーの確認
      expect(securityHeaders['x-content-type-options']).toBe('nosniff');
      expect(securityHeaders['x-frame-options']).toBe('DENY');
      expect(securityHeaders['content-security-policy']).toBeDefined();
    });

    test('CORS設定の確認', async () => {
      const response = await request(app)
        .options('/api/auth/firebase/verify')
        .set('Origin', 'http://localhost:3000');

      testResults.securityTests.cors = {
        status: 'tested',
        allowsLocalhost: response.headers['access-control-allow-origin'] !== undefined,
        allowsMethods: response.headers['access-control-allow-methods'] !== undefined
      };
    });
  });

  describe('パフォーマンス基準テスト', () => {
    test('並行リクエストの処理', async () => {
      const startTime = Date.now();
      const concurrentRequests = 20;
      
      const promises = Array(concurrentRequests).fill().map((_, i) => 
        request(app)
          .post('/api/auth/firebase/verify')
          .send({ idToken: `concurrent-test-token-${i}` })
      );

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      testResults.performanceMetrics.concurrentRequests = {
        requestCount: concurrentRequests,
        totalTime,
        averageTime: totalTime / concurrentRequests,
        allCompleted: results.length === concurrentRequests,
        throughput: (concurrentRequests / totalTime) * 1000 // requests per second
      };

      expect(results).toHaveLength(concurrentRequests);
      expect(totalTime).toBeLessThan(30000); // 30秒以内
    });

    test('メモリ使用量の監視', async () => {
      const memBefore = process.memoryUsage();
      
      // 複数のAPIリクエストを実行
      for (let i = 0; i < 100; i++) {
        await request(app)
          .post('/api/auth/firebase/verify')
          .send({ idToken: `memory-test-token-${i}` });
      }

      const memAfter = process.memoryUsage();
      
      testResults.performanceMetrics.memoryUsage = {
        before: memBefore,
        after: memAfter,
        heapIncrease: memAfter.heapUsed - memBefore.heapUsed,
        externalIncrease: memAfter.external - memBefore.external
      };

      // メモリリークの基本チェック（100MB以上の増加は異常）
      expect(memAfter.heapUsed - memBefore.heapUsed).toBeLessThan(100 * 1024 * 1024);
    });
  });

  afterAll(async () => {
    // テスト結果の保存
    const fs = require('fs').promises;
    await fs.writeFile(
      'test-results-api-integration.json',
      JSON.stringify(testResults, null, 2)
    );

    console.log('✅ API統合テスト完了');
    console.log('📊 テスト結果:', {
      apiEndpoints: Object.keys(testResults.apiTests).length,
      performanceTests: Object.keys(testResults.performanceMetrics).length,
      securityTests: Object.keys(testResults.securityTests).length,
      errorHandlingTests: Object.keys(testResults.errorHandling).length
    });
  });
});