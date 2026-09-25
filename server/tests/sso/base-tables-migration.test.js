/**
 * 基礎テーブル用マイグレーション（00-create-base-tables）のテスト。
 *
 * 背景: migrations は既存テーブルへの追加しかせず、Users / performers /
 * AuditLogs / Videos を作る物が1つも無かった。そのため空のDBでは
 *   ERROR: Table 'safevideo.users' doesn't exist
 * で db:migrate が先頭から止まった（development は sequelize.sync() で
 * 偶然できていたが、auto-sync を使わない本番では構成不能だった）。
 *
 * モデルのテーブルがどれかのマイグレーションで作られているかの検査は
 * tests/sso/migration-coverage.test.js（モックを混ぜない別ファイル）。
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const BASE_MIGRATION = '20240101000000-create-base-tables.js';

const loadMigration = (name) => require(path.join(MIGRATIONS_DIR, name));

const fakeModel = (tableName, log) => ({
  getTableName: () => tableName,
  sync: jest.fn(async () => {
    log.push(`sync:${tableName}`);
  })
});

const createFakeQueryInterface = ({ tables = [], failShowAllTables = false } = {}) => ({
  showAllTables: jest.fn(async () => {
    if (failShowAllTables) throw new Error('information_schema not reachable');
    return tables;
  }),
  dropTable: jest.fn(async (table) => {
    log.push(`drop:${table}`);
  }),
  sequelize: {
    getDialect: () => 'mysql',
    query: jest.fn(async () => [[]])
  }
});

let log;

beforeEach(() => {
  log = [];
  jest.resetModules();
});

afterEach(() => {
  jest.resetModules();
});

const stubModels = (models) => {
  jest.doMock('../../models', () => models);
};

describe('00-create-base-tables', () => {
  it('sorts before every other migration so it runs first', () => {
    const names = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.js'))
      .sort();

    expect(names[0]).toBe(BASE_MIGRATION);
    expect(names[1]).toBe('20240101000001-add-firebase-integration-columns.js');
  });

  it('creates the four base tables in dependency order on an empty database', async () => {
    stubModels({
      User: fakeModel('Users', log),
      Performer: fakeModel('performers', log),
      AuditLog: fakeModel('AuditLogs', log),
      Video: fakeModel('Videos', log)
    });
    const queryInterface = createFakeQueryInterface({ tables: [] });
    const logged = [];
    const realLog = console.log;
    console.log = (...args) => logged.push(args.join(' '));

    try {
      await expect(loadMigration(BASE_MIGRATION).up(queryInterface)).resolves.toBeUndefined();
    } finally {
      console.log = realLog;
    }

    // Users が先（他が外部キーで参照する）、Videos は独立
    expect(log).toEqual(['sync:Users', 'sync:performers', 'sync:AuditLogs', 'sync:Videos']);
    expect(logged.join('\n')).toContain('作成: Users, performers, AuditLogs, Videos');
  });

  it('is a no-op when the tables already exist (including lowercase names on Windows)', async () => {
    // lower_case_table_names=1 の環境では information_schema が 'users' と返す
    stubModels({
      User: fakeModel('Users', log),
      Performer: fakeModel('performers', log),
      AuditLog: fakeModel('AuditLogs', log),
      Video: fakeModel('Videos', log)
    });
    const queryInterface = createFakeQueryInterface({ tables: ['users', 'performers', 'auditlogs', 'videos'] });
    const logged = [];
    const realLog = console.log;
    console.log = (...args) => logged.push(args.join(' '));

    try {
      await expect(loadMigration(BASE_MIGRATION).up(queryInterface)).resolves.toBeUndefined();
    } finally {
      console.log = realLog;
    }

    // 作成自体は Model.sync() に委ねる（既存なら内部で no-op）
    expect(log).toHaveLength(4);
    expect(logged.join('\n')).toContain('全テーブルが既存のため作成スキップ');
  });

  it('still runs when showAllTables() is unavailable', async () => {
    stubModels({
      User: fakeModel('Users', log),
      Performer: fakeModel('performers', log),
      AuditLog: fakeModel('AuditLogs', log),
      Video: fakeModel('Videos', log)
    });
    const queryInterface = createFakeQueryInterface({ failShowAllTables: true });

    await expect(loadMigration(BASE_MIGRATION).up(queryInterface)).resolves.toBeUndefined();
    expect(log).toHaveLength(4);
  });

  it('fails loudly if a model is missing instead of half-building the schema', async () => {
    stubModels({
      User: fakeModel('Users', log),
      Performer: fakeModel('performers', log)
      // AuditLog / Video が無い＝models/index.js の登録漏れを再現
    });
    const queryInterface = createFakeQueryInterface({ tables: [] });

    await expect(loadMigration(BASE_MIGRATION).up(queryInterface)).rejects.toThrow(/モデル AuditLog を解決できません/);
    expect(log).toEqual(['sync:Users', 'sync:performers']);
  });

  it('drops in reverse order so referential constraints stay satisfied', async () => {
    stubModels({
      User: fakeModel('Users', log),
      Performer: fakeModel('performers', log),
      AuditLog: fakeModel('AuditLogs', log),
      Video: fakeModel('Videos', log)
    });
    const queryInterface = createFakeQueryInterface({ tables: ['Users'] });

    await loadMigration(BASE_MIGRATION).down(queryInterface);

    expect(queryInterface.dropTable.mock.calls.map((c) => c[0])).toEqual([
      'Videos',
      'AuditLogs',
      'performers',
      'Users'
    ]);
  });
});
