process.env.NODE_ENV = 'test';
const express = require('express');
const request = require('supertest');
const mockRows = [
  { id: 1, external_id: 'a', userId: 11, sharegramUserId: 'sg-a', status: 'active' },
  { id: 2, external_id: 'b', userId: 22, sharegramUserId: 'sg-b', status: 'active' }
];
const mockSelectRows = where => mockRows.filter(row => {
  if (where.status && row.status !== where.status) return false;
  if (where.userId != null && row.userId != where.userId) return false;
  if (where.sharegramUserId != null && row.sharegramUserId != where.sharegramUserId) return false;
  if (where.external_id && !where.external_id[require('sequelize').Op.in].includes(row.external_id)) return false;
  return true;
});
jest.mock('../../models', () => ({
  Performer: { findAndCountAll: jest.fn(async ({ where }) => { const result = mockSelectRows(where); return { count: result.length, rows: result }; }), count: jest.fn(async ({where}) => mockSelectRows(where).length), findAll: jest.fn(async ({where}) => mockRows.filter(r => Object.entries(where).every(([k,v]) => r[k] == v))), findByPk: jest.fn(async id => mockRows.find(r => r.id === Number(id))), create: jest.fn(), update: jest.fn() },
  User: { findOne: jest.fn(async ({where}) => where.firebaseUid === 'uid-a' ? {id:11} : where.firebaseUid === 'uid-b' ? {id:22} : null), findByPk: jest.fn(async id => ({id, sharegramUserId:'sg-a'})) },
  AuditLog: { create: jest.fn(async () => ({})) }
}));
jest.mock('../../middleware/hybrid-auth', () => (req, res, next) => { req.sharegramAuth = {userId: 1}; req.user = {id:null, role:'admin'}; next(); });
jest.mock('../../middleware/sharegram-auth', () => ({sharegramAuth:(req,res,next)=>{req.sharegramAuth={userId:1};next();}}));
jest.mock('../../services/sharegram/sharegramWebhook', () => ({notifySharegram:jest.fn()}));
const app = express();
app.use(express.json());
app.use('/api/performers', require('../../routes/performers'));
app.use('/api/sharegram/performers', require('../../routes/sharegram-performers'));
describe('performer owner scoping', () => {
  test('Firebase UID scopes /api/performers to its owner', async () => {
    const r=await request(app).get('/api/performers?user_id=uid-a'); expect(r.status).toBe(200); expect(r.body.data.map(x=>x.id)).toEqual([1]);
  });
  test('explicit firebase_uid alias resolves only through Firebase UID', async () => {
    const r = await request(app).get('/api/performers?firebase_uid=uid-b');
    expect(r.status).toBe(200);
    expect(r.body.data.map(x => x.id)).toEqual([2]);
  });
  test('missing owner scope fails closed without leaking rows', async () => {
    const r=await request(app).get('/api/performers'); expect(r.status).toBe(400); expect(JSON.stringify(r.body)).not.toContain('sg-b');
    const s=await request(app).get('/api/sharegram/performers'); expect(s.status).toBe(400); expect(JSON.stringify(s.body)).not.toContain('sg-b');
  });
  test('object reads enforce owner scope and accept numeric-string IDs', async () => {
    const denied = await request(app).get('/api/performers/2?user_id=sg-a');
    expect(denied.status).toBe(403);
    const updateDenied = await request(app).put('/api/performers/2?user_id=sg-a').field('lastName', 'changed');
    expect(updateDenied.status).toBe(403);
    const allowed = await request(app).get('/api/performers/01?user_id=sg-a');
    expect(allowed.status).toBe(200);
  });
  test('Sharegram user_id scopes to its account and external_ids remains usable', async () => {
    const r=await request(app).get('/api/sharegram/performers?user_id=sg-b'); expect(r.status).toBe(200); expect(r.body.data.map(x=>x.id)).toEqual([2]);
    const e=await request(app).get('/api/sharegram/performers?external_ids=b'); expect(e.status).toBe(200); expect(e.body.data.map(x=>x.id)).toEqual([2]);
  });
});
