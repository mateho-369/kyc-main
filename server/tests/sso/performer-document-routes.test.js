/**
 * Performer document routes + Sharegram webhook, through the REAL router
 * (server/routes/performers.js).
 *
 * Regression tests for the local 404s:
 *   GET /api/performers/:id/documents/metadata      → was shadowed by /:id/documents/:type
 *   PUT /api/performers/:id/documents/agreement_file/verify → DB stores "agreementFile"
 *
 * Faked boundaries only: Sequelize models (MySQL) and the JWT middleware.
 * The Sharegram receiver is a real HTTP server that checks the HMAC signature.
 */

process.env.NODE_ENV = 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

const mockState = { performers: new Map(), audit: [], nextId: 1, decisions: [], outbox: [] };

// JWT middleware stand-in: role/user id come from test headers
jest.mock('../../middleware/hybrid-auth', () => (req, res, next) => {
  const role = req.header('x-test-role');
  if (!role) return res.status(401).json({ error: 'no token' });
  if (req.header('x-test-system')) req.sharegramAuth = { authenticated: true };
  req.user = { id: Number(req.header('x-test-user-id') || 1), role, email: 'tester@example.com', sharegramUserId: null };
  return next();
});

jest.mock('../../models', () => {
  const clone = (value) => JSON.parse(JSON.stringify(value));

  class MockPerformer {
    constructor(values) {
      Object.assign(this, values);
    }

    get() {
      return { ...this };
    }

    changed() {}

    async save(options) {
      if (mockState.reviewTransaction) expect(options.transaction).toBe(mockState.reviewTransaction);
      mockState.performers.set(this.id, clone(this.get()));
      return this;
    }

    static async findByPk(id, options) {
      if (mockState.reviewTransaction) {
        expect(options.transaction).toBe(mockState.reviewTransaction);
        expect(options.lock).toBe('UPDATE');
      }
      const row = mockState.performers.get(Number(id));
      return row ? new MockPerformer(clone(row)) : null;
    }

    static async create(values) {
      const id = mockState.nextId++;
      const now = new Date().toISOString();
      const row = { id, kycStatus: 'not_started', ...clone(values), createdAt: now, updatedAt: now };
      mockState.performers.set(id, row);
      return new MockPerformer(clone(row));
    }

    static async update(values, { where }) {
      const row = mockState.performers.get(Number(where.id));
      if (!row) return [0];
      Object.assign(row, clone(values));
      return [1];
    }

    static async destroy({ where }) {
      return mockState.performers.delete(Number(where.id)) ? 1 : 0;
    }
  }

  // Transaction boundary double: tests assert option propagation and rollback.
  // This does not simulate MySQL isolation or real concurrent row locks.
  MockPerformer.sequelize = {
    transaction: async (callback) => {
      const before = clone([...mockState.performers]);
      const auditLength = mockState.audit.length;
      const decisionLength = mockState.decisions.length;
      const outboxLength = mockState.outbox.length;
      mockState.reviewTransaction = { LOCK: { UPDATE: 'UPDATE' } };
      try {
        return await callback(mockState.reviewTransaction);
      } catch (error) {
        mockState.performers = new Map(before);
        mockState.audit.length = auditLength;
        mockState.decisions.length = decisionLength;
        mockState.outbox.length = outboxLength;
        throw error;
      } finally {
        mockState.reviewTransaction = null;
      }
    }
  };
  return {
    Performer: MockPerformer,
    PerformerDecision: { create: jest.fn(async (row, options) => { expect(options.transaction).toBe(mockState.reviewTransaction); mockState.decisions.push(row); return row; }) },
    DecisionOutbox: { create: jest.fn(async (row, options) => { expect(options.transaction).toBe(mockState.reviewTransaction); mockState.outbox.push(row); return row; }) },
    // Same NOT NULL columns as server/models/AuditLog.js
    AuditLog: {
      create: jest.fn(async (values, options) => {
        if (mockState.reviewTransaction) expect(options.transaction).toBe(mockState.reviewTransaction);
        ['userId', 'action', 'resourceType', 'resourceId'].forEach((column) => {
          if (values[column] === undefined || values[column] === null) {
            throw new Error(`notNull Violation: AuditLog.${column} cannot be null`);
          }
        });
        mockState.audit.push(values);
        return values;
      })
    },
    User: {
      findByPk: jest.fn(async (id) =>
        id === 7 ? { id: 7, email: 'fbcreator2@gmail.com', firebaseUid: 'jeV3farXEowM1r60tv5Wr7QoPZ31', sharegramUserId: null } : null
      )
    }
  };
});

jest.mock('../../services/webhookService', () => ({ triggerWebhook: jest.fn(async () => []) }));

const { startSharegramReceiver, waitFor } = require('./helpers/sharegramReceiver');

const SECRET = 'c'.repeat(64);
const ADMIN = { 'x-test-role': 'admin', 'x-test-user-id': '1' };
const OWNER = { 'x-test-role': 'user', 'x-test-user-id': '7' };
const STRANGER = { 'x-test-role': 'user', 'x-test-user-id': '99' };

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/performers', require('../../routes/performers'));
  app.use((req, res) => res.status(404).json({ message: `Not Found: ${req.originalUrl}` }));
  return app;
};

let app;
let tmpDir;
let receiver;
const consoleSpies = [];

const seedPerformer = ({ asString = false } = {}) => {
  const agreementPath = path.join(tmpDir, 'agreementFile-1.pdf');
  fs.writeFileSync(agreementPath, '%PDF-1.4 local test');
  const documents = {
    agreementFile: { path: agreementPath, originalName: 'agreement.pdf', mimeType: 'application/pdf', verified: false },
    idFront: { path: path.join(tmpDir, 'idFront-1.jpg'), originalName: 'front.jpg', mimeType: 'image/jpeg', verified: false },
    idBack: null,
    selfie: { path: path.join(tmpDir, 'selfie-1.jpg'), originalName: 'selfie.jpg', mimeType: 'image/jpeg', verified: false },
    selfieWithId: null
  };
  mockState.performers.set(1, {
    id: 1,
    userId: 7,
    lastName: '山田',
    firstName: '花子',
    lastNameRoman: 'Yamada',
    firstNameRoman: 'Hanako',
    status: 'pending',
    kycStatus: 'not_started',
    external_id: null,
    sharegramUserId: null,
    // MySQL returns JSON columns as objects; MariaDB (XAMPP) returns strings
    documents: asString ? JSON.stringify(documents) : documents,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z'
  });
};

beforeAll(() => {
  app = buildApp();
});

beforeEach(() => {
  ['KYC_WEBHOOK_URL', 'KYC_WEBHOOK_SECRET', 'KYC_WEBHOOK_EVENTS'].forEach((key) => delete process.env[key]);
  mockState.performers.clear();
  mockState.audit.length = 0;
  mockState.decisions.length = 0;
  mockState.outbox.length = 0;
  mockState.nextId = 2;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kyc-docs-'));
  ['log', 'warn', 'error'].forEach((level) => consoleSpies.push(jest.spyOn(console, level).mockImplementation(() => {})));
});

afterEach(async () => {
  consoleSpies.splice(0).forEach((spy) => spy.mockRestore());
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (receiver) {
    await receiver.close();
    receiver = null;
  }
});

describe('GET /api/performers/:id/documents/metadata', () => {
  test.each([
    ['object (MySQL)', false],
    ['JSON string (MariaDB)', true]
  ])('returns metadata instead of 404 when documents are a %s', async (label, asString) => {
    seedPerformer({ asString });

    const res = await request(app).get('/api/performers/1/documents/metadata').set(ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      performerId: 1,
      totalDocuments: 5,
      pendingDocuments: 3,
      missingDocuments: 2,
      overallStatus: 'pending'
    });
    expect(res.body.data.documents.map((doc) => doc.type)).toEqual([
      'agreementFile',
      'idFront',
      'idBack',
      'selfie',
      'selfieWithId'
    ]);
    // audit row satisfies the real NOT NULL columns
    expect(mockState.audit).toContainEqual(
      expect.objectContaining({ action: 'view', resourceType: 'document', resourceId: 1 })
    );
  });

  test('owner can read, other users get 403 (not 404)', async () => {
    seedPerformer();
    expect((await request(app).get('/api/performers/1/documents/metadata').set(OWNER)).status).toBe(200);
    expect((await request(app).get('/api/performers/1/documents/metadata').set(STRANGER)).status).toBe(403);
  });

  test('unknown performer is a real 404', async () => {
    const res = await request(app).get('/api/performers/999/documents/metadata').set(ADMIN);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PERFORMER_NOT_FOUND');
  });
});

describe('document type names from the UI (snake_case)', () => {
  test('PUT .../agreement_file/verify verifies agreementFile', async () => {
    seedPerformer();

    const res = await request(app).put('/api/performers/1/documents/agreement_file/verify').set(ADMIN);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verified: true, allVerified: false });
    expect(mockState.performers.get(1).documents.agreementFile.verified).toBe(true);
    expect(mockState.audit).toContainEqual(
      expect.objectContaining({ action: 'verify', details: { documentType: 'agreementFile' } })
    );
  });

  test('verification stays admin-only', async () => {
    seedPerformer();
    const res = await request(app).put('/api/performers/1/documents/agreement_file/verify').set(OWNER);
    expect(res.status).toBe(403);
    expect(mockState.performers.get(1).documents.agreementFile.verified).toBe(false);
  });

  test('GET .../documents/agreement_file streams the stored file', async () => {
    seedPerformer();
    const res = await request(app).get('/api/performers/1/documents/agreement_file').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });
});

describe('Sharegram webhook from the real routes', () => {
  test('verifying all required documents notifies documents only; final approval remains separate', async () => {
    receiver = await startSharegramReceiver(SECRET);
    process.env.KYC_WEBHOOK_URL = receiver.url;
    process.env.KYC_WEBHOOK_SECRET = SECRET;
    seedPerformer();

    for (const type of ['agreement_file', 'id_front', 'selfie']) {
      const res = await request(app).put(`/api/performers/1/documents/${type}/verify`).set(ADMIN);
      expect(res.status).toBe(200);
    }

    await waitFor(() => receiver.received.length === 3);
    receiver.received.forEach((entry) => expect(entry.signatureValid).toBe(true));

    const events = receiver.received.map((entry) => entry.body.event).sort();
    expect(events).toEqual(['document.verified', 'document.verified', 'document.verified']);
    for (const entry of receiver.received) {
      expect(entry.body.data.performer.status).toBe('pending');
      expect(entry.body.data.performer.kycStatus).toBe('not_started');
    }
    expect(mockState.performers.get(1).status).toBe('pending');
    expect(mockState.performers.get(1).kycStatus).toBe('not_started');
  });

  test('creating a performer notifies performer.created with the SSO owner', async () => {
    receiver = await startSharegramReceiver(SECRET);
    process.env.KYC_WEBHOOK_URL = receiver.url;
    process.env.KYC_WEBHOOK_SECRET = SECRET;

    const res = await request(app)
      .post('/api/performers')
      .set(OWNER)
      .field('lastName', '佐藤')
      .field('firstName', '次郎')
      .field('lastNameRoman', 'Sato')
      .field('firstNameRoman', 'Jiro')
      .attach('agreementFile', Buffer.from('%PDF-1.4'), { filename: 'agreement.pdf', contentType: 'application/pdf' })
      .attach('idFront', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'front.jpg', contentType: 'image/jpeg' })
      .attach('selfie', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'selfie.jpg', contentType: 'image/jpeg' });

    // multer wrote real files into server/uploads/performers — remove them
    const created = mockState.performers.get(res.body.data && res.body.data.id);
    if (created) {
      Object.values(created.documents || {}).forEach((doc) => doc && fs.rmSync(doc.path, { force: true }));
    }

    expect(res.status).toBe(200);
    await waitFor(() => receiver.received.length === 1);

    const [entry] = receiver.received;
    expect(entry.signatureValid).toBe(true);
    expect(entry.body.event).toBe('performer.created');
    expect(entry.body.data.performer).toMatchObject({
      id: res.body.data.id,
      userId: 7,
      lastNameRoman: 'Sato',
      status: 'pending',
      documents: { agreementFile: { uploaded: true, verified: false }, idBack: { uploaded: false } }
    });
    expect(entry.body.data.owner).toMatchObject({ email: 'fbcreator2@gmail.com', firebaseUid: 'jeV3farXEowM1r60tv5Wr7QoPZ31' });
    expect(entry.rawBody).not.toMatch(/uploads/);
  });

  test('without KYC_WEBHOOK_URL nothing is sent and the API still succeeds', async () => {
    receiver = await startSharegramReceiver(SECRET);
    seedPerformer();

    const res = await request(app).put('/api/performers/1/documents/agreement_file/verify').set(ADMIN);

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(receiver.received).toHaveLength(0);
  });

  test('Sharegram being down never breaks the KYC API', async () => {
    process.env.KYC_WEBHOOK_URL = 'http://127.0.0.1:9/v2/kyc/webhook';
    process.env.KYC_WEBHOOK_SECRET = SECRET;
    seedPerformer();

    const res = await request(app).put('/api/performers/1/documents/agreement_file/verify').set(ADMIN);
    expect(res.status).toBe(200);

    // the background delivery gives up after 3 attempts (1s + 3s back-off) without throwing
    const warnings = () => console.warn.mock.calls.map((call) => call.join(' '));
    await waitFor(() => warnings().some((line) => line.includes('attempt 3/3')), 8000);
    expect(warnings().filter((line) => line.includes('ECONNREFUSED'))).toHaveLength(3);
  });
});


describe('auditable reviewer boundaries', () => {
  test.each([
    ['owner', OWNER], ['stranger', STRANGER],
    ['system credential', { ...ADMIN, 'x-test-system': 'true' }],
    ['synthetic admin', { ...ADMIN, 'x-test-user-id': '0' }]
  ])('%s cannot approve or verify', async (label, headers) => {
    seedPerformer();
    expect((await request(app).post('/api/performers/1/approve').set(headers)).status).toBe(403);
    expect((await request(app).put('/api/performers/1/documents/id_front/verify').set(headers)).status).toBe(403);
    expect(mockState.performers.get(1).status).toBe('pending');
    expect(mockState.audit).toHaveLength(0);
  });

  test('unauthenticated review is denied', async () => {
    expect((await request(app).post('/api/performers/1/approve')).status).toBe(401);
    expect((await request(app).put('/api/performers/1/documents/id_front/verify')).status).toBe(401);
  });

  test('approve commits accurate prior status and audit together', async () => {
    seedPerformer();
    for (const doc of Object.values(mockState.performers.get(1).documents)) if (doc) doc.verified = true;
    const response = await request(app).post('/api/performers/1/approve').set(ADMIN);
    expect(response.status).toBe(200);
    expect(mockState.performers.get(1).status).toBe('active');
    expect(mockState.audit).toContainEqual(expect.objectContaining({
      userId: 1, action: 'approve', details: expect.objectContaining({ previousStatus: 'pending', previousKycStatus: 'not_started', newStatus: 'active', newKycStatus: 'verified' })
    }));
  });

  test.each(['approve', 'documents/id_front/verify'])('audit failure rolls back %s and sends no event', async (route) => {
    seedPerformer();
    receiver = await startSharegramReceiver(SECRET);
    process.env.KYC_WEBHOOK_URL = receiver.url;
    process.env.KYC_WEBHOOK_SECRET = SECRET;
    if (route === 'approve') for (const doc of Object.values(mockState.performers.get(1).documents)) if (doc) doc.verified = true;
    require('../../models').AuditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
    const method = route === 'approve' ? 'post' : 'put';
    const response = await request(app)[method](`/api/performers/1/${route}`).set(ADMIN);
    expect(response.status).toBe(500);
    expect(mockState.performers.get(1).status).toBe('pending');
    expect(mockState.performers.get(1).documents.idFront.verified).toBe(route === 'approve');
    expect(mockState.decisions).toHaveLength(0);
    expect(mockState.outbox).toHaveLength(0);
    await new Promise(resolve => setImmediate(resolve));
    expect(receiver.received).toHaveLength(0);
  });

  test('unknown approval target is 404 with no audit', async () => {
    expect((await request(app).post('/api/performers/999/approve').set(ADMIN)).status).toBe(404);
    expect(mockState.audit).toHaveLength(0);
  });

  test('approval returns durable pending notification without calling legacy sender', async () => {
    seedPerformer();
    require('../../services/webhookService').triggerWebhook.mockClear();
    for (const doc of Object.values(mockState.performers.get(1).documents)) if (doc) doc.verified = true;
    const response = await request(app).post('/api/performers/1/approve').set(ADMIN);
    expect(response.status).toBe(200);
    expect(mockState.performers.get(1).status).toBe('active');
    expect(response.body.notification).toMatchObject({ status: 'pending' });
    expect(mockState.outbox).toHaveLength(1);
    expect(require('../../services/webhookService').triggerWebhook).not.toHaveBeenCalled();
  });

  test('MariaDB string documents retain alias verification and readiness', async () => {
    seedPerformer({ asString: true });
    for (const type of ['agreement_file', 'id_front', 'selfie']) {
      const response = await request(app).put(`/api/performers/1/documents/${type}/verify`).set(ADMIN);
      expect(response.status).toBe(200);
      expect(response.body.allVerified).toBe(type === 'selfie');
    }
    expect(mockState.performers.get(1).status).toBe('pending');
  });
});


describe('explicit decision state machine', () => {
  test.each(['approve', 'reject', 'request-correction'])('non-admin cannot %s even with role in body', async action => {
    seedPerformer();
    const r = await request(app).post(`/api/performers/1/${action}`).set(OWNER).send({ role: 'admin', reason: 'test' });
    expect(r.status).toBe(403);
  });
  test('approval requires every required document', async () => {
    seedPerformer();
    expect((await request(app).post('/api/performers/1/approve').set(ADMIN)).status).toBe(409);
    expect(mockState.outbox).toHaveLength(0);
  });
  test('rejection preserves reason/reviewer/time and emits minimal durable payload', async () => {
    seedPerformer();
    const r = await request(app).post('/api/performers/1/reject').set(ADMIN).send({ reason: 'Unable to verify', reasonCode: 'IDENTITY_MISMATCH' });
    expect(r.status).toBe(200);
    expect(r.body.performer).toMatchObject({ status: 'rejected', kycStatus: 'rejected' });
    expect(mockState.decisions[0]).toMatchObject({ reviewerId: 1, reason: 'Unable to verify', reasonCode: 'IDENTITY_MISMATCH', previousStatus: 'pending' });
    expect(mockState.decisions[0].createdAt).toBeInstanceOf(Date);
    const payload = mockState.outbox[0].payload;
    expect(payload).toMatchObject({ eventId: r.body.decisionId, eventType: 'performer.rejected', schemaVersion: 2, owner: { firebaseUid: expect.any(String) } });
    expect(Object.keys(payload.performer).sort()).toEqual(['externalId', 'id', 'kycStatus', 'status']);
    expect(JSON.stringify(payload)).not.toMatch(/email|lastName|firstName|documents|path|address|birth|Unable to verify/);
    expect((await request(app).post('/api/performers/1/approve').set(ADMIN)).status).toBe(409);
    expect((await request(app).post('/api/performers/1/resubmit').set(OWNER)).status).toBe(409);
    expect((await request(app).put('/api/performers/1').set(OWNER).send({ lastName: 'changed' })).status).toBe(409);
  });
  test.each([{}, { reason: ' ' }, { reason: 'x', reasonCode: 'invalid code' }, { reason: 'x'.repeat(2001) }])('reject validates %j', async body => {
    seedPerformer();
    expect((await request(app).post('/api/performers/1/reject').set(ADMIN).send(body)).status).toBe(400);
  });
  test('correction and owner resubmission keep earlier decisions without emitting final event', async () => {
    seedPerformer();
    expect((await request(app).post('/api/performers/1/request-correction').set(ADMIN).send({ reason: 'Replace blurry ID' })).status).toBe(200);
    expect(mockState.performers.get(1)).toMatchObject({ status: 'pending', kycStatus: 'in_progress', kycMetadata: { reviewState: 'correction_required' } });
    expect(mockState.outbox).toHaveLength(0);
    expect((await request(app).post('/api/performers/1/approve').set(ADMIN)).status).toBe(409);
    expect((await request(app).post('/api/performers/1/resubmit').set(STRANGER)).status).toBe(403);
    expect((await request(app).post('/api/performers/1/resubmit').set(OWNER)).status).toBe(200);
    expect(mockState.decisions).toHaveLength(1);
    expect(mockState.performers.get(1).kycMetadata.reviewState).toBe('submitted');
  });
  test('document rejection persists its reason without deciding performer', async () => {
    seedPerformer();
    const r = await request(app).put('/api/performers/1/documents/id_front/reject').set(ADMIN).send({ reason: 'Blurry' });
    expect(r.status).toBe(200);
    expect(mockState.performers.get(1).documents.idFront).toMatchObject({ verified: false, rejectionReason: 'Blurry', rejectedBy: 1 });
    expect(mockState.performers.get(1).status).toBe('pending');
    expect(mockState.audit[0].details.reason).toBe('Blurry');
  });
  test('missing external owner identity fails closed and outbox failure rolls back', async () => {
    seedPerformer();
    require('../../models').User.findByPk.mockResolvedValueOnce({ id: 7 });
    expect((await request(app).post('/api/performers/1/reject').set(ADMIN).send({ reason: 'test' })).status).toBe(409);
    require('../../models').DecisionOutbox.create.mockRejectedValueOnce(new Error('outbox unavailable'));
    expect((await request(app).post('/api/performers/1/reject').set(ADMIN).send({ reason: 'test' })).status).toBe(500);
    expect(mockState.performers.get(1).status).toBe('pending');
    expect(mockState.decisions).toHaveLength(0);
  });
  test('legacy external status writers fail closed', async () => {
    expect((await request(app).post('/api/performers/sync').set(ADMIN).send({ performers: [] })).status).toBe(409);
    expect((await request(app).post('/api/performers/kyc-approved').send({ performerId: 1, kycStatus: 'approved' })).status).toBe(409);
  });
});


describe('alternate writer guardrails', () => {
  test('name changes invalidate prior document verification and ignore injected statuses', async () => {
    seedPerformer();
    for (const doc of Object.values(mockState.performers.get(1).documents)) if (doc) doc.verified = true;
    const r = await request(app).put('/api/performers/1').set(OWNER).send({ lastName: 'Changed', status: 'active', kycStatus: 'verified', role: 'admin' });
    expect(r.status).toBe(200);
    const row = mockState.performers.get(1);
    expect(row).toMatchObject({ status: 'pending', kycStatus: 'not_started' });
    expect(row.documents.idFront.verified).toBe(false);
    expect((await request(app).post('/api/performers/1/approve').set(ADMIN)).status).toBe(409);
  });
  test('final records cannot be deleted or document-verified', async () => {
    seedPerformer(); mockState.performers.get(1).status = 'active'; mockState.performers.get(1).kycStatus = 'verified';
    expect((await request(app).delete('/api/performers/1').set(OWNER)).status).toBe(409);
    expect((await request(app).put('/api/performers/1/documents/id_front/verify').set(ADMIN)).status).toBe(409);
    expect(mockState.performers.has(1)).toBe(true);
  });
  test('audit failure on update retains the old identity and documents', async () => {
    seedPerformer();
    require('../../models').AuditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
    expect((await request(app).put('/api/performers/1').set(OWNER).send({ lastName: 'Changed' })).status).toBe(500);
    expect(mockState.performers.get(1).lastName).toBe('山田');
  });
});
