const request = require('supertest');
const app = require('../../server');
const { Performer, User, KYCRequest, AuditLog } = require('../../models');
const { generateAdminToken, generateTestToken, randomEmail, expectValidApiResponse } = global.testUtils;

// メール送信サービスのモック
jest.mock('../../services/email/emailService', () => ({
  sendApprovalEmail: jest.fn().mockResolvedValue(true),
  sendRejectionEmail: jest.fn().mockResolvedValue(true),
  sendStatusChangeEmail: jest.fn().mockResolvedValue(true)
}));

describe('Performers Approval API Tests', () => {
  let adminToken;
  let moderatorToken;
  let userToken;
  let testPerformers = [];
  const emailService = require('../../services/email/emailService');

  beforeEach(async () => {
    // 認証トークン生成
    adminToken = generateAdminToken();
    moderatorToken = generateTestToken({ role: 'moderator' });
    userToken = generateTestToken({ role: 'user' });

    // テストパフォーマー作成
    const performerData = [
      { status: 'pending', kycStatus: 'verified', displayName: 'Pending Performer 1' },
      { status: 'pending', kycStatus: 'verified', displayName: 'Pending Performer 2' },
      { status: 'under_review', kycStatus: 'verified', displayName: 'Under Review Performer' },
      { status: 'active', kycStatus: 'verified', displayName: 'Active Performer' },
      { status: 'suspended', kycStatus: 'verified', displayName: 'Suspended Performer' },
      { status: 'pending', kycStatus: 'not_started', displayName: 'No KYC Performer' }
    ];

    testPerformers = [];
    for (const data of performerData) {
      const user = await User.create({
        email: randomEmail(),
        password: 'Test123!',
        role: 'performer'
      });

      const performer = await Performer.create({
        userId: user.id,
        username: `performer_${Date.now()}_${Math.random()}`,
        displayName: data.displayName,
        profileImage: 'https://example.com/profile.jpg',
        bio: 'Test bio',
        status: data.status,
        kycStatus: data.kycStatus,
        isVerified: data.kycStatus === 'verified',
        reviewNotes: data.status === 'under_review' ? 'Needs additional review' : null
      });

      if (data.kycStatus === 'verified') {
        await KYCRequest.create({
          performerId: performer.id,
          status: 'verified',
          submittedData: {
            firstName: 'Test',
            lastName: 'User',
            birthDate: '1990-01-01'
          },
          verificationId: `ver_${performer.id}`,
          verificationResult: {
            overallStatus: 'passed',
            riskScore: 95
          }
        });
      }

      testPerformers.push(performer);
    }

    // モックリセット
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // テストデータクリーンアップ
    await AuditLog.destroy({ where: {} });
    await KYCRequest.destroy({ where: {} });
    await Performer.destroy({ where: {} });
    await User.destroy({ where: {} });
  });

  describe('GET /api/v1/performers/pending-approval', () => {
    it('should list performers pending approval', async () => {
      const response = await request(app)
        .get('/api/v1/performers/pending-approval')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
      
      // pendingステータスのパフォーマーのみ返される
      const pendingPerformers = response.body.data.filter(p => p.status === 'pending');
      expect(pendingPerformers.length).toBe(2); // KYC検証済みのpendingのみ
    });

    it('should include review queue performers', async () => {
      const response = await request(app)
        .get('/api/v1/performers/pending-approval?includeReview=true')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      const statuses = response.body.data.map(p => p.status);
      expect(statuses).toContain('pending');
      expect(statuses).toContain('under_review');
    });

    it('should support pagination and filtering', async () => {
      const response = await request(app)
        .get('/api/v1/performers/pending-approval?page=1&limit=1&status=pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination).toMatchObject({
        currentPage: 1,
        itemsPerPage: 1,
        totalItems: 2
      });
    });

    it('should allow moderator access', async () => {
      const response = await request(app)
        .get('/api/v1/performers/pending-approval')
        .set('Authorization', `Bearer ${moderatorToken}`);

      expectValidApiResponse(response, 200);
    });

    it('should reject regular user access', async () => {
      const response = await request(app)
        .get('/api/v1/performers/pending-approval')
        .set('Authorization', `Bearer ${userToken}`);

      expectValidApiResponse(response, 403);
    });
  });

  describe('POST /api/v1/performers/:performerId/approve', () => {
    it('should approve pending performer', async () => {
      const pendingPerformer = testPerformers.find(p => p.status === 'pending' && p.kycStatus === 'verified');
      
      const response = await request(app)
        .post(`/api/v1/performers/${pendingPerformer.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'All verification checks passed',
          sendNotification: true
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data).toMatchObject({
        id: pendingPerformer.id,
        status: 'active',
        approvedAt: expect.any(String),
        approvedBy: expect.any(Number)
      });

      // データベース確認
      await pendingPerformer.reload();
      expect(pendingPerformer.status).toBe('active');
      expect(pendingPerformer.approvedAt).toBeTruthy();

      // メール送信確認
      expect(emailService.sendApprovalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          performerId: pendingPerformer.id
        })
      );

      // 監査ログ確認
      const auditLog = await AuditLog.findOne({
        where: {
          action: 'performer_approved',
          resourceId: pendingPerformer.id
        }
      });
      expect(auditLog).toBeTruthy();
    });

    it('should require KYC verification for approval', async () => {
      const noKycPerformer = testPerformers.find(p => p.kycStatus === 'not_started');
      
      const response = await request(app)
        .post(`/api/v1/performers/${noKycPerformer.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Trying to approve without KYC'
        });

      expectValidApiResponse(response, 400);
      expect(response.body.error.code).toBe('KYC_NOT_VERIFIED');
    });

    it('should not approve already active performer', async () => {
      const activePerformer = testPerformers.find(p => p.status === 'active');
      
      const response = await request(app)
        .post(`/api/v1/performers/${activePerformer.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Already active'
        });

      expectValidApiResponse(response, 400);
      expect(response.body.error.code).toBe('INVALID_PERFORMER_STATUS');
    });

    it('should handle bulk approval', async () => {
      const pendingIds = testPerformers
        .filter(p => p.status === 'pending' && p.kycStatus === 'verified')
        .map(p => p.id);

      const response = await request(app)
        .post('/api/v1/performers/bulk-approve')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          performerIds: pendingIds,
          notes: 'Bulk approval for verified performers'
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data.approved).toBe(pendingIds.length);
      expect(response.body.data.failed).toBe(0);
    });
  });

  describe('POST /api/v1/performers/:performerId/reject', () => {
    it('should reject pending performer', async () => {
      const pendingPerformer = testPerformers.find(p => p.status === 'pending');
      
      const response = await request(app)
        .post(`/api/v1/performers/${pendingPerformer.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'inappropriate_content',
          notes: 'Profile content violates community guidelines',
          sendNotification: true
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data).toMatchObject({
        id: pendingPerformer.id,
        status: 'rejected',
        rejectionReason: 'inappropriate_content'
      });

      // データベース確認
      await pendingPerformer.reload();
      expect(pendingPerformer.status).toBe('rejected');
      expect(pendingPerformer.rejectionReason).toBe('inappropriate_content');

      // メール送信確認
      expect(emailService.sendRejectionEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          performerId: pendingPerformer.id,
          reason: 'inappropriate_content'
        })
      );
    });

    it('should require rejection reason', async () => {
      const pendingPerformer = testPerformers.find(p => p.status === 'pending');
      
      const response = await request(app)
        .post(`/api/v1/performers/${pendingPerformer.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Missing reason'
        });

      expect(response).toHaveValidationError('reason');
    });

    it('should validate rejection reason values', async () => {
      const pendingPerformer = testPerformers.find(p => p.status === 'pending');
      
      const response = await request(app)
        .post(`/api/v1/performers/${pendingPerformer.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'invalid_reason',
          notes: 'Invalid rejection reason'
        });

      expect(response).toHaveValidationError('reason');
    });
  });

  describe('PUT /api/v1/performers/:performerId/status', () => {
    it('should update performer status', async () => {
      const activePerformer = testPerformers.find(p => p.status === 'active');
      
      const response = await request(app)
        .put(`/api/v1/performers/${activePerformer.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'suspended',
          reason: 'terms_violation',
          notes: 'Multiple violations of terms of service',
          duration: 7 // 7 days suspension
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data).toMatchObject({
        id: activePerformer.id,
        status: 'suspended',
        suspensionReason: 'terms_violation',
        suspensionEndsAt: expect.any(String)
      });

      // 一時停止終了日の確認
      const suspensionEnd = new Date(response.body.data.suspensionEndsAt);
      const expectedEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      expect(Math.abs(suspensionEnd - expectedEnd)).toBeLessThan(60000); // 1分以内の誤差
    });

    it('should reactivate suspended performer', async () => {
      const suspendedPerformer = testPerformers.find(p => p.status === 'suspended');
      
      const response = await request(app)
        .put(`/api/v1/performers/${suspendedPerformer.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'active',
          notes: 'Suspension period completed, reactivating account'
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data.status).toBe('active');
      expect(response.body.data.suspensionReason).toBeNull();
      expect(response.body.data.suspensionEndsAt).toBeNull();
    });

    it('should put performer under review', async () => {
      const activePerformer = testPerformers.find(p => p.status === 'active');
      
      const response = await request(app)
        .put(`/api/v1/performers/${activePerformer.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'under_review',
          notes: 'Content flagged for manual review'
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data.status).toBe('under_review');
      expect(response.body.data.reviewNotes).toBe('Content flagged for manual review');
    });

    it('should prevent invalid status transitions', async () => {
      const rejectedPerformer = testPerformers.find(p => p.status === 'rejected');
      
      const response = await request(app)
        .put(`/api/v1/performers/${rejectedPerformer.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'active',
          notes: 'Invalid transition from rejected to active'
        });

      expectValidApiResponse(response, 400);
      expect(response.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('GET /api/v1/performers/approval-stats', () => {
    it('should return approval statistics', async () => {
      const response = await request(app)
        .get('/api/v1/performers/approval-stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data).toMatchObject({
        total: expect.any(Number),
        byStatus: {
          pending: 3, // Including no-KYC
          under_review: 1,
          active: 1,
          suspended: 1,
          rejected: 0
        },
        pendingKycVerification: 1,
        awaitingApproval: 2,
        recentActivity: {
          last24Hours: expect.any(Object),
          last7Days: expect.any(Object),
          last30Days: expect.any(Object)
        }
      });
    });

    it('should include time-based metrics', async () => {
      const response = await request(app)
        .get('/api/v1/performers/approval-stats?includeMetrics=true')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data.metrics).toMatchObject({
        averageApprovalTime: expect.any(Number),
        averageReviewTime: expect.any(Number),
        approvalRate: expect.any(Number)
      });
    });
  });

  describe('POST /api/v1/performers/:performerId/request-review', () => {
    it('should allow performer to request review after rejection', async () => {
      // 拒否されたパフォーマーを作成
      const user = await User.create({
        email: randomEmail(),
        password: 'Test123!',
        role: 'performer'
      });

      const rejectedPerformer = await Performer.create({
        userId: user.id,
        username: 'rejected_performer',
        displayName: 'Rejected Performer',
        status: 'rejected',
        rejectionReason: 'incomplete_profile',
        rejectedAt: new Date(Date.now() - 86400000) // 24時間前
      });

      const performerToken = generateTestToken({ 
        id: user.id, 
        role: 'performer' 
      });

      const response = await request(app)
        .post(`/api/v1/performers/${rejectedPerformer.id}/request-review`)
        .set('Authorization', `Bearer ${performerToken}`)
        .send({
          message: 'I have updated my profile with all required information',
          updatedFields: ['bio', 'profileImage']
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data.status).toBe('pending');
      expect(response.body.data.reviewRequestedAt).toBeTruthy();
    });

    it('should enforce cooldown period for review requests', async () => {
      const user = await User.create({
        email: randomEmail(),
        password: 'Test123!',
        role: 'performer'
      });

      const recentlyRejected = await Performer.create({
        userId: user.id,
        username: 'recent_rejected',
        displayName: 'Recently Rejected',
        status: 'rejected',
        rejectionReason: 'inappropriate_content',
        rejectedAt: new Date() // 今拒否された
      });

      const performerToken = generateTestToken({ 
        id: user.id, 
        role: 'performer' 
      });

      const response = await request(app)
        .post(`/api/v1/performers/${recentlyRejected.id}/request-review`)
        .set('Authorization', `Bearer ${performerToken}`)
        .send({
          message: 'Please review again'
        });

      expectValidApiResponse(response, 429);
      expect(response.body.error.code).toBe('REVIEW_COOLDOWN_ACTIVE');
    });
  });
});