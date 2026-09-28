// Real middleware/signatures; database and audit persistence mocked. No Firebase.
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const mockSecret = 'unit-only-hmac-secret-000000000000000';
const mockKey = 'unit-only-integration-key';
jest.mock('../../models', () => ({
  SharegramIntegration: { findOne: jest.fn(async () => ({ id: 'integration', userId: 7, configuration: { apiKey: mockKey, secretKey: mockSecret } })) },
  ApiLog: { create: jest.fn(async () => ({})) }
}));
const models = require('../../models');
const { sharegramAuth } = require('../../middleware/sharegram-auth');
const app = express(); app.use(express.json());
app.post('/signed', sharegramAuth, (req,res)=>res.json({ id:req.sharegramAuth.userId }));
function headers(body, overrides={}) {
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=crypto.createHmac('sha256',mockSecret).update(`POST\n/signed\n${timestamp}\n${JSON.stringify(body)}`).digest('hex');
  return {'X-Sharegram-API-Key':mockKey,'X-Sharegram-Integration-ID':'integration','X-Sharegram-Timestamp':timestamp,'X-Sharegram-Signature':signature,'X-API-Client':'sharegram',...overrides};
}
beforeEach(()=>jest.clearAllMocks());
test('valid real HMAC reaches handler (regression: block-scoped integration variable)', async()=>{
  expect((await request(app).post('/signed').set(headers({})).send({})).status).toBe(200);
});
test.each(['bad','NaN','1',String(Math.floor(Date.now()/1000)-1000),String(Math.floor(Date.now()/1000)+1000)])('invalid/stale timestamp %s fails closed', async timestamp=>{
  expect((await request(app).post('/signed').set(headers({}, {'X-Sharegram-Timestamp':timestamp})).send({})).status).toBe(401);
});
test.each(['x','0'.repeat(64),'g'.repeat(64)])('invalid signature %s fails closed without 500',async signature=>{
  expect((await request(app).post('/signed').set(headers({}, {'X-Sharegram-Signature':signature})).send({})).status).toBe(401);
});
test('tampered body and missing credentials rejected',async()=>{
  expect((await request(app).post('/signed').set(headers({a:1})).send({a:2})).status).toBe(401);
  expect((await request(app).post('/signed').send({})).status).toBe(401);
});
test('known legacy test key is not an authentication bypass',async()=>{
  expect((await request(app).post('/signed').set('Authorization','Bearer sharegram-api-key-test-2025').send({})).status).toBe(401);
});
test.each([undefined,'','short'])('missing/weak signing secret rejected',async secretKey=>{
  models.SharegramIntegration.findOne.mockResolvedValueOnce({id:'integration',configuration:{apiKey:mockKey,secretKey}});
  expect((await request(app).post('/signed').set(headers({})).send({})).status).toBe(401);
});
test('audit does not store submitted tokens or KYC payloads',async()=>{
  const body={idToken:'sensitive-token',documents:'sensitive-document'};
  await request(app).post('/signed').set(headers(body)).send(body);
  expect(JSON.stringify(models.ApiLog.create.mock.calls)).not.toMatch(/sensitive-token|sensitive-document/);
});

test('owner query parameters cannot be changed without resigning',async()=>{
  expect((await request(app).post('/signed?firebase_uid=other-owner').set(headers({})).send({})).status).toBe(401);
});
