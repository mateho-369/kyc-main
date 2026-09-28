/**
 * 保護APIのトークン解決（Authorization → Cookie → リフレッシュ）テスト。
 *
 * 実際の障害（画面のコンソールログ）:
 *   GET /api/auth/me          → 200
 *   GET /api/dashboard/stats  → 401
 *   GET /api/performers       → 401
 * 同じセッションなのに「ログイン済み」と「未認証」が同時に起きていた。
 * 原因は middleware/auth.js が Authorization ヘッダーしか見ず、
 * middleware/auth-enhanced.js（/auth/me が使用）は Cookie も見ていたこと。
 *
 * ここでは本物の 2 つのミドルウェアと本物の tokenService を、
 * MySQL と Redis だけモックして検証する（npm run test:sso で実行）。
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
delete process.env.ENABLE_REDIS;
delete process.env.DISABLE_DB;

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

const mockUserRow = {
  id: 7,
  email: 'hana@gmail.com',
  name: 'Hana',
  role: 'admin',
  isActive: true,
  isLocked: false,
  firebaseUid: 'uid-hana-0007',
  sharegramUserId: '12046'
};

jest.mock('firebase-admin', () => ({ apps: [{}], auth: () => ({ getUser: async () => ({ disabled: false }) }) }));

jest.mock('../../models', () => ({
  User: {
    findByPk: jest.fn(async (id) => (Number(id) === mockUserRowId ? { ...mockUserRow } : null))
  },
  ApiLog: { create: jest.fn(async () => ({})) }
}));

// 上の jest.mock ファクトリから参照するため、モック定義より前に置く必要がある。
// eslint-disable-next-line no-var
var mockUserRowId = mockUserRow.id;

jest.mock('../../utils/logger/auditLogger', () => ({
  auditLogger: { log: jest.fn(async () => {}) },
  AuditActions: {}
}));

// Redis はこの契約に含まれない（SSOテストと同じ扱い）
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
  on: jest.fn(),
  connect: jest.fn(async () => {}),
  get: jest.fn(async () => null),
  set: jest.fn(async () => 'OK'),
  setex: jest.fn(async () => 'OK'),
  del: jest.fn(async () => 1),
  quit: jest.fn(async () => {}),
  status: 'ready'
})));

const tokenService = require('../../services/tokenService');
const authRequired = require('../../middleware/auth');
const authEnhanced = require('../../middleware/auth-enhanced');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // SSOフローの /sso → /performers/add の後に叩かれる想定の保護API
  app.get('/api/dashboard/stats', authRequired, (req, res) => {
    res.json({ success: true, authSource: req.authSource, userId: req.user.id });
  });

  // /api/auth/me（Cookie も見ていた側）
  app.get('/api/auth/me', authEnhanced, (req, res) => {
    res.json({ success: true, email: req.user.email });
  });

  return app;
};

let accessToken;
let refreshToken;

beforeAll(async () => {
  accessToken = await tokenService.generateAccessToken(mockUserRow, { sso: true, provider: 'firebase' });
  refreshToken = await tokenService.generateRefreshToken(mockUserRow, { sso: true, provider: 'firebase' });
});

const app = buildApp();

const cookieHeader = (cookies) => cookies.map((c) => c.split(';')[0]).join('; ');

describe('保護APIのトークン解決（Cookieセッションの 401 をなくす）', () => {
  it('rejects a request with no credentials', async () => {
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(401);
  });

  it('accepts an Authorization: Bearer token (the usual frontend path)', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.authSource).toBe('header');
  });

  it('accepts the httpOnly accessToken cookie (regression: 200 on /auth/me but 401 here)', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Cookie', `accessToken=${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.authSource).toBe('cookie');
  });

  it('keeps both middlewares in agreement for a cookie-only session', async () => {
    const cookie = `accessToken=${accessToken}`;
    const [me, stats] = await Promise.all([
      request(app).get('/api/auth/me').set('Cookie', cookie),
      request(app).get('/api/dashboard/stats').set('Cookie', cookie)
    ]);

    expect(me.status).toBe(200);
    expect(stats.status).toBe(200);
  });

  it('exchanges the refreshToken cookie for a fresh access token and re-sets the cookies', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Cookie', `refreshToken=${refreshToken}`);

    expect(res.status).toBe(200);
    expect(res.body.authSource).toBe('refreshed');

    const setCookie = res.headers['set-cookie'] || [];
    expect(cookieHeader(setCookie)).toMatch(/accessToken=/);
    expect(cookieHeader(setCookie)).toMatch(/refreshToken=/);
  });

  it('still rejects an invalid access token', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', 'Bearer not-a-real-jwt');

    expect(res.status).toBe(401);
  });

  it('prefers the Authorization header over cookies (so an explicit token wins)', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', 'accessToken=stale-or-invalid');

    expect(res.status).toBe(200);
    expect(res.body.authSource).toBe('header');
  });
});


describe('strict local JWT verification (real crypto; DB mocked)', () => {
  const jwt=require('jsonwebtoken');
  const service=require('../../services/tokenService');
  const claims={type:'access',jti:'unit-test-id',user:{id:7},exp:Math.floor(Date.now()/1000)+600};
  const opts={issuer:'safevideo-kyc',audience:'safevideo-app',algorithm:'HS256'};
  test.each([{issuer:'wrong'},{audience:'wrong'},{algorithm:'HS384'}])('rejects mismatched JWT properties %j',async overrides=>{
    await expect(service.verifyToken(jwt.sign(claims,process.env.JWT_SECRET,{...opts,...overrides}))).rejects.toThrow();
  });
  test('requires expiration and rejects expired and forged signatures',async()=>{
    const {exp,...withoutExp}=claims;
    await expect(service.verifyToken(jwt.sign(withoutExp,process.env.JWT_SECRET,opts))).rejects.toThrow();
    await expect(service.verifyToken(jwt.sign({...claims,exp:1},process.env.JWT_SECRET,opts))).rejects.toThrow();
    await expect(service.verifyToken(jwt.sign(claims,'other-secret',opts))).rejects.toThrow();
  });
  test('does not refresh disabled local users',async()=>{
    const token=await service.generateRefreshToken(mockUserRow);
    const User=require('../../models').User;User.findByPk.mockResolvedValueOnce({...mockUserRow,isActive:false});
    await expect(service.refreshTokens(token)).rejects.toThrow('Account unavailable');
  });
});


test('stored DB role, not the JWT role field, controls reviewer authorization',async()=>{
  const token=await tokenService.generateAccessToken({...mockUserRow,role:'admin'});
  require('../../models').User.findByPk.mockResolvedValueOnce({...mockUserRow,role:'user'});
  const app=express();app.get('/review',authRequired,require('../../middleware/requireReviewer'),(req,res)=>res.sendStatus(200));
  expect((await request(app).get('/review').set('Authorization',`Bearer ${token}`)).status).toBe(403);
});

describe('restored cookie protection vs original upload',()=>{
 test('automatic refresh restores Strict cookies from original auth-enhanced',async()=>{
  const r=await request(buildApp()).get('/api/auth/me').set('Cookie',`refreshToken=${refreshToken}`);
  expect(r.status).toBe(200);expect(r.headers['set-cookie'].filter(c=>/^(accessToken|refreshToken)=/.test(c)).every(c=>c.includes('SameSite=Strict'))).toBe(true);
 });
 test('new cookie-auth writes reject ambient cross-origin credentials; explicit bearer still works',async()=>{
  const app=express();app.use(cookieParser());app.post('/write',authRequired,(req,res)=>res.sendStatus(200));
  for(const origin of [undefined,'null','https://attacker.invalid','https://sub.kyc.example']){
   let r=request(app).post('/write').set('Host','kyc.example').set('Cookie',`accessToken=${accessToken}`);if(origin)r=r.set('Origin',origin);expect((await r).status).toBe(403);
  }
  expect((await request(app).post('/write').set('Host','kyc.example').set('Origin','https://kyc.example').set('Cookie',`accessToken=${accessToken}`)).status).toBe(200);
  expect((await request(app).post('/write').set('Authorization',`Bearer ${accessToken}`)).status).toBe(200);
 });
});

test.each([[{isActive:false},403],[{isLocked:true},423],[null,401]])('current database principal state gates authentication: %j',async(change,status)=>{
 require('../../models').User.findByPk.mockResolvedValueOnce(change ? {...mockUserRow,...change} : null);
 expect((await request(buildApp()).get('/api/dashboard/stats').set('Authorization',`Bearer ${accessToken}`)).status).toBe(status);
});

test('cookie mutation guard enforces production HTTPS and rejects cross-site browser signals',()=>{
 const guard=require('../../middleware/cookieMutationGuard');const previous=process.env.NODE_ENV;
 const req=(origin,site)=>({method:'POST',get:name=>({'origin':origin,'host':'kyc.example','sec-fetch-site':site})[name]});
 try {
  process.env.NODE_ENV='production';
  expect(()=>guard(req('http://kyc.example'))).toThrow();
  expect(()=>guard(req('https://kyc.example','cross-site'))).toThrow();
  expect(()=>guard(req('https://kyc.example','same-origin'))).not.toThrow();
 } finally {if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
