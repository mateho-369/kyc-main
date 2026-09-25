/**
 * KYC → Sharegram webhook sender
 * (server/services/sharegram/sharegramWebhook.js)
 *
 * A real HTTP server plays the Sharegram receiver and verifies every request
 * exactly the way the Laravel controller in docs/sharegram-kyc-webhook.md does:
 * HMAC-SHA256 over `${X-KYC-Timestamp}.${raw body}` with the shared secret.
 * Only the Sequelize User model is faked (owner lookup).
 */

process.env.NODE_ENV = 'test';

const mockUsers = new Map();
jest.mock('../../models', () => ({
  User: {
    findByPk: jest.fn(async (id) => mockUsers.get(id) || null)
  }
}));

const webhook = require('../../services/sharegram/sharegramWebhook');
const { startSharegramReceiver, waitFor } = require('./helpers/sharegramReceiver');

const SECRET = 'a'.repeat(64);
const startReceiver = (respond) => startSharegramReceiver(SECRET, respond);

const performerRow = (overrides = {}) => ({
  id: 2,
  userId: 7,
  external_id: null,
  sharegramUserId: null,
  lastName: '山田',
  firstName: '花子',
  lastNameRoman: 'Yamada',
  firstNameRoman: 'Hanako',
  status: 'pending',
  kycStatus: 'not_started',
  documents: {
    agreementFile: { path: 'C:\\kyc\\server\\uploads\\performers\\agreementFile-1.pdf', originalName: 'agreement.pdf', verified: false },
    idFront: { path: '/srv/uploads/performers/idFront-1.jpg', originalName: 'front.jpg', verified: true, verifiedAt: '2026-09-25T01:00:00.000Z' },
    idBack: null,
    selfie: { path: '/srv/uploads/performers/selfie-1.jpg', originalName: 'selfie.jpg', verified: false },
    selfieWithId: null
  },
  createdAt: new Date('2026-09-25T00:00:00.000Z'),
  updatedAt: new Date('2026-09-25T00:05:00.000Z'),
  ...overrides
});

const ENV_KEYS = ['KYC_WEBHOOK_URL', 'KYC_WEBHOOK_SECRET', 'KYC_WEBHOOK_EVENTS', 'KYC_WEBHOOK_TIMEOUT_MS'];
let receiver;
let logSpy;
let warnSpy;

beforeEach(() => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.NODE_ENV = 'test';
  mockUsers.clear();
  mockUsers.set(7, { id: 7, email: 'fbcreator2@gmail.com', firebaseUid: 'jeV3farXEowM1r60tv5Wr7QoPZ31', sharegramUserId: null });
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  if (receiver) {
    await receiver.close();
    receiver = null;
  }
});

describe('configuration', () => {
  test('does nothing when KYC_WEBHOOK_URL is not set', () => {
    expect(webhook.describeConfig()).toMatch(/^disabled/);
    expect(webhook.notifySharegram('performer.created', performerRow())).toBe(false);
  });

  test('never sends unsigned webhooks (URL without secret)', async () => {
    process.env.KYC_WEBHOOK_URL = 'http://127.0.0.1:9/v2/kyc/webhook';
    expect(webhook.describeConfig()).toMatch(/NOT SENDING: KYC_WEBHOOK_SECRET is not set/);
    expect(webhook.notifySharegram('performer.created', performerRow())).toBe(false);
    const result = await webhook.deliver('performer.created', {});
    expect(result).toMatchObject({ delivered: false, skipped: true });
  });

  test('requires https in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.KYC_WEBHOOK_URL = 'http://api.local-og.com:8000/v2/kyc/webhook';
    process.env.KYC_WEBHOOK_SECRET = SECRET;
    expect(webhook.describeConfig()).toMatch(/must use https/);
  });

  test('describes an enabled config without leaking the secret', () => {
    process.env.KYC_WEBHOOK_URL = 'http://api.local-og.com:8000/v2/kyc/webhook';
    process.env.KYC_WEBHOOK_SECRET = SECRET;
    const summary = webhook.describeConfig();
    expect(summary).toMatch(/^enabled → http:\/\/api\.local-og\.com:8000\/v2\/kyc\/webhook/);
    expect(summary).not.toContain(SECRET);
  });
});

describe('delivery', () => {
  test('signs the exact raw body and sends a path-free performer snapshot', async () => {
    receiver = await startReceiver();
    process.env.KYC_WEBHOOK_URL = receiver.url;
    process.env.KYC_WEBHOOK_SECRET = SECRET;

    expect(webhook.notifySharegram('performer.created', performerRow())).toBe(true);
    await waitFor(() => receiver.received.length === 1);

    const [request] = receiver.received;
    expect(request.method).toBe('POST');
    expect(request.signatureValid).toBe(true);
    expect(request.headers['x-kyc-event']).toBe('performer.created');
    expect(request.headers['x-kyc-delivery']).toBe(request.body.id);
    expect(request.body.event).toBe('performer.created');

    const { performer, owner } = request.body.data;
    expect(performer).toMatchObject({
      id: 2,
      userId: 7,
      lastNameRoman: 'Yamada',
      status: 'pending',
      documents: {
        agreementFile: { uploaded: true, verified: false, verifiedAt: null },
        idFront: { uploaded: true, verified: true, verifiedAt: '2026-09-25T01:00:00.000Z' },
        idBack: { uploaded: false, verified: false, verifiedAt: null }
      }
    });
    // owner = the account that actually SSO'd from Sharegram
    expect(owner).toEqual({
      id: 7,
      email: 'fbcreator2@gmail.com',
      firebaseUid: 'jeV3farXEowM1r60tv5Wr7QoPZ31',
      sharegramUserId: null
    });
    // KYC file paths / original file names never leave the KYC server
    expect(request.rawBody).not.toMatch(/uploads|agreement\.pdf|front\.jpg/);
  });

  test('signature changes when the body, secret or timestamp change', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = webhook.signPayload(SECRET, timestamp, '{"event":"performer.created"}');
    expect(signature).not.toBe(webhook.signPayload(SECRET, timestamp, '{"event":"performer.deleted"}'));
    expect(signature).not.toBe(webhook.signPayload('b'.repeat(64), timestamp, '{"event":"performer.created"}'));
    expect(signature).not.toBe(webhook.signPayload(SECRET, String(Number(timestamp) + 1), '{"event":"performer.created"}'));
  });

  test('retries on 5xx and keeps the same delivery id', async () => {
    receiver = await startReceiver((entry, count) => (count < 3 ? 503 : 200));
    process.env.KYC_WEBHOOK_URL = receiver.url;
    process.env.KYC_WEBHOOK_SECRET = SECRET;

    const result = await webhook.deliver(
      'performer.updated',
      { performer: webhook.buildPerformerSnapshot(performerRow()) },
      { retryDelaysMs: [5, 5] }
    );

    expect(result).toMatchObject({ delivered: true, status: 200, attempts: 3 });
    expect(receiver.received).toHaveLength(3);
    const ids = new Set(receiver.received.map((entry) => entry.body.id));
    expect(ids.size).toBe(1);
    receiver.received.forEach((entry) => expect(entry.signatureValid).toBe(true));
  });

  test('does not retry a 401 (wrong secret) and explains why', async () => {
    receiver = await startReceiver(() => 401);
    process.env.KYC_WEBHOOK_URL = receiver.url;
    process.env.KYC_WEBHOOK_SECRET = SECRET;

    const result = await webhook.deliver('performer.created', { performer: { id: 2 } }, { retryDelaysMs: [5, 5] });

    expect(result).toMatchObject({ delivered: false, status: 401, attempts: 1 });
    expect(receiver.received).toHaveLength(1);
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/KYC_WEBHOOK_SECRET must be identical/);
  });

  test('network failure is reported, never thrown', async () => {
    process.env.KYC_WEBHOOK_URL = 'http://127.0.0.1:9/v2/kyc/webhook'; // nothing listens on port 9
    process.env.KYC_WEBHOOK_SECRET = SECRET;
    process.env.KYC_WEBHOOK_TIMEOUT_MS = '500';

    const result = await webhook.deliver('performer.created', { performer: { id: 2 } }, { retryDelaysMs: [5] });
    expect(result).toMatchObject({ delivered: false, attempts: 2 });
    expect(result.error).toBeTruthy();
  });

  test('KYC_WEBHOOK_EVENTS limits which events are sent', async () => {
    receiver = await startReceiver();
    process.env.KYC_WEBHOOK_URL = receiver.url;
    process.env.KYC_WEBHOOK_SECRET = SECRET;
    process.env.KYC_WEBHOOK_EVENTS = 'performer.approved';

    expect(webhook.notifySharegram('performer.created', performerRow())).toBe(false);
    expect(webhook.notifySharegram('performer.approved', performerRow({ status: 'active' }))).toBe(true);
    await waitFor(() => receiver.received.length === 1);
    expect(receiver.received[0].body.event).toBe('performer.approved');
    expect(receiver.received[0].body.data.performer.status).toBe('active');
  });

  test('accepts documents stored as a JSON string (MariaDB)', () => {
    const snapshot = webhook.buildPerformerSnapshot(
      performerRow({ documents: JSON.stringify({ selfie: { path: '/x.jpg', verified: true } }) })
    );
    expect(snapshot.documents.selfie).toEqual({ uploaded: true, verified: true, verifiedAt: null });
    expect(snapshot.documents.agreementFile).toEqual({ uploaded: false, verified: false, verifiedAt: null });
  });
});
