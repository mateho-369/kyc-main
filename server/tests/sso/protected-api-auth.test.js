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
