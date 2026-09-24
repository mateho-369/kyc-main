/**
 * 「検証に失敗したとき、誰かの身元でログインしてしまう」ことを防ぐ回帰テスト。
 *
 * 背景: Sharegram SSO が失敗したとき、ダッシュボードは常に
 * { id: 2, name: 'Test User', email: 'test@example.com' } を表示していた。
 * 原因は「失敗時のダミー身元」が至る所に埋め込まれていたこと。
 * ここでは、その種別を網羅的に封じる。
 */

const FORBIDDEN = ['test@example.com', 'Test User', 'mock@example.com', 'Mock User'];

const assertNoFakeIdentity = (payload, label) => {
  const body = JSON.stringify(payload ?? null);
  FORBIDDEN.forEach((needle) => {
    expect({ [label]: body }).not.toEqual(
      expect.objectContaining({ [label]: expect.stringContaining(needle) })
    );
  });
};

describe('開発用ダミーモードが偽の身元を返さない', () => {
  const originalDisableDb = process.env.DISABLE_DB;

  afterEach(() => {
    if (originalDisableDb === undefined) delete process.env.DISABLE_DB;
    else process.env.DISABLE_DB = originalDisableDb;
    jest.resetModules();
  });

  it('DISABLE_DB=true でも test@example.com のユーザーは出てこない', async () => {
    process.env.DISABLE_DB = 'true';

    let User;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      User = require('../../models/User');
    });

    // 以前のこのモデルは findOne({where:{email:'test@example.com'}}) で
    // { id: 1, name: 'Test User' } を返していた → SSOが「成功」に見えていた
    await expect(User.findOne({ where: { email: 'test@example.com' } })).resolves.toBeNull();
    await expect(User.findOne({ where: { email: 'hana@gmail.com' } })).resolves.toBeNull();
    await expect(User.findAll()).resolves.toEqual([]);

    // 永続化できないなら失敗させる（成功したふりをしない）
    await expect(User.create({ email: 'hana@gmail.com' })).rejects.toThrow(/DATABASE_DISABLED/);
    await expect(User.update({ name: 'x' }, { where: { id: 1 } })).rejects.toThrow(/DATABASE_DISABLED/);
  });
});

describe('/api/auth/custom-token がFirebase未設定時に正直に失敗する', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('Admin SDK が初期化できないときは mock 身元ではなく 503 を返す', async () => {
    process.env.NODE_ENV = 'test';
    const request = require('supertest');
    const express = require('express');

    // config/firebase-admin を「throw する」状態にして、ルーター側の
    // フォールバック経路を通す（旧実装ではここで mock 身元を返していた）
    jest.doMock('../../config/firebase-admin', () => {
      throw new Error('Missing required environment variables: FIREBASE_PRIVATE_KEY');
    });

    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../../routes/auth-custom-token-simple'));

    const res = await request(app)
      .post('/api/auth/custom-token')
      .set('Authorization', 'Bearer sharegram-api-key-test-2025')
      .send({ idToken: 'a.b.c' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FIREBASE_NOT_CONFIGURED');
    assertNoFakeIdentity(res.body, 'custom-token:unconfigured');
  });
});
