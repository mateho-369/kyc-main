const request = require('supertest');
const app = require('../../server');
const { SharegramIntegration, Performer, User, BatchJob } = require('../../models');
const { generateAdminToken, generateTestToken, randomEmail, expectValidApiResponse, delay } = global.testUtils;

// Sharegram同期サービスのモック
jest.mock('../../services/sync/dataSync', () => ({
  syncPerformers: jest.fn(),
  syncSinglePerformer: jest.fn(),
  getPerformerFromSharegram: jest.fn()
}));

// モックデータ
const mockSharegramPerformers = [
  {
    id: 'sg_001',
    username: 'performer_sync_1',
    displayName: 'Test Sync Performer 1',
    email: 'sync1@example.com',
    profileImage: 'https://example.com/profile1.jpg',
    bio: 'Test bio 1',
    verified: true,
    createdAt: '2024-01-01T00:00:00Z',
    stats: {
      followers: 1000,
      videos: 50,
      likes: 5000
    }
  },
  {
    id: 'sg_002',
    username: 'performer_sync_2',
    displayName: 'Test Sync Performer 2',
    email: 'sync2@example.com',
    profileImage: 'https://example.com/profile2.jpg',
    bio: 'Test bio 2',
    verified: false,
    createdAt: '2024-01-02T00:00:00Z',
    stats: {
      followers: 500,
      videos: 20,
      likes: 1000
    }
  }
];

describe('Performers Sync API Tests', () => {
  let adminToken;
  let userToken;
  let testIntegration;
  const dataSync = require('../../services/sync/dataSync');

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
        secretKey: 'test-secret-key'
      },
      lastSyncDate: new Date(Date.now() - 86400000), // 24時間前
      lastSyncStatus: 'success',
      totalSyncedPerformers: 0
    });

    // モックのリセットと設定
    jest.clearAllMocks();
    dataSync.syncPerformers.mockResolvedValue({
      success: true,
      syncedCount: 2,
      newPerformers: 2,
      updatedPerformers: 0,
      errors: []
    });
  });

  afterEach(async () => {
    // テストデータクリーンアップ
    await BatchJob.destroy({ where: {} });
    await Performer.destroy({ where: {} });
    await User.destroy({ where: {} });
    await SharegramIntegration.destroy({ where: {} });
  });

  describe('POST /api/v1/performers/sync', () => {
    it('should trigger performer synchronization successfully', async () => {
      const response = await request(app)
        .post('/api/v1/performers/sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullSync: true,
          syncOptions: {
            includeInactive: false,
            updateExisting: true
          }
        });

      expectValidApiResponse(response, 202);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('jobId');
      expect(response.body.data.status).toBe('queued');
      expect(response.body.data.jobType).toBe('performer_sync');

      // バッチジョブが作成されたか確認
      const batchJob = await BatchJob.findOne({
        where: { jobType: 'performer_sync' }
      });
      expect(batchJob).toBeTruthy();
      expect(batchJob.status).toBe('queued');
      expect(batchJob.parameters.fullSync).toBe(true);
    });

    it('should handle incremental sync', async () => {
      const response = await request(app)
        .post('/api/v1/performers/sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullSync: false,
          since: '2024-01-01T00:00:00Z'
        });

      expectValidApiResponse(response, 202);
      expect(response.body.data.parameters).toMatchObject({
        fullSync: false,
        since: '2024-01-01T00:00:00Z'
      });
    });

    it('should reject non-admin access', async () => {
      const response = await request(app)
        .post('/api/v1/performers/sync')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ fullSync: true });

      expectValidApiResponse(response, 403);
      expect(response.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should prevent duplicate sync jobs', async () => {
      // 既存の実行中ジョブを作成
      await BatchJob.create({
        jobType: 'performer_sync',
        status: 'processing',
        parameters: { fullSync: true },
        startedAt: new Date()
      });

      const response = await request(app)
        .post('/api/v1/performers/sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullSync: true });

      expectValidApiResponse(response, 409);
      expect(response.body.error.code).toBe('SYNC_ALREADY_IN_PROGRESS');
    });
  });

  describe('GET /api/v1/performers/sync/status', () => {
    it('should get sync job status', async () => {
      // バッチジョブ作成
      const batchJob = await BatchJob.create({
        jobType: 'performer_sync',
        status: 'processing',
        parameters: { fullSync: true },
        progress: 50,
        totalItems: 100,
        processedItems: 50,
        startedAt: new Date()
      });

      const response = await request(app)
        .get(`/api/v1/performers/sync/status?jobId=${batchJob.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data).toMatchObject({
        jobId: batchJob.id,
        status: 'processing',
        progress: 50,
        totalItems: 100,
        processedItems: 50
      });
    });

    it('should get latest sync status without jobId', async () => {
      // 複数のジョブを作成
      await BatchJob.create({
        jobType: 'performer_sync',
        status: 'completed',
        parameters: { fullSync: false },
        completedAt: new Date(Date.now() - 3600000)
      });

      const latestJob = await BatchJob.create({
        jobType: 'performer_sync',
        status: 'processing',
        parameters: { fullSync: true },
        progress: 75,
        startedAt: new Date()
      });

      const response = await request(app)
        .get('/api/v1/performers/sync/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data.jobId).toBe(latestJob.id);
      expect(response.body.data.progress).toBe(75);
    });

    it('should return 404 when no sync jobs exist', async () => {
      const response = await request(app)
        .get('/api/v1/performers/sync/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 404);
      expect(response.body.error.code).toBe('NO_SYNC_JOBS_FOUND');
    });
  });

  describe('POST /api/v1/performers/:performerId/sync', () => {
    let testPerformer;

    beforeEach(async () => {
      const user = await User.create({
        email: randomEmail(),
        password: 'Test123!',
        role: 'performer'
      });

      testPerformer = await Performer.create({
        userId: user.id,
        username: 'test_performer',
        displayName: 'Test Performer',
        sharegramId: 'sg_001',
        lastSyncedAt: new Date(Date.now() - 7200000) // 2時間前
      });

      dataSync.syncSinglePerformer.mockResolvedValue({
        success: true,
        performer: {
          ...mockSharegramPerformers[0],
          stats: { ...mockSharegramPerformers[0].stats, followers: 1500 }
        },
        updated: true
      });
    });

    it('should sync individual performer', async () => {
      const response = await request(app)
        .post(`/api/v1/performers/${testPerformer.id}/sync`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          force: true
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data).toHaveProperty('updated', true);
      expect(response.body.data).toHaveProperty('performer');
      expect(response.body.data.performer.sharegramId).toBe('sg_001');
      
      // 同期サービスが呼び出されたか確認
      expect(dataSync.syncSinglePerformer).toHaveBeenCalledWith(
        testPerformer.id,
        expect.objectContaining({ force: true })
      );
    });

    it('should respect rate limiting', async () => {
      // 最近同期を更新
      await testPerformer.update({
        lastSyncedAt: new Date()
      });

      const response = await request(app)
        .post(`/api/v1/performers/${testPerformer.id}/sync`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          force: false
        });

      expectValidApiResponse(response, 429);
      expect(response.body.error.code).toBe('SYNC_RATE_LIMITED');
    });

    it('should allow forced sync bypass rate limit', async () => {
      // 最近同期を更新
      await testPerformer.update({
        lastSyncedAt: new Date()
      });

      const response = await request(app)
        .post(`/api/v1/performers/${testPerformer.id}/sync`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          force: true
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data.updated).toBe(true);
    });

    it('should handle performer not found', async () => {
      const response = await request(app)
        .post('/api/v1/performers/99999/sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ force: true });

      expectValidApiResponse(response, 404);
      expect(response.body.error.code).toBe('PERFORMER_NOT_FOUND');
    });

    it('should handle sync errors gracefully', async () => {
      dataSync.syncSinglePerformer.mockRejectedValue(
        new Error('Sharegram API unavailable')
      );

      const response = await request(app)
        .post(`/api/v1/performers/${testPerformer.id}/sync`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ force: true });

      expectValidApiResponse(response, 500);
      expect(response.body.error.message).toContain('sync failed');
    });
  });

  describe('GET /api/v1/performers/sync/history', () => {
    beforeEach(async () => {
      // 同期履歴作成
      const statuses = ['completed', 'completed', 'failed', 'processing'];
      for (let i = 0; i < statuses.length; i++) {
        await BatchJob.create({
          jobType: 'performer_sync',
          status: statuses[i],
          parameters: { fullSync: i % 2 === 0 },
          progress: statuses[i] === 'completed' ? 100 : 50,
          totalItems: 100,
          processedItems: statuses[i] === 'completed' ? 100 : 50,
          startedAt: new Date(Date.now() - (i + 1) * 3600000),
          completedAt: statuses[i] === 'completed' ? new Date(Date.now() - i * 3600000) : null,
          error: statuses[i] === 'failed' ? 'API connection failed' : null
        });
      }
    });

    it('should return sync history with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/performers/sync/history?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toMatchObject({
        currentPage: 1,
        itemsPerPage: 2,
        totalItems: 4,
        totalPages: 2
      });
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/v1/performers/sync/history?status=completed')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every(job => job.status === 'completed')).toBe(true);
    });

    it('should sort by date descending', async () => {
      const response = await request(app)
        .get('/api/v1/performers/sync/history')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      const dates = response.body.data.map(job => new Date(job.startedAt).getTime());
      expect(dates).toEqual([...dates].sort((a, b) => b - a));
    });
  });

  describe('POST /api/v1/performers/sync/cancel', () => {
    it('should cancel running sync job', async () => {
      const batchJob = await BatchJob.create({
        jobType: 'performer_sync',
        status: 'processing',
        parameters: { fullSync: true },
        startedAt: new Date()
      });

      const response = await request(app)
        .post('/api/v1/performers/sync/cancel')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          jobId: batchJob.id,
          reason: 'Manual cancellation by admin'
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data.status).toBe('cancelled');
      
      // データベース更新確認
      await batchJob.reload();
      expect(batchJob.status).toBe('cancelled');
      expect(batchJob.error).toContain('Manual cancellation');
    });

    it('should not cancel completed jobs', async () => {
      const batchJob = await BatchJob.create({
        jobType: 'performer_sync',
        status: 'completed',
        parameters: { fullSync: true },
        completedAt: new Date()
      });

      const response = await request(app)
        .post('/api/v1/performers/sync/cancel')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ jobId: batchJob.id });

      expectValidApiResponse(response, 400);
      expect(response.body.error.code).toBe('JOB_NOT_CANCELLABLE');
    });
  });
});