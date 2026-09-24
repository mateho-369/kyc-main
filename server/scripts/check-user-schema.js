#!/usr/bin/env node
/**
 * Users テーブルとマイグレーション履歴の状態を確認するスクリプト。
 *
 * mysql クライアントが無くても動く（アプリと同じ Sequelize 接続を使うため、
 * 「マイグレーションした DB」と「アプリが見ている DB」がズレている問題も
 * そのまま検出できる）。
 *
 * 使い方:
 *   cd server
 *   node scripts/check-user-schema.js
 *
 * 終了コード: 0=正常 / 1=カラム不足 / 2=DB接続不可
 */

const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..');

// server.js と同じ規則で .env を読む（config/db.js は cwd 基準なので、
// リポジトリ直下から実行すると別の .env を拾ってしまう）
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.join(SERVER_DIR, envFile);
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
  console.log(`[env] ${envPath}`);
} else {
  console.warn(`[env] ⚠ ${envPath} が見つかりません。環境変数なしで接続を試みます`);
}

// SSO が依存している Users の列
const REQUIRED_COLUMNS = [
  'firebaseUid',
  'authProvider',
  'lastLoginAt',
  'emailVerified',
  'sharegramUserId',
  'profilePicture'
];

const MAIN_TABLES = ['Users', 'FirebaseUsers'];

const run = async () => {
  const { sequelize } = require('../config/db');
  // 結果だけを見たいスクリプトなので、開発モードの SQL ログは黙らせる
  sequelize.options.logging = false;

  try {
    await sequelize.authenticate();
  } catch (error) {
    const root = error.parent || error.original || {};
    const detail = [
      error.name || 'Error',
      error.message,
      root.code,
      root.sqlMessage,
      root.syscall && root.address ? `${root.syscall} ${root.address}:${root.port || ''}` : ''
    ]
      .filter(Boolean)
      .join(' — ');

    console.error(`\n[FAIL] データベースに接続できません: ${detail}`);

    const code = `${root.code || ''}${error.name || ''}`;
    if (/ECONNREFUSED|SequelizeConnectionRefusedError/.test(code)) {
      console.error(' → MySQL が起動していないか、ポートが違います。');
      console.error('    · docker-compose を使っている場合、ホスト側ポートは 3307');
      console.error('      （server/.env に DB_PORT=3307）');
      console.error('    · MYSQL_HOST は localhost ではなく 127.0.0.1 を推奨');
    } else if (/ER_ACCESS_DENIED|SequelizeAccessDeniedError/.test(code)) {
      console.error(' → ユーザー名またはパスワードが違います（server/.env の');
      console.error('    MYSQL_USER / MYSQL_PASSWORD、docker なら MYSQL_ROOT_PASSWORD）。');
    } else if (/ER_BAD_DB_ERROR/.test(code)) {
      console.error(' → MYSQL_DATABASE（既定 safevideo）が存在しません。');
      console.error('    npx sequelize-cli db:create か、DB 名を確認してください。');
    } else {
      console.error(' → server/.env の MYSQL_* / DB_* の値を確認してください。');
    }

    await sequelize.close().catch(() => {});
    process.exit(2);
  }

  const [current] = await sequelize.query('SELECT DATABASE() AS db, @@hostname AS host, @@port AS port');
  console.log(`\n[app DB] ${current[0].db} @ ${current[0].host}:${current[0].port}`);

  // 1) テーブルの確認
  console.log('\n=== テーブル ===');
  const tableState = {};
  for (const table of MAIN_TABLES) {
    // 注意: Windows の MySQL は lower_case_table_names=1 で運用されることが多く、
    // information_schema には 'users' のように小文字で現れる。
    // 大小を区別して比較すると「テーブルが無い」と誤報告することになる。
    const [rows] = await sequelize.query(
      `SELECT COUNT(*) AS c FROM information_schema.tables
        WHERE table_schema = DATABASE() AND LOWER(table_name) = LOWER('${table}')`
    );
    tableState[table] = Number(rows[0].c) > 0;
    console.log(`  ${tableState[table] ? '[OK]  ' : '[FAIL]'} ${table}${tableState[table] ? '' : ' が存在しません'}`);
  }

  // 2) Users の必須列
  console.log('\n=== Users の列（Sharegram SSO が必要なもの）===');
  const missing = [];
  if (tableState.Users) {
    const [columns] = await sequelize.query(
      `SELECT column_name AS name, data_type AS type, character_maximum_length AS len
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND LOWER(table_name) = LOWER('Users')`
    );
    const present = new Map(columns.map((c) => [String(c.name).toLowerCase(), c]));
    REQUIRED_COLUMNS.forEach((column) => {
      const found = present.get(column.toLowerCase());
      if (!found) {
        missing.push(column);
        console.log(`  [MISS] ${column}`);
      } else {
        const size = found.len ? `(${found.len})` : '';
        console.log(`  [OK]   ${column}  ${found.type}${size}`);
      }
    });
  } else {
    console.log('  [SKIP] Users テーブルがないため確認できません');
    missing.push(...REQUIRED_COLUMNS);
  }

  // 3) マイグレーション履歴
  console.log('\n=== マイグレーション履歴（SequelizeMeta）===');
  let appliedCount = -1;
  try {
    const [meta] = await sequelize.query(
      'SELECT name FROM SequelizeMeta ORDER BY name'
    );
    appliedCount = meta.length;
    if (appliedCount === 0) {
      console.log('  [FAIL] SequelizeMeta は空です → db:migrate は1件も完了していません');
    } else {
      meta.forEach((row) => console.log(`  [UP]   ${row.name}`));
    }
    const [pendingFiles] = [
      fs.readdirSync(path.join(SERVER_DIR, 'migrations')).filter((f) => f.endsWith('.js'))
    ];
    const applied = new Set(meta.map((row) => row.name));
    const pending = pendingFiles.filter((f) => !applied.has(f));
    if (pending.length > 0) {
      console.log(`  [TODO] 未適用 ${pending.length} 件:`);
      pending.forEach((f) => console.log(`         ${f}`));
    }
  } catch (error) {
    console.log(`  [FAIL] SequelizeMeta を読めません: ${error.message.split('\n')[0]}`);
    console.log('  → npx sequelize-cli db:migrate を実行すると作られます');
  }

  // 4) sequelize-cli が見ている DB との比較（ズレ検出）
  console.log('\n=== sequelize-cli の設定との比較 ===');
  const cliConfigPath = path.join(SERVER_DIR, 'config', 'config.js');
  if (!fs.existsSync(cliConfigPath)) {
    // config/config.js はリポジトリに含まれている（認証情報は書かない）。
    // 無いとすれば、うっかり削除・未追跡化された場合。
    console.log('  [FAIL] config/config.js がありません → db:migrate は実行できません');
    console.log('  → git checkout -- server/config/config.js （リポジトリ版を復元）');
  } else {
    try {
      const cliConfig = require(cliConfigPath);
      const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
      const cli = cliConfig[env] || {};
      if (Array.isArray(cliConfig.loadedEnvFiles)) {
        console.log(
          `  [INFO] CLI が読んだ .env = ${cliConfig.loadedEnvFiles.length ? cliConfig.loadedEnvFiles.join(', ') : '(なし → 既定値で接続)'}`
        );
      }
      const cliDb = cli.database;
      console.log(`  [INFO] CLI (${env}) = ${cli.username || '?'}@${cli.host || '?'}:${cli.port || 3306}/${cliDb}`);
      if (cliDb && cliDb !== current[0].db) {
        console.log('  [FAIL] アプリが見ている DB とマイグレーション先が異なります！');
        console.log(`  → config/config.js の database を '${current[0].db}' に合わせるか、`);
        console.log('    server/.env の MYSQL_DATABASE を直してください。');
      } else if (cliDb) {
        console.log('  [OK]   同じ DB を指しています');
      }
    } catch (error) {
      console.log(`  [WARN] config/config.js を評価できませんでした: ${error.message.split('\n')[0]}`);
    }
  }

  // 結果
  console.log('\n' + '='.repeat(60));
  if (missing.length === 0) {
    console.log('[RESULT] スキーマは揃っています。SSO の残り問題がトークン/設定なら');
    console.log('         → npm run diagnose:sso -- "</sso?token=... の URL>"');
    await sequelize.close();
    process.exit(0);
  }
  console.log(`[RESULT] 不足列 ${missing.length} 件: ${missing.join(', ')}`);
  console.log('  → npm run migrate        （既存物は [migrate:..] SKIP として記録されます）');
  console.log('     を実行してから、このスクリプトをもう一度してください。');
  await sequelize.close();
  process.exit(1);
};

run().catch((error) => {
  console.error('[FAIL] 確認に失敗しました:', error.message);
  process.exit(2);
});
