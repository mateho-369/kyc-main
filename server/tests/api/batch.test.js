const request = require('supertest');
const app = require('../../server');
const { User, BatchJob, Performer } = require('../../models');
const path = require('path');
const fs = require('fs').promises;

describe('Batch API Tests', () => {
  let adminUser;
  let adminToken;
  let regularUser;
  let regularToken;

  beforeAll(async () => {
    // 管理者ユーザー作成
    adminUser = await User.create({
      email: 'admin@test.com',
      password: 'adminPass123',
      name: 'Admin User',
      role: 'admin'
    });

    // 一般ユーザー作成
    regularUser = await User.create({
      email: 'user@test.com',
      password: 'userPass123',
      name: 'Regular User',
      role: 'user'
    });

    // トークン取得
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'adminPass123' });
    adminToken = adminLogin.body.token;

    const userLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'userPass123' });
    regularToken = userLogin.body.token;
  });

  afterAll(async () => {
    // クリーンアップ
    await BatchJob.destroy({ where: { userId: [adminUser.id, regularUser.id] } });
    await Performer.destroy({ where: { notes: { [Op.like]: '%Test Batch Import%' } } });
    await User.destroy({ where: { id: [adminUser.id, regularUser.id] } });
  });

  describe('POST /api/v1/batch/performers', () => {
    it('管理者がバッチインポートを実行できる', async () => {
      const performersData = [
        {
          lastName: '田中',
          firstName: '太郎',
          lastNameRoman: 'Tanaka',
          firstNameRoman: 'Taro'
        },
        {
          lastName: '鈴木',
          firstName: '花子',
          lastNameRoman: 'Suzuki',
          firstNameRoman: 'Hanako'
        }
      ];

      const response = await request(app)
        .post('/api/v1/batch/performers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          performers: performersData,
          dryRun: true,
          skipDuplicates: true
        });

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('jobId');
      expect(response.body).toHaveProperty('totalItems', 2);
      expect(response.body).toHaveProperty('status', 'processing');
    });

    it('CSVファイルアップロードでバッチインポート', async () => {
      const csvContent = 'lastName,firstName,lastNameRoman,firstNameRoman\n山田,次郎,Yamada,Jiro\n';
      const csvPath = path.join(__dirname, 'test-batch.csv');
      await fs.writeFile(csvPath, csvContent);

      const response = await request(app)
        .post('/api/v1/batch/performers')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', csvPath)
        .field('dryRun', 'false');

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('jobId');

      // テストファイル削除
      await fs.unlink(csvPath);
    });

    it('一般ユーザーはバッチインポートできない', async () => {
      const response = await request(app)
        .post('/api/v1/batch/performers')
        .set('Authorization', `Bearer ${regularToken}`)
        .send({
          performers: [{ lastName: 'Test' }]
        });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'アクセス拒否');
    });

    it('データなしでエラー', async () => {
      const response = await request(app)
        .post('/api/v1/batch/performers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'データが提供されていません');
    });
  });

  describe('GET /api/v1/batch/jobs/:jobId', () => {
    let testJobId;

    beforeAll(async () => {
      // テスト用ジョブ作成
      const job = await BatchJob.create({
        userId: adminUser.id,
        jobType: 'performer_import',
        status: 'processing',
        totalItems: 10,
        processedItems: 5,
        successItems: 4,
        failedItems: 1,
        progress: 50
      });
      testJobId = job.id;
    });

    it('ジョブステータスを取得できる', async () => {
      const response = await request(app)
        .get(`/api/v1/batch/jobs/${testJobId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', testJobId);
      expect(response.body).toHaveProperty('status', 'processing');
      expect(response.body).toHaveProperty('progress', 50);
    });

    it('他のユーザーのジョブは取得できない（管理者以外）', async () => {
      const response = await request(app)
        .get(`/api/v1/batch/jobs/${testJobId}`)
        .set('Authorization', `Bearer ${regularToken}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'ジョブが見つかりません');
    });

    it('存在しないジョブID', async () => {
      const response = await request(app)
        .get('/api/v1/batch/jobs/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'ジョブが見つかりません');
    });
  });

  describe('DELETE /api/v1/batch/jobs/:jobId', () => {
    let cancelableJobId;

    beforeEach(async () => {
      // キャンセル可能なジョブを作成
      const job = await BatchJob.create({
        userId: adminUser.id,
        jobType: 'performer_import',
        status: 'pending',
        totalItems: 10
      });
      cancelableJobId = job.id;
    });

    it('ペンディングジョブをキャンセルできる', async () => {
      const response = await request(app)
        .delete(`/api/v1/batch/jobs/${cancelableJobId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'ジョブをキャンセルしました');

      // ジョブの状態確認
      const job = await BatchJob.findByPk(cancelableJobId);
      expect(job.status).toBe('cancelled');
    });

    it('完了済みジョブはキャンセルできない', async () => {
      // ジョブを完了状態に更新
      await BatchJob.update(
        { status: 'completed' },
        { where: { id: cancelableJobId } }
      );

      const response = await request(app)
        .delete(`/api/v1/batch/jobs/${cancelableJobId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('completedは状態のジョブはキャンセルできません');
    });
  });
});

describe('Bulk API Tests', () => {
  let adminToken;
  let testPerformers;

  beforeAll(async () => {
    // 管理者トークン取得
    const adminUser = await User.create({
      email: 'bulkadmin@test.com',
      password: 'adminPass123',
      name: 'Bulk Admin',
      role: 'admin'
    });

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bulkadmin@test.com', password: 'adminPass123' });
    adminToken = adminLogin.body.token;

    // テスト用Performer作成
    testPerformers = await Promise.all([
      Performer.create({
        lastName: 'Bulk1',
        firstName: 'Test1',
        lastNameRoman: 'Bulk1',
        firstNameRoman: 'Test1',
        status: 'pending'
      }),
      Performer.create({
        lastName: 'Bulk2',
        firstName: 'Test2',
        lastNameRoman: 'Bulk2',
        firstNameRoman: 'Test2',
        status: 'pending'
      })
    ]);
  });

  afterAll(async () => {
    // クリーンアップ
    await Performer.destroy({ 
      where: { id: testPerformers.map(p => p.id) } 
    });
  });

  describe('PUT /api/v1/bulk/update', () => {
    it('複数のPerformerのステータスを一括更新', async () => {
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

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.summary.updated).toBe(2);

      // 更新確認
      const updated = await Performer.findByPk(testPerformers[0].id);
      expect(updated.status).toBe('active');
      expect(updated.notes).toBe('一括承認テスト');
    });

    it('存在しないIDを含む場合', async () => {
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

      expect(response.status).toBe(200);
      expect(response.body.summary.found).toBe(1);
      expect(response.body.summary.notFound).toBe(1);
      expect(response.body.notFoundIds).toContain(99999);
    });

    it('許可されていないフィールドの更新', async () => {
      const response = await request(app)
        .put('/api/v1/bulk/update')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          resourceType: 'performers',
          ids: [testPerformers[0].id],
          updates: {
            id: 999,
            createdAt: new Date()
          }
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', '更新可能なフィールドが含まれていません');
    });
  });

  describe('POST /api/v1/bulk/validate', () => {
    it('一括操作の事前検証', async () => {
      const response = await request(app)
        .post('/api/v1/bulk/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          operation: 'update',
          resourceType: 'performers',
          ids: testPerformers.map(p => p.id),
          updates: {
            status: 'rejected'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('valid', true);
      expect(response.body.summary.found).toBe(testPerformers.length);
      expect(response.body).toHaveProperty('impact');
    });
  });
});