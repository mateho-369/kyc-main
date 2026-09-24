/**
 * テスト用アカウント作成シード（0001-seed-accounts）のテスト。MySQL 不要。
 *
 * 守りたい物:
 *  (a) `npm run migrate && npm run seed` で user@example.com / admin@example.com が
 *      作り直される（2回目は何もしない）
 *  (b) 本番で誤実行すると**音を立てて失敗**する（弱いパスワードを許す代わりにする約束）
 *  (c) 既存行のパスワードを絶対に上書きしない
 *  (d) role は ENUM('admin','user') 以外は MySQL に到達する前に拒否
 *  (e) ダミー身元（昔の "Test User"）に見間違える形で作らない
 */

process.env.NODE_ENV = 'test';

const SEEDER = '../../seeders/20240101000001-seed-accounts';

const makeModel = (rows = []) => {
  const model = {
    rows,
    User: {
      findOne: jest.fn(async ({ where }) => rows.find((r) => r.email === where.email) || null),
      create: jest.fn(async (values) => {
        const row = {
          id: rows.length + 1,
          ...values,
          update: async function update(v) { Object.assign(this, v); return this; },
          destroy: jest.fn(async () => {
            const i = model.rows.indexOf(row);
            if (i >= 0) model.rows.splice(i, 1);
          })
        };
        rows.push(row);
        return row;
      })
    }
  };
  return model;
};

const load = (model) => {
  jest.resetModules();
  jest.doMock('../../models', () => ({ User: model.User, sequelize: {} }));
  // eslint-disable-next-line global-require
  return require(SEEDER);
};

const SEED_ENV_KEYS = [
  'SEED_ALLOW_INSECURE', 'DISABLE_DB', 'SEED_UNDO_DELETE',
  'SEED_USER_EMAIL', 'SEED_USER_PASSWORD', 'SEED_USER_NAME', 'SEED_USER_ROLE',
  'SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_ADMIN_NAME', 'SEED_ADMIN_ROLE'
];

const originalEnv = { ...process.env };
let log;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  SEED_ENV_KEYS.forEach((k) => delete process.env[k]);
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  process.env = { ...originalEnv };
  jest.dontMock('../../models');
  jest.resetModules();
});

const created = (model) => model.User.create.mock.calls.map((c) => c[0]);

describe('seed: accounts', () => {
  it('creates the normal user and the admin the app expects', async () => {
    const model = makeModel();
    await load(model).up();

    expect(created(model).map((r) => r.email)).toEqual(['user@example.com', 'admin@example.com']);
    const [user, admin] = created(model);

    expect(user).toMatchObject({
      email: 'user@example.com',
      password: 'user123',
      name: 'user',
      role: 'user',
      authProvider: 'jwt',
      emailVerified: true,
      isActive: true
    });
    expect(admin).toMatchObject({ email: 'admin@example.com', password: 'admin123', role: 'admin' });
    // 平文で渡す（ハッシュはモデルの beforeCreate）。ここでhashすると二重になる。
    expect(user.password).not.toMatch(/^\$2[aby]\$/);
  });

  it('never re-creates the old placeholder identity', async () => {
    const model = makeModel();
    await load(model).up();

    expect(created(model).map((r) => r.name)).not.toContain('Test User');
    expect(created(model).map((r) => r.email)).not.toContain('test@example.com');
  });

  it('refuses to run in production and does not touch the database', async () => {
    process.env.NODE_ENV = 'production';
    const model = makeModel();

    await expect(load(model).up()).rejects.toThrow(/SEED_ALLOW_INSECURE/);
    expect(model.User.findOne).not.toHaveBeenCalled();
    expect(model.User.create).not.toHaveBeenCalled();
  });

  it('runs in production only when the operator insists', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SEED_ALLOW_INSECURE = 'true';
    const model = makeModel();

    await load(model).up();

    expect(model.User.create).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when DISABLE_DB=true', async () => {
    process.env.DISABLE_DB = 'true';
    const model = makeModel();

    await load(model).up();

    expect(model.User.create).not.toHaveBeenCalled();
  });

  it('never overwrites an existing password, only aligns the role', async () => {
    const existing = {
      id: 1,
      email: 'user@example.com',
      role: 'admin',
      password: '$2a$10$someone-else-set-this',
      update: jest.fn(async function update(v) { Object.assign(this, v); return this; })
    };
    const model = makeModel([existing]);

    await load(model).up();

    expect(created(model).map((r) => r.email)).toEqual(['admin@example.com']);
    expect(existing.update).toHaveBeenCalledWith({ role: 'user' });
    expect(existing.password).toBe('$2a$10$someone-else-set-this');
  });

  it('is idempotent: the second run creates and updates nothing', async () => {
    const rows = ['user@example.com', 'admin@example.com'].map((email, i) => ({
      id: i + 1,
      email,
      role: email.startsWith('admin') ? 'admin' : 'user',
      update: jest.fn(async function update(v) { Object.assign(this, v); return this; })
    }));
    rows.forEach((r) => { r.update.mockClear(); });
    const model = makeModel(rows);
    const seeder = load(model);

    await seeder.up();
    await seeder.up();

    expect(model.User.create).not.toHaveBeenCalled();
    rows.forEach((row) => expect(row.update).not.toHaveBeenCalled());
  });

  it('accepts the 7-char user123 but refuses anything under 6', async () => {
    process.env.SEED_USER_PASSWORD = 'user123';
    const ok = makeModel();
    await load(ok).up();
    expect(created(ok).map((r) => r.password)).toContain('user123');

    process.env.SEED_ADMIN_PASSWORD = 'abcde';
    const model = makeModel();
    await expect(load(model).up()).rejects.toThrow(/6 文字以上/);
    expect(model.User.create).not.toHaveBeenCalled();
  });

  it('rejects a role outside the ENUM before MySQL can truncate it', async () => {
    process.env.SEED_ADMIN_ROLE = 'superadmin';
    const model = makeModel();

    await expect(load(model).up()).rejects.toThrow(/Users\.role/);
    expect(model.User.create).not.toHaveBeenCalled();
  });

  it('honours custom emails, normalises case, and keeps a custom secret out of the log', async () => {
    process.env.SEED_USER_EMAIL = 'Kyoko@Example.com';
    process.env.SEED_USER_PASSWORD = 'my-own-secret';
    const model = makeModel();

    await load(model).up();

    expect(created(model).map((r) => r.email)).toContain('kyoko@example.com');
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).not.toContain('my-own-secret');
    expect(printed).toContain('SEED_*_PASSWORD で設定した値');
  });

  it('skips an account whose email is not a valid address', async () => {
    process.env.SEED_USER_EMAIL = 'nope';
    const model = makeModel();

    await load(model).up();

    expect(created(model).map((r) => r.email)).toEqual(['admin@example.com']);
  });

  describe('down()', () => {
    it('only reports what could be deleted until SEED_UNDO_DELETE is set', async () => {
      const row = { id: 1, email: 'user@example.com', role: 'user', destroy: jest.fn(async () => true) };
      const model = makeModel([row]);

      await load(model).down();

      expect(row.destroy).not.toHaveBeenCalled();
      expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/SEED_UNDO_DELETE=true/);
    });

    it('deletes the seeded rows once armed', async () => {
      process.env.SEED_UNDO_DELETE = 'true';
      const rows = [
        { id: 1, email: 'user@example.com', role: 'user' },
        { id: 2, email: 'admin@example.com', role: 'admin' }
      ].map((r) => ({ ...r, destroy: jest.fn(async () => true) }));
      const model = makeModel(rows);

      await load(model).down();

      rows.forEach((r) => expect(r.destroy).toHaveBeenCalledTimes(1));
    });

    it('never deletes a row that has been linked to Sharegram SSO', async () => {
      process.env.SEED_UNDO_DELETE = 'true';
      const row = {
        id: 3,
        email: 'admin@example.com',
        role: 'admin',
        firebaseUid: 'bTN7Cc1Hk06UwldQi6H5DFcEdIs7',
        destroy: jest.fn(async () => true)
      };
      const model = makeModel([row]);

      await load(model).down();

      expect(row.destroy).not.toHaveBeenCalled();
    });

    it('refuses in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SEED_UNDO_DELETE = 'true';
      const row = { id: 4, email: 'user@example.com', role: 'user', destroy: jest.fn(async () => true) };
      const model = makeModel([row]);

      await expect(load(model).down()).rejects.toThrow(/production/);
      expect(row.destroy).not.toHaveBeenCalled();
    });
  });
});
