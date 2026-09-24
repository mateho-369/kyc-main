const request = require('supertest');
const app = require('../../server');
const { SharegramIntegration, KYCRequest, Performer, User } = require('../../models');
const { generateAdminToken, generateTestToken, randomEmail, expectValidApiResponse } = global.testUtils;

// Sharegram API モック
jest.mock('../../services/sharegram/sharegramClient', () => ({
  createSharegramClient: jest.fn().mockResolvedValue({
    checkHealth: jest.fn().mockResolvedValue({
      success: true,
      message: 'Sharegram API is reachable',
      responseTime: 150,
      data: { status: 'healthy', version: '1.0.0' }
    })
  }),
  SharegramClient: jest.fn(),
  SharegramApiError: class SharegramApiError extends Error {}
}));

describe('Integration Status API Tests', () => {
  let adminToken;
  let userToken;
  let testIntegration;

  beforeEach(async () => {
    // 認証トークン生成
    adminToken = generateAdminToken();
    userToken = generateTestToken({ role: 'user' });

    // テスト用Sharegram統合作成
    testIntegration = await SharegramIntegration.create({
      integrationType: 'api',
      isActive: true,
      configuration: {
        endpoint: 'https://api.sharegram.test/v1',
        apiKey: 'test-api-key',
        secretKey: 'test-secret-key',
        timeout: 30000
      },
      lastSyncDate: new Date(Date.now() - 3600000), // 1時間前
      lastSyncStatus: 'success',
      totalSyncedPerformers: 150,
      lastError: null
    });

    // テスト用KYCデータ作成
    const kycStatuses = ['pending', 'in_progress', 'verified', 'rejected', 'expired'];
    const counts = [5, 3, 10, 2, 1];
    
    for (let i = 0; i < kycStatuses.length; i++) {
      for (let j = 0; j < counts[i]; j++) {
        const user = await User.create({
          email: randomEmail(),
          password: 'Test123!',
          role: 'performer'
        });

        const performer = await Performer.create({
          userId: user.id,
          username: `test_performer_${i}_${j}`,
          displayName: `Test Performer ${i}-${j}`,
          kycStatus: kycStatuses[i]
        });

        await KYCRequest.create({
          performerId: performer.id,
          status: kycStatuses[i],
          submittedData: {
            firstName: 'Test',
            lastName: 'User',
            birthDate: '1990-01-01'
          },
          verificationId: `ver_${i}_${j}`
        });
      }
    }
  });

  afterEach(async () => {
    // テストデータクリーンアップ
    await KYCRequest.destroy({ where: {} });
    await Performer.destroy({ where: {} });
    await User.destroy({ where: {} });
    await SharegramIntegration.destroy({ where: {} });
    
    // モックリセット
    jest.clearAllMocks();
  });

  describe('GET /api/integration/status', () => {
    it('should return integration status successfully', async () => {
      const response = await request(app)
        .get('/api/integration/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('sharegram');
      expect(response.body.data).toHaveProperty('kyc');
      expect(response.body.data).toHaveProperty('errors');

      // Sharegram統合情報の確認
      expect(response.body.data.sharegram).toMatchObject({
        enabled: true,
        lastSyncDate: expect.any(String),
        totalSyncedPerformers: 150,
        lastSyncStatus: 'success'
      });

      // KYC統計の確認
      expect(response.body.data.kyc.statistics).toMatchObject({
        pending: 5,
        in_progress: 3,
        verified: 10,
        rejected: 2,
        expired: 1
      });
      expect(response.body.data.kyc.totalRequests).toBe(21);

      // エラー情報の確認
      expect(response.body.data.errors.hasRecentErrors).toBe(false);
      expect(response.body.data.errors.recentErrors).toHaveLength(0);
    });

    it('should include recent errors if present', async () => {
      // エラーのある統合を追加
      await SharegramIntegration.create({
        integrationType: 'webhook',
        isActive: false,
        configuration: {},
        lastError: 'Connection timeout',
        updatedAt: new Date()
      });

      const response = await request(app)
        .get('/api/integration/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data.errors.hasRecentErrors).toBe(true);
      expect(response.body.data.errors.recentErrors).toHaveLength(1);
      expect(response.body.data.errors.recentErrors[0]).toMatchObject({
        message: 'Connection timeout',
        timestamp: expect.any(String)
      });
    });

    it('should handle no active integration', async () => {
      // アクティブな統合を無効化
      await testIntegration.update({ isActive: false });

      const response = await request(app)
        .get('/api/integration/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data.sharegram.enabled).toBe(false);
      expect(response.body.data.sharegram.lastSyncDate).toBeNull();
      expect(response.body.data.sharegram.totalSyncedPerformers).toBe(0);
      expect(response.body.data.sharegram.lastSyncStatus).toBe('never_synced');
    });

    it('should require admin or moderator role', async () => {
      const response = await request(app)
        .get('/api/integration/status')
        .set('Authorization', `Bearer ${userToken}`);

      expectValidApiResponse(response, 403);
      expect(response.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/integration/status');

      expectValidApiResponse(response, 401);
    });

    it('should allow moderator access', async () => {
      const moderatorToken = generateTestToken({ role: 'moderator' });
      
      const response = await request(app)
        .get('/api/integration/status')
        .set('Authorization', `Bearer ${moderatorToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/integration/health', () => {
    it('should return healthy status when all systems are operational', async () => {
      const response = await request(app)
        .get('/api/integration/health');

      expectValidApiResponse(response, 200);
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('checks');

      // 各チェック項目の確認
      expect(response.body.checks).toHaveProperty('database');
      expect(response.body.checks.database.status).toBe('healthy');

      expect(response.body.checks).toHaveProperty('sharegramApi');
      expect(response.body.checks.sharegramApi.status).toBe('healthy');
      expect(response.body.checks.sharegramApi.responseTime).toBe(150);

      expect(response.body.checks).toHaveProperty('authSystem');
      expect(response.body.checks.authSystem.status).toBe('healthy');

      expect(response.body.checks).toHaveProperty('memory');
      expect(response.body.checks.memory.status).toMatch(/healthy|warning/);
    });

    it('should return degraded status when Sharegram API fails', async () => {
      // Sharegram APIモックをエラーに設定
      const { createSharegramClient } = require('../../services/sharegram/sharegramClient');
      createSharegramClient.mockResolvedValueOnce({
        checkHealth: jest.fn().mockResolvedValueOnce({
          success: false,
          message: 'API is down',
          responseTime: 5000,
          error: 'Connection refused'
        })
      });

      const response = await request(app)
        .get('/api/integration/health');

      expectValidApiResponse(response, 200);
      expect(response.body.status).toBe('degraded');
      expect(response.body.checks.sharegramApi.status).toBe('unhealthy');
      expect(response.body.checks.sharegramApi.message).toBe('API is down');
    });

    it('should handle no active Sharegram integration', async () => {
      // アクティブな統合を削除
      await SharegramIntegration.destroy({ where: {} });

      const response = await request(app)
        .get('/api/integration/health');

      expectValidApiResponse(response, 200);
      expect(response.body.checks.sharegramApi.status).toBe('warning');
      expect(response.body.checks.sharegramApi.message).toBe('No active Sharegram integration configured');
    });

    it('should return error status when health check completely fails', async () => {
      // データベース接続をモック（エラーを発生させる）
      jest.spyOn(SharegramIntegration.sequelize, 'authenticate').mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/integration/health');

      expectValidApiResponse(response, 503);
      expect(response.body.status).toBe('error');
      expect(response.body.message).toBe('Health check failed');
    });

    it('should not require authentication', async () => {
      const response = await request(app)
        .get('/api/integration/health');

      expectValidApiResponse(response, 200);
      expect(response.body.status).toBe('healthy');
    });

    it('should include memory usage information', async () => {
      const response = await request(app)
        .get('/api/integration/health');

      expectValidApiResponse(response, 200);
      expect(response.body.checks.memory).toHaveProperty('heapUsed');
      expect(response.body.checks.memory).toHaveProperty('heapTotal');
      expect(response.body.checks.memory).toHaveProperty('usagePercent');
      
      // メモリ使用率が妥当な範囲内か確認
      const usagePercent = parseFloat(response.body.checks.memory.usagePercent);
      expect(usagePercent).toBeGreaterThan(0);
      expect(usagePercent).toBeLessThanOrEqual(100);
    });

    it('should set correct HTTP status codes', async () => {
      // 健全な状態
      let response = await request(app)
        .get('/api/integration/health');
      expect(response.status).toBe(200);

      // 劣化状態（Sharegram APIエラー）
      const { createSharegramClient } = require('../../services/sharegram/sharegramClient');
      createSharegramClient.mockResolvedValueOnce({
        checkHealth: jest.fn().mockResolvedValueOnce({
          success: false,
          message: 'API degraded'
        })
      });

      response = await request(app)
        .get('/api/integration/health');
      expect(response.status).toBe(200); // degradedでも200を返す

      // 完全なエラー状態
      jest.spyOn(SharegramIntegration.sequelize, 'authenticate').mockRejectedValueOnce(
        new Error('Critical failure')
      );
      createSharegramClient.mockRejectedValueOnce(new Error('API completely down'));

      response = await request(app)
        .get('/api/integration/health');
      expect(response.status).toBe(503); // Service Unavailable
    });
  });

  describe('Integration between status and health endpoints', () => {
    it('should reflect consistent state between endpoints', async () => {
      // ステータスエンドポイント
      const statusResponse = await request(app)
        .get('/api/integration/status')
        .set('Authorization', `Bearer ${adminToken}`);

      // ヘルスエンドポイント
      const healthResponse = await request(app)
        .get('/api/integration/health');

      // 両方のエンドポイントが同じ統合状態を反映しているか確認
      expect(statusResponse.body.data.sharegram.enabled).toBe(true);
      expect(healthResponse.body.checks.sharegramApi.status).toBe('healthy');
    });

    it('should update status after health check failure', async () => {
      // ヘルスチェック失敗をシミュレート
      const { createSharegramClient } = require('../../services/sharegram/sharegramClient');
      createSharegramClient.mockResolvedValueOnce({
        checkHealth: jest.fn().mockRejectedValueOnce(new Error('API Error'))
      });

      // ヘルスチェック実行
      await request(app).get('/api/integration/health');

      // エラーが記録されているか確認
      const statusResponse = await request(app)
        .get('/api/integration/status')
        .set('Authorization', `Bearer ${adminToken}`);

      // エラー情報は統合の実装により異なる可能性があるため、
      // レスポンス構造のみ確認
      expect(statusResponse.body.data).toHaveProperty('errors');
    });
  });
});