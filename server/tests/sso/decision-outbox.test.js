'use strict';
const crypto = require('crypto');
const { Op } = require('sequelize');
jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('dns', () => ({ promises: { lookup: jest.fn() } }));
const axios = require('axios');
const dns = require('dns').promises;
const delivery = require('../../services/sharegram/decisionDelivery');
const { runOnce, MAX_ATTEMPTS } = require('../../services/sharegram/decisionOutbox');
const settings = { KYC_DECISION_WEBHOOK_URL: 'https://receiver.example/kyc/v2',
  KYC_DECISION_WEBHOOK_ALLOWED_HOSTS: 'receiver.example', KYC_DECISION_WEBHOOK_SECRET: 'a'.repeat(64) };
const payload = { schemaVersion: 2, eventId: 'test-event', eventType: 'performer.approved',
  occurredAt: '2026-09-28T00:00:00.000Z', performer: { id: 1, status: 'active', kycStatus: 'verified' }, owner: { firebaseUid: 'uid-test' } };
beforeEach(() => {
  jest.clearAllMocks();
  dns.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  axios.post.mockResolvedValue({ status: 204 });
});
describe('decision v2 sender (network mocked)', () => {
  test.each([
    { KYC_DECISION_WEBHOOK_SECRET: '' }, { KYC_DECISION_WEBHOOK_SECRET: 'short' },
    { KYC_DECISION_WEBHOOK_URL: 'http://receiver.example/kyc/v2' },
    { KYC_DECISION_WEBHOOK_URL: 'https://secret@receiver.example/kyc/v2' },
    { KYC_DECISION_WEBHOOK_URL: 'https://receiver.example/?token=secret' },
    { KYC_DECISION_WEBHOOK_URL: 'https://other.example/v2' },
    { KYC_DECISION_WEBHOOK_ALLOWED_HOSTS: '' }
  ])('fails closed for config %j', overrides => {
    expect(() => delivery.config({ ...settings, ...overrides })).toThrow();
  });
  test('signs exact bytes, passes event ID and disables proxy/redirects', async () => {
    expect((await delivery.send(payload, delivery.config(settings))).delivered).toBe(true);
    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe(settings.KYC_DECISION_WEBHOOK_URL);
    expect(body).toBe(JSON.stringify(payload));
    expect(options).toMatchObject({ maxRedirects: 0, proxy: false, timeout: 10000 });
    expect(options.headers['X-KYC-Delivery']).toBe(payload.eventId);
    const signature = 'sha256=' + crypto.createHmac('sha256', settings.KYC_DECISION_WEBHOOK_SECRET)
      .update(`${options.headers['X-KYC-Timestamp']}.${body}`).digest('hex');
    expect(options.headers['X-KYC-Signature']).toBe(signature);
    expect(Math.abs(Number(options.headers['X-KYC-Timestamp']) - Date.now()/1000)).toBeLessThan(2);
  });
  test.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1'])('blocks private/reserved address %s', address => {
    expect(delivery.publicIPv4(address)).toBe(false);
  });
  test('checks DNS before send, no DNS rebinding between check and connection', async () => {
    dns.lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    expect(await delivery.send(payload, delivery.config(settings))).toMatchObject({ delivered: false, permanent: true });
    expect(axios.post).not.toHaveBeenCalled();
    await delivery.send(payload, delivery.config(settings));
    const lookup = axios.post.mock.calls[0][2].httpsAgent.options.lookup;
    const cb = jest.fn();
    lookup('receiver.example', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  });
  test.each([[500,false], [429,false], [401,true], [302,true]])('HTTP %i permanent=%s', async (status, permanent) => {
    axios.post.mockResolvedValueOnce({ status });
    expect(await delivery.send(payload, delivery.config(settings))).toMatchObject({ delivered: false, permanent, error: `HTTP_${status}` });
  });
  test('never stores exception secrets', async () => {
    axios.post.mockRejectedValueOnce(new Error('private token and sensitive response'));
    expect(await delivery.send(payload, delivery.config(settings))).toEqual({ delivered: false, permanent: false, error: 'TRANSPORT_ERROR' });
  });
});

function fixture() {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const row = { id: payload.eventId, attempts: 0, status: 'pending', payload,
    update: jest.fn(async function(values, options) { expect(options.transaction).toBe(transaction); Object.assign(this, values); return this; }) };
  const model = {
    sequelize: { transaction: jest.fn(async fn => fn(transaction)) },
    findOne: jest.fn(async options => {
      expect(options.lock).toBe('UPDATE');
      expect(options.where.status).toBe('pending');
      expect(options.where[Op.or]).toHaveLength(2);
      return row;
    }),
    update: jest.fn(async (values, options) => {
      if (row.leaseToken !== options.where.leaseToken) return [0];
      Object.assign(row, values); return [1];
    })
  };
  return { row, model, models: { DecisionOutbox: model } };
}
describe('durable worker boundary (database mocked)', () => {
  test('transient failure retries same event identity, then marks sent', async () => {
    const { models, row } = fixture();
    const send = jest.fn().mockResolvedValueOnce({ delivered: false, error: 'HTTP_503' }).mockResolvedValueOnce({ delivered: true });
    await runOnce({ models, send });
    expect(row).toMatchObject({ status: 'pending', attempts: 1, lastError: 'HTTP_503', leaseToken: null });
    await runOnce({ models, send });
    expect(row).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(send.mock.calls[0][0].eventId).toBe(send.mock.calls[1][0].eventId);
  });
  test('permanent failure records failed, sanitizes arbitrary error', async () => {
    const { models, row } = fixture();
    await runOnce({ models, send: async () => ({ delivered: false, permanent: true, error: 'secret: x' }) });
    expect(row).toMatchObject({ status: 'failed', lastError: 'DELIVERY_ERROR' });
  });
  test('expired final-attempt lease is failed without another delivery', async () => {
    const { models, row } = fixture(); row.attempts = MAX_ATTEMPTS;
    const send = jest.fn(); await runOnce({ models, send });
    expect(send).not.toHaveBeenCalled(); expect(row.status).toBe('failed');
  });
  test('no eligible work does not send', async () => {
    const { models, model } = fixture(); model.findOne.mockResolvedValueOnce(null);
    const send = jest.fn(); expect(await runOnce({ models, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  test('stale worker cannot overwrite a newer lease', async () => {
    const { models, row } = fixture();
    // Real Sequelize instance is a snapshot, unlike fixture's shared row; capture
    // the fence in the update assertion and emulate another worker in the DB.
    models.DecisionOutbox.update.mockImplementationOnce(async (values, options) => {
      expect(options.where.leaseToken).toEqual(expect.any(String));
      return [0];
    });
    await runOnce({ models, send: async () => ({ delivered: true }) });
    expect(row.status).toBe('pending');
  });
});

test('review migration creates only decision/outbox tables and refuses destructive undo', async () => {
  const migration = require('../../migrations/20240101000015-create-review-decisions-outbox');
  const query = { createTable: jest.fn(async () => {}), addIndex: jest.fn(async () => {}) };
  await migration.up(query, require('sequelize'));
  expect(query.createTable.mock.calls.map(x => x[0])).toEqual(['performer_decisions', 'decision_outbox']);
  expect(query.createTable.mock.calls[1][1].id.primaryKey).toBe(true);
  await expect(migration.down()).rejects.toThrow('retained');
});

test('timeout remains retryable and operator log contains only event/status/safe summary',async()=>{
 const {models,row}=fixture();const onResult=jest.fn();
 axios.post.mockRejectedValueOnce(Object.assign(new Error('secret and private document path'),{code:'ECONNABORTED'}));
 await runOnce({models,send:p=>delivery.send(p,delivery.config(settings)),onResult});
 expect(row).toMatchObject({status:'pending',attempts:1,lastError:'TRANSPORT_ERROR'});
 expect(onResult).toHaveBeenCalledWith({eventId:payload.eventId,status:'pending',error:'TRANSPORT_ERROR'});
 expect(JSON.stringify(onResult.mock.calls)).not.toMatch(/secret|private|firebaseUid/);
});
test('active lease excludes another worker; expired lease is reclaimed and stale completion is fenced',async()=>{
 const {models,row,model}=fixture();let release,started;
 const gate=new Promise(r=>{release=r;}),start=new Promise(r=>{started=r;});const reports=[];
 model.findOne.mockImplementation(async options=>{
  const time=options.where.nextAttemptAt[Op.lte];
  return row.status==='pending' && (!row.leaseUntil || row.leaseUntil<=time) && (!row.nextAttemptAt || row.nextAttemptAt<=time) ? row : null;
 });
 const first=runOnce({models,send:async()=>{started();await gate;return {delivered:true};},onResult:r=>reports.push(r)});
 await start;
 try {
  const send=jest.fn();expect(await runOnce({models,send})).toBe(false);expect(send).not.toHaveBeenCalled();
  row.leaseUntil=new Date(0);row.nextAttemptAt=new Date(0);
  await runOnce({models,send:async()=>({delivered:false,permanent:true,error:'HTTP_400'})});
 } finally {release();await first;}
 expect(row).toMatchObject({status:'failed',attempts:2,lastError:'HTTP_400'});
 expect(reports).toEqual([{eventId:payload.eventId,status:'lease_lost',error:'STALE_LEASE'}]);
});
