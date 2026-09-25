/**
 * マイグレーションの冪等性テスト。
 *
 * 背景: 開発環境では sequelize.sync({ alter: true }) がモデルから先にスキーマを
 * 作成するため、db:migrate は
 *   ERROR: Duplicate column name 'firebaseUid'
 * で停止し、後続マイグレーション（＝まだ適用されていない本物の変更）が
 * 1つも適用されなかった。utils/migrationGuard.js がそれを防いでいることを、
 * 実マイグレーションファイルを使って検証する（MySQL 不要）。
 */

const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

const mysqlError = (code, errno, message) => Object.assign(new Error(message), { code, errno });

/** 空の状態（＝sync が走っていない新規DB）を模した queryInterface */
const createFakeQueryInterface = ({ columns = new Set(), indexes = new Set(), tables = new Set } = {}) => {
  const state = {
    columns,
    indexes,
    tables,
    calls: [],
    // 故意に失敗させるエラー（設定すると次のDDLで1回だけ投げる）
    injectError: null
  };

  const attempt = (kind, key, existsSet, error) => {
    state.calls.push([kind, key]);
    if (state.injectError) {
      const injected = state.injectError;
      state.injectError = null;
      throw injected;
    }
    if (existsSet.has(key)) throw error;
    existsSet.add(key);
  };

  return {
    state,
    sequelize: {
      getDialect: () => 'mysql',
      query: jest.fn(async () => [[]])
    },
    addColumn: jest.fn(async (table, column) =>
      attempt(
        'addColumn',
        `${table}.${column}`,
        state.columns,
        mysqlError('ER_DUP_FIELDNAME', 1060, `Duplicate column name '${column}'`)
      )
    ),
    // up() が適用されていないので down() は必ず「カラムが存在しない」になる。
    // ガードが無ければここで Can't DROP が投げられ、ロールバックが失敗する。
    removeColumn: jest.fn(async (table, column) => {
      state.calls.push(['removeColumn', `${table}.${column}`]);
      if (state.injectError) {
        const injected = state.injectError;
        state.injectError = null;
        throw injected;
      }
      throw mysqlError(
        'ER_CANT_DROP_FIELD_OR_KEY',
        1091,
        `Can't DROP '${column}'; check that column/key exists`
      );
    }),
    addIndex: jest.fn(async (table, fields, options = {}) =>
      attempt(
        'addIndex',
        `${table}.${options.name || String(fields)}`,
        state.indexes,
        mysqlError('ER_DUP_KEYNAME', 1061, `Duplicate key name '${options.name}'`)
      )
    ),
    removeIndex: jest.fn(async (table, name) => {
      state.calls.push(['removeIndex', `${table}.${name}`]);
      throw mysqlError(
        'ER_CANT_DROP_FIELD_OR_KEY',
        1091,
        `Can't DROP '${name}'; check that column/key exists`
      );
    }),
    createTable: jest.fn(async (table) =>
      attempt('createTable', table, state.tables, mysqlError('ER_TABLE_EXISTS_ERROR', 1050, `Table '${table}' already exists`))
    ),
    dropTable: jest.fn(async (table) => {
      state.calls.push(['dropTable', table]);
      if (!state.tables.has(table)) {
        throw mysqlError('ER_BAD_TABLE_ERROR', 1051, `Unknown table '${table}'`);
      }
      state.tables.delete(table);
    })
  };
};

// マイグレーションが使う Sequelize の型ヘルパーだけを再現する
const SequelizeStub = new Proxy(
  {},
  {
    get: () => (...args) => (args.length > 0 ? { types: args } : { type: 'stub' })
  }
);

const loadMigration = (fileName) => require(path.join(MIGRATIONS_DIR, fileName));

describe('migration 01 (add-firebase-integration-columns)', () => {
  const FILE = '20240101000001-add-firebase-integration-columns.js';

  it('adds every column and index on a fresh database', async () => {
    const queryInterface = createFakeQueryInterface();

    await expect(loadMigration(FILE).up(queryInterface, SequelizeStub)).resolves.toBeUndefined();

    ['Users.firebaseUid', 'Users.authProvider', 'Users.lastLoginAt', 'Users.emailVerified'].forEach((column) =>
      expect(queryInterface.state.calls).toEqual(expect.arrayContaining([['addColumn', column]]))
    );
    expect(queryInterface.state.columns.has('Users.firebaseUid')).toBe(true);
    expect(queryInterface.state.calls.filter(([kind]) => kind === 'addIndex')).toHaveLength(3);
  });

  it('does not abort when sequelize.sync() has already created the columns', async () => {
    // 旧挙動: ここで Duplicate column name が投げられ、01 以降が全て未適用のまま止まった
    const queryInterface = createFakeQueryInterface({
      columns: new Set(['Users.firebaseUid', 'Users.authProvider', 'Users.lastLoginAt', 'Users.emailVerified']),
      indexes: new Set([
        'Users.idx_users_firebase_uid',
        'Users.idx_users_auth_provider',
        'Users.idx_users_last_login'
      ])
    });

    await expect(loadMigration(FILE).up(queryInterface, SequelizeStub)).resolves.toBeUndefined();

    // 試行は記録される（＝スキーマ確認はしている）が、エラーにはならない
    expect(queryInterface.state.calls).toHaveLength(7);
  });

  it('rolls back cleanly even if the columns are already gone', async () => {
    const queryInterface = createFakeQueryInterface();

    await expect(loadMigration(FILE).down(queryInterface, SequelizeStub)).resolves.toBeUndefined();
  });

  it('still surfaces errors that are not "already exists"', async () => {
    const queryInterface = createFakeQueryInterface();
    queryInterface.state.injectError = mysqlError(
      'ER_LOCK_WAIT_TIMEOUT',
      1205,
      'Lock wait timeout exceeded; try restarting transaction'
    );

    await expect(loadMigration(FILE).up(queryInterface, SequelizeStub)).rejects.toThrow(/Lock wait timeout/);
  });
});

describe('migration 14 (add-user-profile-picture)', () => {
  const FILE = '20240101000014-add-user-profile-picture.js';

  it('creates Users.profilePicture when it is missing', async () => {
    const queryInterface = createFakeQueryInterface();

    await loadMigration(FILE).up(queryInterface, SequelizeStub);

    expect(queryInterface.state.columns.has('Users.profilePicture')).toBe(true);
  });

  it('is a no-op when sync() already created it (the state a migrated dev DB is in)', async () => {
    const queryInterface = createFakeQueryInterface({ columns: new Set(['Users.profilePicture']) });

    await expect(loadMigration(FILE).up(queryInterface, SequelizeStub)).resolves.toBeUndefined();
    expect(queryInterface.state.calls).toEqual([['addColumn', 'Users.profilePicture']]);
  });
});

describe('migrationGuard.isSkippable', () => {
  // eslint-disable-next-line global-require
  const { isSkippable } = require('../../utils/migrationGuard');

  it.each([
    ['1050 table exists', mysqlError('ER_TABLE_EXISTS_ERROR', 1050, "Table 'FirebaseUsers' already exists")],
    ['1051 unknown table', mysqlError('ER_BAD_TABLE_ERROR', 1051, "Unknown table 'ApiLogs'")],
    ['1060 duplicate column', mysqlError('ER_DUP_FIELDNAME', 1060, "Duplicate column name 'firebaseUid'")],
    ['1061 duplicate index', mysqlError('ER_DUP_KEYNAME', 1061, "Duplicate key name 'idx_users_firebase_uid'")],
    ['1091 cant drop', mysqlError('ER_CANT_DROP_FIELD_OR_KEY', 1091, "Can't DROP 'profilePicture'; check that column/key exists")]
  ])('treats %s as skippable', (_label, error) => {
    expect(isSkippable(error)).toBe(true);
  });

  it.each([
    ['auth failure', mysqlError('ER_ACCESS_DENIED_ERROR', 1045, 'Access denied for user')],
    ['syntax error', mysqlError('ER_PARSE_ERROR', 1064, 'You have an error in your SQL syntax')],
    ['missing db', mysqlError('ER_BAD_DB_ERROR', 1049, "Unknown database 'safevideo'")]
  ])('never swallows %s', (_label, error) => {
    expect(isSkippable(error)).toBe(false);
  });

  it('accepts the message text when the driver omits codes (nested error shapes)', () => {
    expect(isSkippable({ parent: { message: "Duplicate column name 'authProvider'" } })).toBe(true);
    expect(isSkippable({ message: "Duplicate column name 'authProvider'" })).toBe(true);
    expect(isSkippable(undefined)).toBe(false);
  });
});
