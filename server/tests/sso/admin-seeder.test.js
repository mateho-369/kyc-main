/**
 * admin 昇格シードのテスト（MySQL 不要：モデルはモック）。
 *
 * 意図: `npm run seed` は以前は server/seeders/ 自体が存在せず何もできませんでした。
 * シードは (a) 未設定なら無害、(b) 既存ユーザーを昇格、(c) 居なければ作り、
 * (d) 何度実行しても同じ結果（冪等）。
 */

process.env.NODE_ENV = 'test';

const crypto = require('crypto');

const SEEDER = '../../seeders/20240101000001-promote-sso-admin';

const mockUserModel = (rows = []) => {
  const model = {
    rows,
    created: [],
    User: {
      findOne: jest.fn(async ({ where }) => rows.find((r) => r.email === where.email) || null),
      create: jest.fn(async (values) => {
        const row = { id: rows.length + 100, ...values, update: async function update(v) { Object.assign(this, v); return this; } };
        model.created.push(row);
        rows.push(row);
        return row;
      })
    }
  };
  return model;
};

const loadSeederWith = (model) => {
  jest.resetModules();
  jest.doMock('../../models', () => ({ User: model.User, sequelize: {} }));
  // eslint-disable-next-line global-require
  return require(SEEDER);
};

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.dontMock('../../models');
  jest.resetModules();
});

describe('seed: promote-sso-admin', () => {
  it('does nothing when SEED_ADMIN_EMAIL is not configured', async () => {
    delete process.env.SEED_ADMIN_EMAIL;
    const model = mockUserModel();
    const seeder = loadSeederWith(model);

    await expect(seeder.up()).resolves.toBeUndefined();

    expect(model.User.findOne).not.toHaveBeenCalled();
    expect(model.User.create).not.toHaveBeenCalled();
  });

  it('treats a value without @ as unconfigured (no accidental admin row)', async () => {
    process.env.SEED_ADMIN_EMAIL = 'makara';
    const model = mockUserModel();
    const seeder = loadSeederWith(model);

    await seeder.up();

    expect(model.User.findOne).not.toHaveBeenCalled();
  });

  it('promotes an existing SSO user to admin', async () => {
    process.env.SEED_ADMIN_EMAIL = 'makara@gmail.com';
    const makara = { id: 7, email: 'makara@gmail.com', role: 'user', name: 'makara', update: jest.fn(async function update(v) { Object.assign(this, v); return this; }) };
    const model = mockUserModel([makara]);
    const seeder = loadSeederWith(model);

    await seeder.up();

    expect(model.User.findOne).toHaveBeenCalledWith({ where: { email: 'makara@gmail.com' } });
    expect(makara.update).toHaveBeenCalledWith({ role: 'admin' });
    expect(makara.role).toBe('admin');
    expect(model.User.create).not.toHaveBeenCalled();
  });

  it('is idempotent: a second run changes nothing', async () => {
    process.env.SEED_ADMIN_EMAIL = 'makara@gmail.com';
    const makara = { id: 7, email: 'makara@gmail.com', role: 'admin', update: jest.fn(async () => makara) };
    const model = mockUserModel([makara]);
    const seeder = loadSeederWith(model);

    await seeder.up();
    await seeder.up();

    expect(makara.update).not.toHaveBeenCalled();
  });

  it('matches the email case-insensitively (Sharegram emails vary)', async () => {
    process.env.SEED_ADMIN_EMAIL = '  Makara@Gmail.COM ';
    const makara = { id: 7, email: 'makara@gmail.com', role: 'user', update: jest.fn(async function u(v) { Object.assign(this, v); return this; }) };
    const model = mockUserModel([makara]);
    const seeder = loadSeederWith(model);

    await seeder.up();

    expect(model.User.findOne).toHaveBeenCalledWith({ where: { email: 'makara@gmail.com' } });
    expect(makara.role).toBe('admin');
  });

  it('creates the admin when nobody has SSO-d yet, with an unguessable password', async () => {
    process.env.SEED_ADMIN_EMAIL = 'hana@gmail.com';
    const model = mockUserModel([]);
    const seeder = loadSeederWith(model);

    await seeder.up();

    expect(model.User.create).toHaveBeenCalledTimes(1);
    const values = model.User.create.mock.calls[0][0];
    expect(values.email).toBe('hana@gmail.com');
    expect(values.role).toBe('admin');
    expect(values.authProvider).toBe('firebase');
    expect(values.emailVerified).toBe(true);
    // 32バイト = 64hex。メールアドレス由来などの推測しやすい値ではないこと
    expect(values.password).toHaveLength(64);
    expect(values.password).not.toContain('hana');
    expect(crypto.createHash('sha256').update(values.password).digest('hex')).toHaveLength(64);
  });

  it('honours SEED_ADMIN_ROLE for non-admin seeding', async () => {
    process.env.SEED_ADMIN_EMAIL = 'auditor@gmail.com';
    process.env.SEED_ADMIN_ROLE = 'user';
    const model = mockUserModel([]);
    const seeder = loadSeederWith(model);

    await seeder.up();

    expect(model.User.create.mock.calls[0][0].role).toBe('user');
  });

  it('down() demotes instead of deleting the row', async () => {
    process.env.SEED_ADMIN_EMAIL = 'makara@gmail.com';
    const makara = { id: 7, email: 'makara@gmail.com', role: 'admin', update: jest.fn(async function u(v) { Object.assign(this, v); return this; }) };
    const model = mockUserModel([makara]);
    const seeder = loadSeederWith(model);

    await seeder.down();

    expect(makara.role).toBe('user');
    expect(model.rows).toHaveLength(1); // 削除していない
  });

  it('down() refuses to touch a role this seed did not create', async () => {
    process.env.SEED_ADMIN_EMAIL = 'makara@gmail.com';
    const makara = { id: 7, email: 'makara@gmail.com', role: 'super_admin', update: jest.fn(async () => makara) };
    const model = mockUserModel([makara]);
    const seeder = loadSeederWith(model);

    await seeder.down();

    expect(makara.update).not.toHaveBeenCalled();
  });
});
