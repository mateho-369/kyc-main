const request = require('supertest');
const app = require('../../server');
const { User, Performer, BatchJob } = require('../../models');
const TestDataGenerator = require('../utils/testDataGenerator');
const path = require('path');
const fs = require('fs').promises;

describe('API v1 Integration Tests', () => {
  let testDataGenerator;
  let adminUser;
  let regularUser;
  let adminToken;
  let userToken;

  beforeAll(async () => {
    testDataGenerator = new TestDataGenerator();
    
    // テストユーザー作成
    const users = await testDataGenerator.createUsers(2, [
      { email: 'admin@test.com', role: 'admin', status: 'active' },
      { email: 'user@test.com', role: 'user', status: 'active' }
    ]);
    
    adminUser = users[0];
    regularUser = users[1];
    
    adminToken = testUtils.generateAdminToken({ id: adminUser.id });
    userToken = testUtils.generateTestToken({ id: regularUser.id });
  });

  afterAll(async () => {
    await testDataGenerator.cleanup();
  });

  describe('Batch API Integration', () => {
    describe('POST /api/v1/batch/performers', () => {
      it('管理者がJSONデータでバッチインポートを実行できる', async () => {
        const performersData = [
          testDataGenerator.generatePerformerData({ lastName: 'Test1', firstName: 'User1' }),
          testDataGenerator.generatePerformerData({ lastName: 'Test2', firstName: 'User2' })
        ];

        const response = await request(app)
          .post('/api/v1/batch/performers')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            performers: performersData,
            dryRun: true,
            skipDuplicates: true
          });

        testUtils.expectValidApiResponse(response, 202);
        expect(response.body).toHaveProperty('jobId');
        expect(response.body).toHaveProperty('totalItems', 2);
        expect(response.body).toHaveProperty('status', 'processing');

        // ジョブがデータベースに作成されているか確認
        const job = await BatchJob.findOne({ where: { id: response.body.jobId } });
        expect(job).toBeTruthy();
        expect(job.userId).toBe(adminUser.id);
        testDataGenerator.createdRecords.batchJobs.push(job.id);
      });

      it('CSVファイルでバッチインポートを実行できる', async () => {
        const csvContent = 'lastName,firstName,lastNameRoman,firstNameRoman,email\n' +
                          'yamada,taro,Yamada,Taro,yamada@test.com\n' +
                          'suzuki,hanako,Suzuki,Hanako,suzuki@test.com';
        
        const csvPath = path.join(__dirname, '../fixtures/test-performers.csv');
        await fs.writeFile(csvPath, csvContent);

        const response = await request(app)
          .post('/api/v1/batch/performers')
          .set('Authorization', `Bearer ${adminToken}`)
          .attach('file', csvPath)
          .field('dryRun', 'false')
          .field('skipDuplicates', 'true');

        testUtils.expectValidApiResponse(response, 202);
        expect(response.body).toHaveProperty('jobId');

        // テストファイル削除
        await fs.unlink(csvPath);
        
        const job = await BatchJob.findOne({ where: { id: response.body.jobId } });
        testDataGenerator.createdRecords.batchJobs.push(job.id);
      });

      it('一般ユーザーはバッチインポートできない', async () => {
        const response = await request(app)
          .post('/api/v1/batch/performers')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            performers: [testDataGenerator.generatePerformerData()]
          });

        testUtils.expectValidApiResponse(response, 403);
        expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
      });

      it('不正なCSVファイルでエラーとなる', async () => {
        const invalidCsvContent = 'invalid,csv,format\nno,header,row';
        const csvPath = path.join(__dirname, '../fixtures/invalid.csv');
        await fs.writeFile(csvPath, invalidCsvContent);

        const response = await request(app)
          .post('/api/v1/batch/performers')
          .set('Authorization', `Bearer ${adminToken}`)
          .attach('file', csvPath);

        expect(response.status).toBe(400);
        await fs.unlink(csvPath);
      });
    });

    describe('GET /api/v1/batch/jobs/:jobId', () => {
      let testJob;

      beforeEach(async () => {
        const jobs = await testDataGenerator.createBatchJobs(1, {
          userId: adminUser.id,
          status: 'processing'
        });
        testJob = jobs[0];
      });

      it('ジョブステータスを正常に取得できる', async () => {
        const response = await request(app)
          .get(`/api/v1/batch/jobs/${testJob.id}`)
          .set('Authorization', `Bearer ${adminToken}`);

        testUtils.expectValidApiResponse(response, 200);
        expect(response.body.id).toBe(testJob.id);
        expect(response.body).toHaveProperty('status');
        expect(response.body).toHaveProperty('progress');
        expect(response.body).toHaveProperty('totalItems');
      });

      it('他のユーザーのジョブは取得できない', async () => {
        const response = await request(app)
          .get(`/api/v1/batch/jobs/${testJob.id}`)
          .set('Authorization', `Bearer ${userToken}`);

        testUtils.expectValidApiResponse(response, 404);
      });

      it('存在しないジョブIDで404エラー', async () => {
        const response = await request(app)
          .get('/api/v1/batch/jobs/nonexistent-id')
          .set('Authorization', `Bearer ${adminToken}`);

        testUtils.expectValidApiResponse(response, 404);
      });
    });

    describe('DELETE /api/v1/batch/jobs/:jobId', () => {
      let pendingJob;

      beforeEach(async () => {
        const jobs = await testDataGenerator.createBatchJobs(1, {
          userId: adminUser.id,
          status: 'pending'
        });
        pendingJob = jobs[0];
      });

      it('ペンディング状態のジョブをキャンセルできる', async () => {
        const response = await request(app)
          .delete(`/api/v1/batch/jobs/${pendingJob.id}`)
          .set('Authorization', `Bearer ${adminToken}`);

        testUtils.expectValidApiResponse(response, 200);
        expect(response.body).toHaveProperty('message');

        // データベースでステータス確認
        await pendingJob.reload();
        expect(pendingJob.status).toBe('cancelled');
      });

      it('完了済みジョブはキャンセルできない', async () => {
        await pendingJob.update({ status: 'completed' });

        const response = await request(app)
          .delete(`/api/v1/batch/jobs/${pendingJob.id}`)
          .set('Authorization', `Bearer ${adminToken}`);

        testUtils.expectValidApiResponse(response, 400);
      });
    });
  });

  describe('Bulk API Integration', () => {
    let testPerformers;

    beforeEach(async () => {
      testPerformers = await testDataGenerator.createPerformers(5, {
        status: 'pending'
      });
    });

    describe('PUT /api/v1/bulk/update', () => {
      it('複数パフォーマーのステータスを一括更新できる', async () => {
        const response = await request(app)
          .put('/api/v1/bulk/update')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            resourceType: 'performers',
            ids: testPerformers.map(p => p.id),
            updates: {
              status: 'active',
              notes: '一括承認テスト'
            }
          });

        testUtils.expectValidApiResponse(response, 200);
        expect(response.body).toHaveProperty('success', true);
        expect(response.body.summary.updated).toBe(testPerformers.length);

        // データベース確認
        const updatedPerformer = await Performer.findByPk(testPerformers[0].id);
        expect(updatedPerformer.status).toBe('active');
        expect(updatedPerformer.notes).toBe('一括承認テスト');
      });

      it('存在しないIDを含む一括更新で部分成功', async () => {
        const response = await request(app)
          .put('/api/v1/bulk/update')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            resourceType: 'performers',
            ids: [testPerformers[0].id, 99999],
            updates: {
              status: 'inactive'
            }
          });

        testUtils.expectValidApiResponse(response, 200);
        expect(response.body.summary.found).toBe(1);
        expect(response.body.summary.notFound).toBe(1);
        expect(response.body.notFoundIds).toContain(99999);
      });

      it('一般ユーザーは一括更新できない', async () => {
        const response = await request(app)
          .put('/api/v1/bulk/update')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            resourceType: 'performers',
            ids: [testPerformers[0].id],
            updates: { status: 'active' }
          });

        testUtils.expectValidApiResponse(response, 403);
      });
    });

    describe('POST /api/v1/bulk/validate', () => {
      it('一括操作の事前検証が正常に動作する', async () => {
        const response = await request(app)
          .post('/api/v1/bulk/validate')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            operation: 'update',
            resourceType: 'performers',
            ids: testPerformers.map(p => p.id),
            updates: {
              status: 'approved'
            }
          });

        testUtils.expectValidApiResponse(response, 200);
        expect(response.body).toHaveProperty('valid', true);
        expect(response.body.summary.found).toBe(testPerformers.length);
        expect(response.body).toHaveProperty('impact');
      });
    });
  });

  describe('Search API Integration', () => {
    beforeEach(async () => {
      // 検索用テストデータ作成
      await testDataGenerator.createPerformers(20, [
        { lastName: 'Search', firstName: 'Test1', status: 'active' },
        { lastName: 'Search', firstName: 'Test2', status: 'pending' },
        { lastName: 'Different', firstName: 'User', status: 'active' }
      ]);
    });

    describe('POST /api/v1/search/advanced', () => {
      it('高度検索が正常に動作する', async () => {
        const response = await request(app)
          .post('/api/v1/search/advanced')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            query: 'Search',
            filters: {
              status: ['active', 'pending']
            },
            pagination: {
              page: 1,
              limit: 10
            },
            sort: {
              field: 'createdAt',
              order: 'desc'
            }
          });

        testUtils.expectValidApiResponse(response, 200);
        expect(response.body).toHaveProperty('results');
        expect(response.body).toHaveProperty('pagination');
        expect(response.body).toHaveProperty('totalCount');
        expect(response.body.results.length).toBeGreaterThan(0);
      });

      it('フィルター条件が正しく適用される', async () => {
        const response = await request(app)
          .post('/api/v1/search/advanced')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            filters: {
              status: ['active']
            }
          });

        testUtils.expectValidApiResponse(response, 200);
        response.body.results.forEach(result => {
          expect(result.status).toBe('active');
        });
      });
    });

    describe('GET /api/v1/search/suggestions', () => {
      it('検索候補を正常に取得できる', async () => {
        const response = await request(app)
          .get('/api/v1/search/suggestions')
          .query({
            q: 'Sea',
            type: 'performers',
            limit: 5
          })
          .set('Authorization', `Bearer ${adminToken}`);

        testUtils.expectValidApiResponse(response, 200);
        expect(response.body).toHaveProperty('suggestions');
        expect(Array.isArray(response.body.suggestions)).toBe(true);
      });
    });
  });

  describe('Analytics API Integration', () => {
    beforeEach(async () => {
      // 統計用テストデータ作成
      await testDataGenerator.createPerformers(30);
      await testDataGenerator.createApiLogs(50);
    });

    describe('GET /api/v1/analytics/stats', () => {
      it('システム統計を正常に取得できる', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/stats')
          .query({
            period: 'month'
          })
          .set('Authorization', `Bearer ${adminToken}`);

        testUtils.expectValidApiResponse(response, 200);
        expect(response.body).toHaveProperty('users');
        expect(response.body).toHaveProperty('performers');
        expect(response.body).toHaveProperty('apiUsage');
        expect(response.body).toHaveProperty('system');
      });

      it('一般ユーザーは統計を取得できない', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/stats')
          .set('Authorization', `Bearer ${userToken}`);

        testUtils.expectValidApiResponse(response, 403);
      });
    });

    describe('GET /api/v1/analytics/performance', () => {
      it('パフォーマンス統計を正常に取得できる', async () => {
        const response = await request(app)
          .get('/api/v1/analytics/performance')
          .set('Authorization', `Bearer ${adminToken}`);

        testUtils.expectValidApiResponse(response, 200);
        expect(response.body).toHaveProperty('responseTime');
        expect(response.body).toHaveProperty('throughput');
        expect(response.body).toHaveProperty('errors');
      });
    });
  });

  describe('Error Handling Integration', () => {
    it('統一エラーレスポンス形式が適用される', async () => {
      const response = await request(app)
        .get('/api/v1/nonexistent-endpoint')
        .set('Authorization', `Bearer ${adminToken}`);

      testUtils.expectValidApiResponse(response, 404);
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('statusCode', 404);
      expect(response.body.error).toHaveProperty('timestamp');
    });

    it('認証エラーが正しく処理される', async () => {
      const response = await request(app)
        .get('/api/v1/batch/jobs/test');

      testUtils.expectValidApiResponse(response, 401);
      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('バリデーションエラーが正しく処理される', async () => {
      const response = await request(app)
        .post('/api/v1/batch/performers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          performers: [
            { lastName: '', firstName: '' } // 必須フィールドが空
          ]
        });

      testUtils.expectValidApiResponse(response, 400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Rate Limiting Integration', () => {
    it('APIレート制限が正常に動作する', async () => {
      // デフォルトレート制限をテスト（通常は100リクエスト/15分）
      // テスト環境では制限を緩和することを想定
      const requests = [];
      
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .get('/api/v1/analytics/stats')
            .set('Authorization', `Bearer ${adminToken}`)
        );
      }

      const responses = await Promise.all(requests);
      
      // すべてのレスポンスにレート制限ヘッダーが含まれていることを確認
      responses.forEach(response => {
        expect(response.headers).toHaveProperty('x-ratelimit-limit');
        expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      });
    });
  });

  describe('Caching Integration', () => {
    it('キャッシュヘッダーが正しく設定される', async () => {
      const response = await request(app)
        .get('/api/v1/analytics/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      testUtils.expectValidApiResponse(response, 200);
      
      // 初回リクエスト - キャッシュミス
      expect(response.headers['x-cache']).toBe('MISS');

      // 2回目リクエスト - キャッシュヒット
      const cachedResponse = await request(app)
        .get('/api/v1/analytics/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(cachedResponse.headers['x-cache']).toBe('HIT');
    });
  });
});