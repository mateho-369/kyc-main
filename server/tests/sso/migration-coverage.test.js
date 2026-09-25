/**
 * 「マイグレーションだけでスキーマを構築できるか」の不変条件テスト。
 *
 * 以前は Users / performers / AuditLogs / Videos を作るマイグレーションが存在せず、
 * sequelize.sync() にしか作られていなかった。そのため空のデータベースでは
 *   npm run migrate → ERROR: Table 'safevideo.users' doesn't exist
 * で先頭から止まり、auto-sync を使わない本番ではスキーマを構成できなかった。
 *
 * ここでは「モデルが定義するテーブルは、必ずどれかのマイグレーションが作る」を
 * 検査する。モデルを1つ追加してマイグレーションを忘れると、このテストが落ちる。
 *
 * 注意: このテストはモックを一切使わない別のファイルに置いてある。
 * 同じファイル内に jest.doMock('../../models') を使うテストがあると、
 * モック登録がファイル単位で残るため、realSequelize.models が空になり
 * 不変条件が「orphans = []」で真空成立してしまう（実際に一度そうなった）。
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const BASE_MIGRATION = '20240101000000-create-base-tables.js';

const tableNameOf = (model) => {
  const name = model.getTableName();
  return typeof name === 'string' ? name : name.tableName;
};

describe('migration coverage of the model schema', () => {
  // モックが混入していないことの明示的な担保（空なら無条件に成功してしまう）
  it('loads the real model registry', () => {
    // eslint-disable-next-line global-require
    const { sequelize } = require('../../config/db');
    // eslint-disable-next-line global-require
    require('../../models');

    expect(Object.keys(sequelize.models).length).toBeGreaterThanOrEqual(12);
  });

  it('every model table is created by some migration (no sync-only tables)', () => {
    // eslint-disable-next-line global-require
    const { sequelize } = require('../../config/db');
    // eslint-disable-next-line global-require
    require('../../models');

    // 各マイグレーションが createTable() で作るテーブル
    const created = new Set();
    fs.readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.js'))
      .forEach((file) => {
        const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        for (const match of src.matchAll(/createTable\(\s*['"]([^'"]+)['"]/g)) {
          created.add(match[1].toLowerCase());
        }
      });

    // 00番はモデル定義から作る（createTable のリテラルを持たない）ので補充する
    // eslint-disable-next-line global-require
    const baseMigration = require(path.join(MIGRATIONS_DIR, BASE_MIGRATION));
    expect(Array.isArray(baseMigration.MODEL_ORDER)).toBe(true);

    baseMigration.MODEL_ORDER.forEach((modelName) => {
      const model = sequelize.models[modelName];
      // 00が対象とするモデルが実在することも同時に検証する
      expect({ [modelName]: Boolean(model) }).toEqual({ [modelName]: true });
      created.add(String(tableNameOf(model)).toLowerCase());
    });

    const orphans = Object.keys(sequelize.models)
      .map((key) => [key, String(tableNameOf(sequelize.models[key])).toLowerCase()])
      .filter(([, table]) => !created.has(table));

    // 残っている＝「db:migrate だけでは構成できない」テーブル
    expect(orphans.map(([name, table]) => `${name} -> ${table}`)).toEqual([]);
  });

  it('the base migration covers exactly the tables nothing else creates', () => {
    const literalCreates = new Set();
    fs.readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.js') && file !== BASE_MIGRATION)
      .forEach((file) => {
        const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        for (const match of src.matchAll(/createTable\(\s*['"]([^'"]+)['"]/g)) {
          literalCreates.add(match[1].toLowerCase());
        }
      });

    // eslint-disable-next-line global-require
    const { sequelize } = require('../../config/db');
    // eslint-disable-next-line global-require
    require('../../models');

    // eslint-disable-next-line global-require
    const { MODEL_ORDER } = require(path.join(MIGRATIONS_DIR, BASE_MIGRATION));
    const coveredByBase = MODEL_ORDER.map((name) => String(tableNameOf(sequelize.models[name])).toLowerCase());

    // 00が作る物に重複（他マイグレーションと作るテーブルが被る）が無いこと
    coveredByBase.forEach((table) => expect(literalCreates.has(table)).toBe(false));
    // 00が1つも作らない状態（＝全テーブルが他でカバー済み）にもなっていないこと
    expect(coveredByBase.length).toBeGreaterThan(0);
  });
});
