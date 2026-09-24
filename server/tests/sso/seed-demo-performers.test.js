/**
 * デモ出演者シード（0003）のテスト。MySQL 不要。
 *
 * 主眼: 「シードしたのに一覧が空」を起きなくする物なので、
 *  (a) オーナーのユーザーに紐づいて作られること（role='user' は自分の行だけ見る）
 *  (b) 存在しない email では作らない（取り違え防止）
 *  (c) 壊れたボタンを生むので書類の実体は入れない
 *  (d) 列挙値（status / kycStatus）を壊さない
 *  (e) 冪等・本番中止・down() は自分の作成品だけ
 */

process.env.NODE_ENV = 'test';

const SEEDER = '../../seeders/20240101000003-seed-demo-performers';

const STATUS_ENUM = ['active', 'inactive', 'pending', 'rejected'];
const KYC_ENUM = ['not_started', 'in_progress', 'verified', 'rejected', 'expired'];

const makeModels = () => {
  const users = [
    { id: 10, email: 'user@example.com', role: 'user' },
    { id: 11, email: 'admin@example.com', role: 'admin' }
  ];
  const state = {
    users,
    performers: [],
    audits: [],
    User: { findOne: jest.fn(async ({ where }) => users.find((u) => u.email === where.email) || null) },
    Performer: {
      findOne: jest.fn(async ({ where }) => state.performers.find((p) => p.external_id === where.external_id) || null),
      create: jest.fn(async (values) => {
        const row = {
          id: state.performers.length + 100,
          ...values,
          destroy: jest.fn(async () => {
            const i = state.performers.indexOf(row);
            if (i >= 0) state.performers.splice(i, 1);
          })
        };
        state.performers.push(row);
        return row;
      }),
      findAll: jest.fn(async () => state.performers.slice())
    },
    AuditLog: {
      create: jest.fn(async (values) => { state.audits.push(values); return values; }),
      destroy: jest.fn(async ({ where }) => {
        const before = state.audits.length;
        state.audits = state.audits.filter((a) => !(a.resourceId === where.resourceId && a.details.marker === where.details.marker));
        return before - state.audits.length;
      })
    }
  };
  return state;
};

const load = (models) => {
  jest.resetModules();
  jest.doMock('../../models', () => models);
  // eslint-disable-next-line global-require
  return require(SEEDER);
};

const SEED_ENV = ['SEED_DEMO_DATA', 'SEED_DEMO_OWNER_EMAILS', 'SEED_ALLOW_INSECURE', 'DISABLE_DB'];
const originalEnv = { ...process.env };
let log;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  SEED_ENV.forEach((k) => delete process.env[k]);
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  process.env = { ...originalEnv };
  jest.dontMock('../../models');
  jest.resetModules();
});

describe('seed: demo-performers', () => {
  it('creates performers owned by the seeded accounts', async () => {
    const models = makeModels();
    await load(models).up();

    expect(models.performers.length).toBeGreaterThan(0);
    const owners = new Set(models.performers.map((p) => p.userId));
    expect([...owners].sort()).toEqual([10, 11]);
    models.performers.forEach((p) => {
      expect(p.external_id).toMatch(/^SEED-DEMO-/);
      expect(p.notes).toContain('demo seed');
    });
  });

  it('only creates for owners that actually exist, and says so', async () => {
    process.env.SEED_DEMO_OWNER_EMAILS = 'user@example.com,nobody@example.com';
    const models = makeModels();

    await load(models).up();

    expect(models.performers.every((p) => p.userId === 10)).toBe(true);
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).toMatch(/nobody@example\.com が Users に無い/);
  });

  it('does not fake document files (a path-less document is a broken button)', async () => {
    const models = makeModels();
    await load(models).up();

    models.performers.forEach((p) => expect(p.documents).toEqual({}));
  });

  it('writes only values the ENUM columns accept', async () => {
    const models = makeModels();
    await load(models).up();

    models.performers.forEach((p) => {
      expect(STATUS_ENUM).toContain(p.status);
      expect(KYC_ENUM).toContain(p.kycStatus);
      expect(p.nationality).toHaveLength(2);
    });
    // 一覧のフィルタが動くように、状態は重複させていない
    expect(new Set(models.performers.filter((p) => p.userId === 10).map((p) => p.kycStatus)).size)
      .toBeGreaterThan(1);
  });

  it('records one audit log per performer so the history page is not empty', async () => {
    const models = makeModels();
    await load(models).up();

    expect(models.audits).toHaveLength(models.performers.length);
    models.audits.forEach((a) => {
      expect(a).toMatchObject({ action: 'create', resourceType: 'performer' });
      expect(a.details.marker).toBe('seed-demo');
    });
  });

  it('is idempotent', async () => {
    const models = makeModels();
    const seeder = load(models);

    await seeder.up();
    const after = models.performers.length;
    await seeder.up();

    expect(models.performers.length).toBe(after);
  });

  it('skips entirely when SEED_DEMO_DATA=false', async () => {
    process.env.SEED_DEMO_DATA = 'false';
    const models = makeModels();

    await load(models).up();

    expect(models.performers).toHaveLength(0);
    expect(models.AuditLog.create).not.toHaveBeenCalled();
  });

  it('refuses to run in production', async () => {
    process.env.NODE_ENV = 'production';
    const models = makeModels();

    await expect(load(models).up()).rejects.toThrow(/production/);
    expect(models.performers).toHaveLength(0);
  });

  it('is a no-op when DISABLE_DB=true', async () => {
    process.env.DISABLE_DB = 'true';
    const models = makeModels();

    await load(models).up();

    expect(models.performers).toHaveLength(0);
  });

  it('down() removes only its own rows and their audit entries', async () => {
    const models = makeModels();
    await load(models).up();
    const mine = models.performers.slice();
    models.performers.push({ id: 999, external_id: '5558', destroy: jest.fn(async () => true) }); // 実データ

    await load(models).down();

    mine.forEach((p) => expect(p.destroy).toHaveBeenCalled());
    expect(models.performers.map((p) => p.external_id)).toContain('5558'); // 実データは残る
    expect(models.audits).toHaveLength(0);
  });
});
