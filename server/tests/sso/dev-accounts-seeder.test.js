/**
 * 開発用アカウント作成シード（0001-seed-dev-accounts）のテスト。MySQL 不要。
 *
 * 守りたい物:
 *  (a) `npm run migrate && npm run seed` で一般ユーザーと管理者が1人ずつ増う
 *  (b) 本番で誤実行すると**音を立てて失敗**する
 *  (c) 既存行のパスワードを絶対に上書きしない
 *  (d)ENUM 外の role を指定したら MySQL に到達する前に拒否する
 *  (e) 作られる行は「ダミーの Test User」に見えてはいけない（過去の実障害）
 */

process.env.NODE_ENV = 'test';

const SEEDER = '../../seeders/20240101000001-seed-dev-accounts';

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

const originalEnv = { ...process.env };
let log;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.SEED_ALLOW_INSECURE;
  delete process.env.DISABLE_DB;
  delete process.env.SEED_USER_EMAIL;
  delete process.env.SEED_USER_PASSWORD;
  delete process.env.SEED_USER_NAME;
  delete process.env.SEED_USER_ROLE;
  delete process.env.SEED_ADMIN_EMAIL;
  delete process.env.SEED_ADMIN_PASSWORD;
  delete process.env.SEED_ADMIN_NAME;
  delete process.env.SEED_ADMIN_ROLE;
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  process.env = { ...originalEnv };
  jest.dontMock('../../models');
  jest.resetModules();
});

describe('seed: dev-accounts', () => {
  it('creates a normal user and an admin with the roles the app expects', async () => {
    const model = makeModel();
    await load(model).up();

    expect(model.User.create).toHaveBeenCalledTimes(2);
    const [user, admin] = model.User.create.mock.calls.map((c) => c[0]);

    expect(user).toMatchObject({
      email: 'dev.user@example.com',
      role: 'user',
      authProvider: 'jwt',
      emailVerified: true,
      isActive: true
    });
    expect(admin).toMatchObject({
      email: 'dev.admin@example.com',
      role: 'admin',
      authProvider: 'jwt'
    });
    // 平文を渡す（ハッシュはモデルの beforeCreate がやる）- ここが二重ハッシュになりやすい
    expect(user.password).toBe('DevUser@12345');
    expect(admin.password).not.toBe(user.password);
  });

  it('marks the names so they can never be mistaken for a real account', async () => {
    const model = makeModel();
    await load(model).up();

    const names = model.User.create.mock.calls.map((c) => c[0].name);
    names.forEach((name) => expect(name).toContain('dev seed'));
    // 過去の障害：ダッシュボードが常に "Test User" を表示していた
    expect(names).not.toContain('Test User');
    expect(model.User.create.mock.calls.map((c) => c[0].email)).not.toContain('test@example.com');
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

  it('is a no-op when DISABLE_DB=true (the dummy model cannot persist)', async () => {
    process.env.DISABLE_DB = 'true';
    const model = makeModel();

    await load(model).up();

    expect(model.User.findOne).not.toHaveBeenCalled();
    expect(model.User.create).not.toHaveBeenCalled();
  });

  it('never overwrites an existing password, only aligns the role', async () => {
    const existing = {
      id: 1,
      email: 'dev.user@example.com',
      role: 'admin', // 誰かが既に作り直していた
      password: '$2a$10$alreadyhashed',
      update: jest.fn(async function update(v) { Object.assign(this, v); return this; })
    };
    const model = makeModel([existing]);

    await load(model).up();

    const created = model.User.create.mock.calls.map((c) => c[0].email);
    expect(created).toEqual(['dev.admin@example.com']);
    expect(existing.update).toHaveBeenCalledWith({ role: 'user' });
  });

  it('leaves an already-correct account completely alone', async () => {
    const rows = ['dev.user@example.com', 'dev.admin@example.com'].map((email, i) => ({
      id: i + 1,
      email,
      role: email.startsWith('dev.admin') ? 'admin' : 'user',
      update: jest.fn(async () => rows[i])
    }));
    const model = makeModel(rows);
    const seeder = load(model);

    await seeder.up();
    await seeder.up();

    expect(model.User.create).not.toHaveBeenCalled();
    rows.forEach((row) => expect(row.update).not.toHaveBeenCalled());
  });

  it('rejects a too-short password before it reaches bcrypt', async () => {
    process.env.SEED_ADMIN_PASSWORD = 'abc';
    const model = makeModel();

    await expect(load(model).up()).rejects.toThrow(/8 文字以上/);
    expect(model.User.create).not.toHaveBeenCalled();
  });

  it('rejects a role that is not in the ENUM instead of failing in MySQL', async () => {
    process.env.SEED_ADMIN_ROLE = 'manager';
    const model = makeModel();

    await expect(load(model).up()).rejects.toThrow(/Users\.role/);
    expect(model.User.create).not.toHaveBeenCalled();
  });

  it('honours custom emails and keeps a custom password out of the log', async () => {
    process.env.SEED_USER_EMAIL = 'Local.User@Example.com';
    process.env.SEED_USER_PASSWORD = 'LocalOnly@9876';
    const model = makeModel();

    await load(model).up();

    const emails = model.User.create.mock.calls.map((c) => c[0].email);
    expect(emails).toContain('local.user@example.com');   // 正規化して検索・作成
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).not.toContain('LocalOnly@9876');       // 設定した秘密は出さない
    expect(printed).toContain('SEED_環境変数で設定した値');
  });

  it('skips an account whose email was explicitly disabled', async () => {
    process.env.SEED_USER_EMAIL = 'not-an-email';
    const model = makeModel();

    await load(model).up();

    const emails = model.User.create.mock.calls.map((c) => c[0].email);
    expect(emails).toEqual(['dev.admin@example.com']);
  });

  describe('down()', () => {
    it('deletes only the rows this seed created', async () => {
      const seeded = {
        id: 1,
        email: 'dev.user@example.com',
        role: 'user',
        name: 'dev.user (dev seed)',
        firebaseUid: null,
        sharegramUserId: null,
        destroy: jest.fn(async () => true)
      };
      const model = makeModel([seeded]);

      await load(model).down();

      expect(seeded.destroy).toHaveBeenCalledTimes(1);
    });

    it('refuses to delete a row that has since been linked to Sharegram SSO', async () => {
      const row = {
        id: 2,
        email: 'dev.admin@example.com',
        role: 'admin',
        name: 'dev.admin (dev seed)',
        firebaseUid: 'uid-real-123',
        sharegramUserId: '12046',
        destroy: jest.fn(async () => true)
      };
      const model = makeModel([row]);

      await load(model).down();

      expect(row.destroy).not.toHaveBeenCalled();
    });

    it('refuses to delete a renamed row (a human claimed it)', async () => {
      const row = {
        id: 3,
        email: 'dev.admin@example.com',
        role: 'admin',
        name: '本物の管理者',
        firebaseUid: null,
        sharegramUserId: null,
        destroy: jest.fn(async () => true)
      };
      const model = makeModel([row]);

      await load(model).down();

      expect(row.destroy).not.toHaveBeenCalled();
    });
  });
});
