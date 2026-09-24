const request = require('supertest');
const app = require('../../server');
const { KYCRequest, KYCDocument, KYCVerificationStep, Performer, User } = require('../../models');
const { generateTestToken, generateAdminToken, randomEmail, expectValidApiResponse } = global.testUtils;

// モックデータ
const mockKYCRequestData = {
  firstName: 'John',
  lastName: 'Doe',
  birthDate: '1990-01-01',
  nationality: 'US',
  address: {
    street: '123 Test Street',
    city: 'Test City',
    state: 'CA',
    postalCode: '12345',
    country: 'US'
  },
  documentType: 'passport',
  documentNumber: 'A1234567',
  documentExpiryDate: '2030-01-01'
};

const mockSharegramResponse = {
  success: true,
  data: {
    verificationId: 'ver_123456789',
    status: 'in_progress',
    riskScore: 85,
    checks: {
      documentAuthenticity: { status: 'pending', confidence: 0 },
      faceMatch: { status: 'pending', confidence: 0 },
      addressVerification: { status: 'pending', confidence: 0 }
    }
  }
};

describe('KYC API Tests', () => {
  let authToken;
  let adminToken;
  let testPerformer;
  let testUser;

  beforeEach(async () => {
    // テストユーザー作成
    testUser = await User.create({
      email: randomEmail(),
      password: 'Test123!@#',
      role: 'performer',
      isActive: true
    });

    // テストパフォーマー作成
    testPerformer = await Performer.create({
      userId: testUser.id,
      username: `performer_${Date.now()}`,
      displayName: 'Test Performer',
      profileImage: 'https://example.com/profile.jpg',
      bio: 'Test bio',
      isVerified: false,
      kycStatus: 'not_started',
      kycDetails: {}
    });

    // 認証トークン生成
    authToken = generateTestToken({ 
      id: testUser.id, 
      email: testUser.email, 
      role: 'performer' 
    });
    adminToken = generateAdminToken();
  });

  afterEach(async () => {
    // テストデータクリーンアップ
    await KYCVerificationStep.destroy({ where: {} });
    await KYCDocument.destroy({ where: {} });
    await KYCRequest.destroy({ where: {} });
    await Performer.destroy({ where: {} });
    await User.destroy({ where: {} });
  });

  describe('POST /api/v1/kyc/submit', () => {
    it('should create a new KYC request successfully', async () => {
      const response = await request(app)
        .post('/api/v1/kyc/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send(mockKYCRequestData);

      expectValidApiResponse(response, 201);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('requestId');
      expect(response.body.data.status).toBe('pending');
      expect(response.body.data.performerId).toBe(testPerformer.id);

      // データベース確認
      const kycRequest = await KYCRequest.findOne({
        where: { performerId: testPerformer.id }
      });
      expect(kycRequest).toBeTruthy();
      expect(kycRequest.status).toBe('pending');
    });

    it('should reject duplicate KYC request for same performer', async () => {
      // 最初のリクエスト作成
      await KYCRequest.create({
        performerId: testPerformer.id,
        status: 'pending',
        submittedData: mockKYCRequestData,
        verificationId: 'existing_verification'
      });

      const response = await request(app)
        .post('/api/v1/kyc/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send(mockKYCRequestData);

      expectValidApiResponse(response, 400);
      expect(response.body.error.code).toBe('KYC_ALREADY_IN_PROGRESS');
    });

    it('should validate required fields', async () => {
      const invalidData = { ...mockKYCRequestData };
      delete invalidData.firstName;

      const response = await request(app)
        .post('/api/v1/kyc/submit')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData);

      expect(response).toHaveValidationError('firstName');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/v1/kyc/submit')
        .send(mockKYCRequestData);

      expectValidApiResponse(response, 401);
    });
  });

  describe('POST /api/v1/kyc/:requestId/documents', () => {
    let kycRequest;

    beforeEach(async () => {
      kycRequest = await KYCRequest.create({
        performerId: testPerformer.id,
        status: 'pending',
        submittedData: mockKYCRequestData,
        verificationId: 'ver_test123'
      });
    });

    it('should upload KYC documents successfully', async () => {
      const mockFile = Buffer.from('fake-image-data');
      
      const response = await request(app)
        .post(`/api/v1/kyc/${kycRequest.id}/documents`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('idFront', mockFile, 'id-front.jpg')
        .field('documentType', 'identity_document')
        .field('side', 'front');

      expectValidApiResponse(response, 201);
      expect(response.body.data).toHaveProperty('documentId');
      expect(response.body.data.documentType).toBe('identity_document');
      expect(response.body.data.status).toBe('uploaded');

      // データベース確認
      const document = await KYCDocument.findOne({
        where: { kycRequestId: kycRequest.id }
      });
      expect(document).toBeTruthy();
      expect(document.documentType).toBe('identity_document');
    });

    it('should validate file upload requirements', async () => {
      const response = await request(app)
        .post(`/api/v1/kyc/${kycRequest.id}/documents`)
        .set('Authorization', `Bearer ${authToken}`)
        .field('documentType', 'identity_document');

      expectValidApiResponse(response, 400);
      expect(response.body.error.code).toBe('FILE_REQUIRED');
    });

    it('should check KYC request ownership', async () => {
      // 別のパフォーマーのKYCリクエスト作成
      const otherPerformer = await Performer.create({
        userId: 999,
        username: 'other_performer',
        displayName: 'Other Performer',
        kycStatus: 'not_started'
      });

      const otherKycRequest = await KYCRequest.create({
        performerId: otherPerformer.id,
        status: 'pending',
        submittedData: mockKYCRequestData
      });

      const mockFile = Buffer.from('fake-image-data');
      
      const response = await request(app)
        .post(`/api/v1/kyc/${otherKycRequest.id}/documents`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('idFront', mockFile, 'id-front.jpg')
        .field('documentType', 'identity_document');

      expectValidApiResponse(response, 403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/v1/kyc/:requestId/status', () => {
    let kycRequest;

    beforeEach(async () => {
      kycRequest = await KYCRequest.create({
        performerId: testPerformer.id,
        status: 'in_progress',
        submittedData: mockKYCRequestData,
        verificationId: 'ver_test123',
        verificationResult: {
          overallStatus: 'in_progress',
          riskScore: 85,
          checks: {
            documentAuthenticity: { status: 'passed', confidence: 95 },
            faceMatch: { status: 'pending', confidence: 0 }
          }
        }
      });

      // 検証ステップ作成
      await KYCVerificationStep.create({
        kycRequestId: kycRequest.id,
        stepType: 'document_verification',
        status: 'completed',
        result: { authentic: true, confidence: 95 }
      });
    });

    it('should get KYC request status successfully', async () => {
      const response = await request(app)
        .get(`/api/v1/kyc/${kycRequest.id}/status`)
        .set('Authorization', `Bearer ${authToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data).toHaveProperty('requestId', kycRequest.id);
      expect(response.body.data).toHaveProperty('status', 'in_progress');
      expect(response.body.data).toHaveProperty('verificationSteps');
      expect(response.body.data.verificationSteps).toHaveLength(1);
      expect(response.body.data).toHaveProperty('riskScore', 85);
    });

    it('should allow admin to view any KYC request', async () => {
      const response = await request(app)
        .get(`/api/v1/kyc/${kycRequest.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data.requestId).toBe(kycRequest.id);
    });

    it('should return 404 for non-existent request', async () => {
      const response = await request(app)
        .get('/api/v1/kyc/99999/status')
        .set('Authorization', `Bearer ${authToken}`);

      expectValidApiResponse(response, 404);
      expect(response.body.error.code).toBe('KYC_REQUEST_NOT_FOUND');
    });
  });

  describe('POST /api/v1/kyc/:requestId/approve', () => {
    let kycRequest;

    beforeEach(async () => {
      kycRequest = await KYCRequest.create({
        performerId: testPerformer.id,
        status: 'in_review',
        submittedData: mockKYCRequestData,
        verificationId: 'ver_test123',
        verificationResult: {
          overallStatus: 'passed',
          riskScore: 95
        }
      });
    });

    it('should approve KYC request successfully (admin only)', async () => {
      const response = await request(app)
        .post(`/api/v1/kyc/${kycRequest.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'All checks passed successfully'
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data.status).toBe('verified');

      // パフォーマーのKYCステータス確認
      await testPerformer.reload();
      expect(testPerformer.kycStatus).toBe('verified');
      expect(testPerformer.isVerified).toBe(true);
    });

    it('should reject non-admin approval attempts', async () => {
      const response = await request(app)
        .post(`/api/v1/kyc/${kycRequest.id}/approve`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          notes: 'Trying to approve'
        });

      expectValidApiResponse(response, 403);
      expect(response.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should not approve already verified request', async () => {
      // KYCリクエストを既に承認済みに更新
      await kycRequest.update({ status: 'verified' });

      const response = await request(app)
        .post(`/api/v1/kyc/${kycRequest.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Trying to approve again'
        });

      expectValidApiResponse(response, 400);
      expect(response.body.error.code).toBe('INVALID_KYC_STATUS');
    });
  });

  describe('POST /api/v1/kyc/:requestId/reject', () => {
    let kycRequest;

    beforeEach(async () => {
      kycRequest = await KYCRequest.create({
        performerId: testPerformer.id,
        status: 'in_review',
        submittedData: mockKYCRequestData,
        verificationId: 'ver_test123'
      });
    });

    it('should reject KYC request successfully (admin only)', async () => {
      const response = await request(app)
        .post(`/api/v1/kyc/${kycRequest.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'document_unclear',
          notes: 'ID document is not clearly visible'
        });

      expectValidApiResponse(response, 200);
      expect(response.body.data.status).toBe('rejected');
      expect(response.body.data.rejectionReason).toBe('document_unclear');

      // パフォーマーのKYCステータス確認
      await testPerformer.reload();
      expect(testPerformer.kycStatus).toBe('rejected');
      expect(testPerformer.isVerified).toBe(false);
    });

    it('should require rejection reason', async () => {
      const response = await request(app)
        .post(`/api/v1/kyc/${kycRequest.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          notes: 'Missing reason'
        });

      expect(response).toHaveValidationError('reason');
    });

    it('should validate rejection reason values', async () => {
      const response = await request(app)
        .post(`/api/v1/kyc/${kycRequest.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'invalid_reason',
          notes: 'Testing invalid reason'
        });

      expect(response).toHaveValidationError('reason');
    });
  });

  describe('GET /api/v1/kyc/pending', () => {
    beforeEach(async () => {
      // 複数のKYCリクエスト作成
      const statuses = ['pending', 'in_review', 'verified', 'rejected'];
      
      for (let i = 0; i < statuses.length; i++) {
        const performer = await Performer.create({
          userId: 100 + i,
          username: `performer_${i}`,
          displayName: `Test Performer ${i}`,
          kycStatus: statuses[i]
        });

        await KYCRequest.create({
          performerId: performer.id,
          status: statuses[i],
          submittedData: mockKYCRequestData,
          verificationId: `ver_test_${i}`
        });
      }
    });

    it('should list pending KYC requests (admin only)', async () => {
      const response = await request(app)
        .get('/api/v1/kyc/pending')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(2); // pending と in_review のみ
      expect(response.body.data.every(req => 
        ['pending', 'in_review'].includes(req.status)
      )).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/v1/kyc/pending?page=1&limit=1')
        .set('Authorization', `Bearer ${adminToken}`);

      expectValidApiResponse(response, 200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination.total).toBe(2);
      expect(response.body.pagination.pages).toBe(2);
    });

    it('should reject non-admin access', async () => {
      const response = await request(app)
        .get('/api/v1/kyc/pending')
        .set('Authorization', `Bearer ${authToken}`);

      expectValidApiResponse(response, 403);
    });
  });
});