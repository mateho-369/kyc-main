/**
 * Sharegram master → KYC（サーバー間）の読み取り契約。Sharegram 側は変更しない前提。
 *
 * 仕様: API_DOCUMENTATION_SHAREGRAM.md（4.1 出演者一覧 / 4.2 出演者情報）
 *   Sharegram の .env  KYC_URL_API=http://localhost:5002/api
 *                      AUTHORIZED_KYC_KEY=<key>   → Authorization: Bearer <key>
 *   KYC の server/.env SYSTEM_API_KEYS=<同じ key>
 *
 * 本物: hybrid-auth（Bearer 判定）と routes/performers.js。
 * 偽物: Sequelize モデルだけ（MySQL 無しで動かすため）。
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'jwt-secret-for-tests-only-0123456789abcdef';

const express = require('express');
const request = require('supertest');

const SHAREGRAM_KEY = 'a1b2c3'.repeat(10) + 'abcd'; // 64文字（本物と同じ長さのダミー）
const OWNER_UID = 'jeV3farXEowM1r60tv5Wr7QoPZ31'; // Sharegram と KYC が同じエミュレータで共有する Firebase UID
const OTHER_UID = 'someoneElseUid000000000000001';

const mockDb = { users: [], performers: [] };

jest.mock('../../models', () => {
  const pick = (row, attributes) => {
    if (!attributes) return { ...row };
    return attributes.reduce((out, key) => {
      if (key in row) out[key] = row[key];
      return out;
    }, {});
  };
  // where は routes/performers.js が作る形のうち、この契約で使うもの（userId / status）だけ解釈する
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => (typeof value === 'object' && value !== null ? true : row[key] === value));

  const asInstance = (row) => ({ ...row, toJSON: () => ({ ...row }) });

  return {
    Performer: {
      count: jest.fn(async ({ where }) => mockDb.performers.filter((p) => matches(p, where)).length),
      findAll: jest.fn(async ({ where, attributes, limit = 20, offset = 0 }) =>
        mockDb.performers
          .filter((p) => matches(p, where))
          .slice(offset, offset + limit)
          .map((p) => pick(p, attributes))
      ),
      findByPk: jest.fn(async (id) => {
        const row = mockDb.performers.find((p) => String(p.id) === String(id));
        return row ? asInstance(row) : null;
      })
    },
    User: {
      findOne: jest.fn(async ({ where }) => mockDb.users.find((u) => u.firebaseUid === where.firebaseUid) || null),
      findByPk: jest.fn(async (id) => mockDb.users.find((u) => u.id === id) || null)
    },
    AuditLog: { create: jest.fn(async (values) => values) },
    // hybrid-auth / sharegram-auth / auditLogger が require するだけのもの
    SharegramIntegration: {},
    ApiLog: { create: jest.fn(async () => ({})) },
    Webhook: {},
    ApiKey: {}
  };
});

const documentsOf = (verified) => ({
  agreementFile: { path: '/srv/uploads/performers/agreementFile-2.pdf', originalName: 'agreement.pdf', mimeType: 'application/pdf', verified },
  idFront: { path: '/srv/uploads/performers/idFront-2.jpg', originalName: 'front.jpg', mimeType: 'image/jpeg', verified },
  idBack: null,
  selfie: { path: '/srv/uploads/performers/selfie-2.jpg', originalName: 'selfie.jpg', mimeType: 'image/jpeg', verified },
  selfieWithId: null
});

const performerRow = (overrides) => ({
  external_id: null,
  sharegramUserId: null,
  lastName: '山田',
  firstName: '花子',
  lastNameRoman: 'Yamada',
  firstNameRoman: 'Hanako',
  status: 'pending',
  kycStatus: 'not_started',
  kycVerifiedAt: null,
  riskScore: null,
  documents: documentsOf(false),
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  ...overrides
});

// 仕様書 4.1 のレスポンス項目
const SPEC_LIST_FIELDS = [
  'id', 'external_id', 'lastName', 'firstName', 'lastNameRoman', 'firstNameRoman',
  'status', 'kycStatus', 'kycVerifiedAt', 'riskScore', 'createdAt', 'updatedAt'
];

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/performers', require('../../routes/performers'));
  app.use((req, res) => res.status(404).json({ message: `Not Found: ${req.originalUrl}` }));
  return app;
};

const asSharegram = (req) => req.set('Authorization', `Bearer ${SHAREGRAM_KEY}`).set('Accept', 'application/json');

let app;
let logSpy;
let warnSpy;
let errorSpy;

const sharegramLogLines = () => logSpy.mock.calls.map((args) => args.join(' ')).filter((line) => line.startsWith('[sharegram-api]'));

beforeAll(() => {
  app = buildApp();
});

beforeEach(() => {
  process.env.SYSTEM_API_KEYS = SHAREGRAM_KEY;
  mockDb.users = [
    { id: 7, email: 'fbcreator2@gmail.com', firebaseUid: OWNER_UID },
    { id: 8, email: 'other@example.com', firebaseUid: OTHER_UID }
  ];
  mockDb.performers = [
    performerRow({ id: 1, userId: 8, lastName: '別人' }),
    performerRow({ id: 2, userId: 7 }),
    performerRow({ id: 3, userId: 7, status: 'active', documents: JSON.stringify(documentsOf(true)) }) // MariaDB は JSON を文字列で返す
  ];
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  delete process.env.SYSTEM_API_KEYS;
});

describe('GET /api/performers (spec 4.1) with Sharegram\'s AUTHORIZED_KYC_KEY', () => {
  it('returns { success: true, data: [...] } with the fields the spec lists', async () => {
    const res = await asSharegram(request(app).get('/api/performers'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(3);
    res.body.data.forEach((performer) => {
      SPEC_LIST_FIELDS.forEach((field) => expect(performer).toHaveProperty(field));
    });
  });

  it('user_id=<Firebase UID> returns only that creator\'s performers, including pending ones', async () => {
    const res = await asSharegram(request(app).get(`/api/performers?user_id=${OWNER_UID}`));

    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.id).sort()).toEqual([2, 3]);
    expect(res.body.data.find((p) => p.id === 2).status).toBe('pending');
    expect(sharegramLogLines()).toEqual([
      expect.stringContaining(`user_id=${OWNER_UID} → 2 of 2 performer(s): #2 pending, #3 active`)
    ]);
  });

  it('ignores status= for Sharegram (original behaviour: pending performers are always returned)', async () => {
    const res = await asSharegram(request(app).get(`/api/performers?user_id=${OWNER_UID}&status=active`));
    expect(res.body.data.map((p) => p.id).sort()).toEqual([2, 3]);
  });

  it('an unknown user_id returns an empty list and says why in the KYC log', async () => {
    const res = await asSharegram(request(app).get('/api/performers?user_id=11048'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
    const [line] = sharegramLogLines();
    expect(line).toContain('user_id=11048');
    expect(line).toContain('no KYC user has firebaseUid=11048');
  });
});

describe('GET /api/performers/:id (spec 4.2) with Sharegram\'s AUTHORIZED_KYC_KEY', () => {
  it('puts the performer fields directly under data, as the spec shows', async () => {
    const res = await asSharegram(request(app).get('/api/performers/2'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 2,
      lastName: '山田',
      firstNameRoman: 'Hanako',
      status: 'pending',
      kycStatus: 'not_started'
    });
    expect(res.body.data.documents.agreementFile).toMatchObject({
      originalName: 'agreement.pdf',
      mimeType: 'application/pdf',
      verified: false
    });
    expect(res.body.data.documents.idBack).toBeNull();
    expect(sharegramLogLines()).toEqual([expect.stringContaining('/api/performers/2 → 200 (status=pending)')]);
  });

  it('keeps data.performer for existing readers (the KYC screens read data.performer || data)', async () => {
    const res = await asSharegram(request(app).get('/api/performers/2'));

    expect(res.body.data.performer.id).toBe(2);
    const { performer, ...topLevel } = res.body.data;
    expect(performer).toEqual(topLevel);
  });

  it('returns documents as an object even when the database hands back a JSON string (MariaDB/XAMPP)', async () => {
    const res = await asSharegram(request(app).get('/api/performers/3'));

    expect(typeof res.body.data.documents).toBe('object');
    expect(res.body.data.documents.selfie.verified).toBe(true);
    expect(res.body.data.performer.documents.selfie.verified).toBe(true);
  });

  it('answers 404 in the spec\'s format for an unknown id', async () => {
    const res = await asSharegram(request(app).get('/api/performers/999'));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: '出演者情報が見つかりません。正しいIDで再度お試しください。'
    });
    expect(sharegramLogLines()).toEqual([expect.stringContaining('/api/performers/999 → 404')]);
  });
});

describe('the key has to match', () => {
  it('rejects a request without the key', async () => {
    const res = await request(app).get('/api/performers');
    expect(res.status).toBe(401);
  });

  it('rejects a different key', async () => {
    const res = await request(app).get('/api/performers').set('Authorization', `Bearer ${'f'.repeat(64)}`);
    expect(res.status).toBe(401);
  });

  it('rejects Sharegram\'s key when SYSTEM_API_KEYS is not set in KYC server/.env', async () => {
    delete process.env.SYSTEM_API_KEYS;
    const res = await asSharegram(request(app).get('/api/performers'));
    expect(res.status).toBe(401);
  });
});
