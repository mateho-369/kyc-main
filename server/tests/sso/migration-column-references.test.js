/**
 * 「マイグレーションが参照する列が、そのテーブルに実在するか」を検査する。
 *
 * 発端: 20240101000013-add-performance-indexes.js の4件が実在しない列を索引
 * しようとしていた（ApiLogs.path → 実列は endpoint、KycDocuments.performerId →
 * 親キーは kycRequestId）。MySQL は
 *   ERROR: Key column 'path' doesn't exist in table
 * を返してマイグレーションが停止し、以降の索引も後続マイグレーションも未適用に
 * なった（実際に開発者DBで発生）。development は sequelize.sync() が作った
 * テーブルを使っていたため、この矛盾は長らく見えていなかった。
 *
 * 判定基準はモデルではなく「テーブルを作ったマイグレーション」:
 *   1. createTable を持つテーブル  → そのキー一覧が正式（モデルとズレていても従う）
 *   2. createTable を持たないテーブル（00がモデルから作る）→ モデルの属性
 * 同じファイル以降の addColumn / removeColumn を順に反映して、
 * 「その時点で列が存在するか」を見る。
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

const files = () => fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js')).sort();

const upBody = (src) => {
  const from = src.indexOf('up:');
  const to = src.indexOf('down:');
  return from === -1 ? src : src.slice(from, to === -1 ? src.length : to);
};

const readUp = (file) => upBody(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));

const CREATE_TABLE = /createTable\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\n {4}\}\)/g;
const parseCreateTable = (body) => {
  const result = new Map();
  for (const match of body.matchAll(CREATE_TABLE)) {
    const columns = new Set();
    for (const col of match[2].matchAll(/^ {6}([A-Za-z_]\w*)\s*:\s*\{/gm)) columns.add(col[1]);
    if (columns.size > 0 && !result.has(match[1])) result.set(match[1], columns);
  }
  return result;
};

const fieldsOf = (raw) =>
  raw
    .split(',')
    .map((f) => f.trim().replace(/['"]/g, ''))
    .filter((f) => f && !f.startsWith('Sequelize.'));

describe('migrations only index columns their tables actually have', () => {
  // eslint-disable-next-line global-require
  const { sequelize } = require('../../config/db');
  // eslint-disable-next-line global-require
  require('../../models');

  const list = files();
  const bodies = new Map(list.map((f) => [f, readUp(f)]));

  // モデル -> テーブル -> 列（属性名と field 名の両方を許容）
  const modelColumns = new Map();
  Object.entries(sequelize.models).forEach(([name, model]) => {
    let table = model.getTableName();
    if (typeof table !== 'string') table = table.tableName;
    const columns = new Set();
    Object.entries(model.rawAttributes).forEach(([attr, def]) => {
      columns.add(attr);
      if (def.field) columns.add(def.field);
    });
    modelColumns.set(String(table).toLowerCase(), { name, columns });
  });

  // 各テーブルを「最初に createTable したマイグレーション」の列定義を正とする
  const createdIn = new Map();
  list.forEach((file) => {
    parseCreateTable(bodies.get(file)).forEach((columns, table) => {
      const key = String(table).toLowerCase();
      if (!createdIn.has(key)) createdIn.set(key, { file, columns: new Set(columns) });
    });
  });

  it('parses every createTable in the migrations folder', () => {
    // レジストリが空で無条件に成功しないための担保（過去に一度それで騙された）
    const total = list.reduce((n, f) => n + parseCreateTable(bodies.get(f)).size, 0);
    expect(total).toBeGreaterThanOrEqual(8);
    expect(createdIn.size).toBeGreaterThanOrEqual(8);
  });

  it('indexes only columns that exist at that point in the migration order', () => {
    const schema = new Map();
    const tableCols = (table) => {
      const key = String(table).toLowerCase();
      if (!schema.has(key)) {
        // 1) マイグレーションが作ったテーブル → その定義のみ
        // 2) それ以外（00がモデルから作る）→ モデルの属性
        const created = createdIn.get(key);
        const model = modelColumns.get(key);
        schema.set(key, new Set(created ? created.columns : (model ? model.columns : [])));
      }
      return schema.get(key);
    };

    const problems = [];
    list.forEach((file) => {
      const body = bodies.get(file);

      for (const match of body.matchAll(/addColumn\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
        tableCols(match[1]).add(match[2]);
      }
      for (const match of body.matchAll(/removeColumn\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
        tableCols(match[1]).delete(match[2]);
      }
      for (const match of body.matchAll(/addIndex\(\s*'([^']+)'\s*,\s*\[([^\]]*)\]/g)) {
        const [, table, rawFields] = match;
        const fields = fieldsOf(rawFields);
        const columns = tableCols(table);
        const known = columns.size > 0;
        if (!known) {
          problems.push(`${file}: addIndex('${table}', …) -> the table is never created by a migration and no model maps to it`);
          continue;
        }
        fields.forEach((field) => {
          if (columns.has(field)) return;
          const suggestions = [...columns].filter((c) => /endp|path|url|perform|request/i.test(c));
          problems.push(
            `${file}: addIndex('${table}', [${fields.join(', ')}]) -> '${field}' is not a column of '${table}'` +
              (suggestions.length ? ` (it does have: ${suggestions.join(', ')})` : '')
          );
        });
      }
    });

    expect(problems).toEqual([]);
  });

  it('keeps down() dropping the same index names up() creates', () => {
    // 名前を変えたのに down() を更新しないと、ロールバックが黙って空振りする
    const problems = [];
    list.forEach((file) => {
      const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const body = upBody(src);
      const down = src.slice(src.indexOf('down:'));
      // down() がテーブル自体を落とすマイグレーション（createTable 系）は、
      // 個々の removeIndex を書かないのが正しい。インデックスはテーブルと
      // 一緒に消えるため、この検査の対象外にする。
      if (/dropTable\(/.test(down)) return;
      // addIndex(...) 呼び出しブロック内に限定する。
      // [\s\S]*? で拾うと createTable の options.indexes まで跨いで誤検出する
      // （実際それで44件の偽陽性が出た）。
      const upNames = [...body.matchAll(/addIndex\(\s*'[^']+'\s*,[\s\S]*?\n {4}\}\);/g)]
        .map((block) => {
          const named = /name:\s*'([^']+)'/.exec(block[0]);
          return named ? named[1] : null;
        })
        .filter(Boolean);
      const downNames = new Set([...down.matchAll(/removeIndex\(\s*'[^']+'\s*,\s*'([^']+)'/g)].map((m) => m[1]));
      upNames.forEach((name) => {
        if (!downNames.has(name)) problems.push(`${file}: up() creates '${name}' but down() never drops it`);
      });
    });
    expect(problems).toEqual([]);
  });
});
