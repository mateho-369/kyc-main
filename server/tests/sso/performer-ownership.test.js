process.env.NODE_ENV = 'test';
const fs = require('fs');
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
jest.mock('../../middleware/hybrid-auth', () => (req, res, next) => {
  if (req.get('x-test-user') === 'uid-a') {
    req.user = { id: 11, role: 'user', firebaseUid: 'uid-a', sharegramUserId: null };
    return next();
  }
  req.sharegramAuth = { userId: 1 };
  req.user = { id: null, role: 'admin' };
  return next();
});
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
    const byExternalId=await request(app).get('/api/performers?external_ids=b'); expect(byExternalId.status).toBe(400);
    const s=await request(app).get('/api/sharegram/performers'); expect(s.status).toBe(400); expect(JSON.stringify(s.body)).not.toContain('sg-b');
  });
  test('object reads enforce Firebase UID ownership for shared callers', async () => {
    const denied = await request(app).get('/api/performers/2?firebase_uid=uid-a');
    expect(denied.status).toBe(403);
    const allowed = await request(app).get('/api/performers/2?firebase_uid=uid-b');
    expect(allowed.status).toBe(200);
  });
  test('object reads enforce owner scope and accept numeric-string IDs', async () => {
    const denied = await request(app).get('/api/performers/2?user_id=sg-a');
    expect(denied.status).toBe(403);
    const updateDenied = await request(app).put('/api/performers/2?user_id=sg-a').field('lastName', 'changed');
    expect(updateDenied.status).toBe(403);
    const allowed = await request(app).get('/api/performers/01?user_id=sg-a');
    expect(allowed.status).toBe(200);
  });
  test('Sharegram can scope the original flow by Firebase UID', async () => {
    const r = await request(app).get('/api/sharegram/performers?firebase_uid=uid-b');
    expect(r.status).toBe(200);
    expect(r.body.data.map(x => x.id)).toEqual([2]);
  });
  test('Sharegram user_id scopes to its account and external_ids cannot bypass owner scope', async () => {
    const r=await request(app).get('/api/sharegram/performers?user_id=sg-b'); expect(r.status).toBe(200); expect(r.body.data.map(x=>x.id)).toEqual([2]);
    const e=await request(app).get('/api/sharegram/performers?external_ids=b'); expect(e.status).toBe(400); expect(e.body.data).toBeUndefined();
  });
  test('service callers cannot create an ownerless performer or upload files', async () => {
    const models = require('../../models');
    const response = await request(app).post('/api/performers');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('PERFORMER_USER_REQUIRED');
    expect(models.Performer.create).not.toHaveBeenCalled();
  });
  test('authenticated KYC user can create a safely owned performer without Sharegram claim', async () => {
    const models = require('../../models');
    const previousFindByPk = models.User.findByPk.getMockImplementation();
    models.User.findByPk.mockResolvedValue({ id: 11, sharegramUserId: null });
    models.Performer.create.mockImplementation(async data => ({ id: 99, ...data }));

    const response = await request(app)
      .post('/api/performers')
      .set('x-test-user', 'uid-a')
      .field('lastName', 'KYC')
      .field('firstName', 'Creator')
      .field('lastNameRoman', 'KYC')
      .field('firstNameRoman', 'Creator')
      .attach('agreementFile', Buffer.from('agreement'), { filename: 'agreement.pdf', contentType: 'application/pdf' })
      .attach('idFront', Buffer.from('identity'), { filename: 'identity.jpg', contentType: 'image/jpeg' })
      .attach('selfie', Buffer.from('selfie'), { filename: 'selfie.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(models.Performer.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 11,
      sharegramUserId: null
    }));
    const documents = response.body.data.documents;
    for (const document of Object.values(documents)) {
      if (document?.path && fs.existsSync(document.path)) fs.unlinkSync(document.path);
    }
    models.User.findByPk.mockImplementation(previousFindByPk);
  });
});
