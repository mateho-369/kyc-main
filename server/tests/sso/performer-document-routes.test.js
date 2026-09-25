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

const mockState = { performers: new Map(), audit: [], nextId: 1 };

// JWT middleware stand-in: role/user id come from test headers
jest.mock('../../middleware/hybrid-auth', () => (req, res, next) => {
  const role = req.header('x-test-role');
  if (!role) return res.status(401).json({ error: 'no token' });
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

    async save() {
      mockState.performers.set(this.id, clone(this.get()));
      return this;
    }

    static async findByPk(id) {
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

  return {
    Performer: MockPerformer,
    // Same NOT NULL columns as server/models/AuditLog.js
    AuditLog: {
      create: jest.fn(async (values) => {
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
  test('verifying all required documents notifies document.verified and performer.approved', async () => {
    receiver = await startSharegramReceiver(SECRET);
    process.env.KYC_WEBHOOK_URL = receiver.url;
    process.env.KYC_WEBHOOK_SECRET = SECRET;
    seedPerformer();

    for (const type of ['agreement_file', 'id_front', 'selfie']) {
      const res = await request(app).put(`/api/performers/1/documents/${type}/verify`).set(ADMIN);
      expect(res.status).toBe(200);
    }

    await waitFor(() => receiver.received.length === 4);
    receiver.received.forEach((entry) => expect(entry.signatureValid).toBe(true));

    const events = receiver.received.map((entry) => entry.body.event).sort();
    expect(events).toEqual(['document.verified', 'document.verified', 'document.verified', 'performer.approved']);

    const approved = receiver.received.find((entry) => entry.body.event === 'performer.approved').body.data;
    expect(approved.performer).toMatchObject({ id: 1, status: 'active' });
    expect(approved.performer.documents.agreementFile.verified).toBe(true);
    expect(approved.owner.email).toBe('fbcreator2@gmail.com');
    expect(mockState.performers.get(1).status).toBe('active');
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
