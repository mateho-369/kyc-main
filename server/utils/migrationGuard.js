'use strict';

/**
 * マイグレーションを冪等（idempotent）にするヘルパー。
 *
 * 【なぜ必要か】
 * 開発環境では config/db.js と config/database.js が起動のたびに
 *   sequelize.sync({ alter: true })
 * を実行し、モデル定義からテーブルとカラムを先に作ってしまう。
 * そのため、後から npx sequelize-cli db:migrate を実行すると
 *   == 20240101000001-add-firebase-integration-columns: migrating ==
 *   ERROR: Duplicate column name 'firebaseUid'
 * のように「既に存在する」エラーで停止する。
 *
 * これがやっかいなのは、マイグレーションが失敗すると SequelizeMeta に
 * 記録が残らず、次回も同じ 01 番でまた止まること。結果として 02〜14 番
 * （＝まだ適用されていない本物のスキーマ変更）が1つも適用されない。
 * 「migrate したのにカラムがない」はだいたいこの状態。
 *
 * 【何をするか】
 * queryInterface の DDL をラップして、
 *   ・作ろうとした物が既に存在する
 *   ・消そうとした物が存在しない
 * という MySQL のエラーだけを「スキップ」として記録し、
 * それ以外（権限・構文・ロック・タイムアウト）はそのまま送出する。
 *
 * 【注意】このガードはスキーマの「不足」は埋めるが、sync({alter:true}) が
 * 作り直すこと自体は止めない。恒久策としては development の auto sync を
 * 外してマイグレーションを唯一のスキーマ変更手段にすること。
 */

// スキップしてよい MySQL エラー
const SKIPPABLE_ERROR_CODES = [
  'ER_DUP_FIELDNAME', // 1060: Duplicate column name 'x'
  'ER_TABLE_EXISTS_ERROR', // 1050: Table 'x' already exists
  'ER_DUP_KEYNAME', // 1061: Duplicate key name 'x'
  'ER_CANT_DROP_FIELD_OR_KEY', // 1091: Can't DROP 'x'; check that column/key exists
  'ER_BAD_TABLE_ERROR', // 1051: Unknown table 'x'
  'ER_FK_DUP_KEY' // 外部キーの重複（念のため）
];

const SKIPPABLE_ERRNOS = [1050, 1051, 1060, 1061, 1091];

const SKIPPABLE_MESSAGE =
  /duplicate column name|already exists|duplicate key name|can'?t drop|unknown table|errno:\s*(1050|1051|1060|1061|1091)/i;

// 冪等にラップする DDL メソッド
const GUARDED_METHODS = [
  'createTable',
  'dropTable',
  'addColumn',
  'removeColumn',
  'changeColumn',
  'addIndex',
  'removeIndex',
  'addConstraint',
  'removeConstraint',
  'renameTable',
  'renameColumn'
];

const isSkippable = (error) => {
  if (!error) return false;

  const codes = [error.code, error.parent && error.parent.code, error.original && error.original.code];
  if (codes.some((code) => code && SKIPPABLE_ERROR_CODES.includes(code))) return true;

  const errnos = [error.errno, error.parent && error.parent.errno, error.original && error.original.errno];
  if (errnos.some((errno) => typeof errno === 'number' && SKIPPABLE_ERRNOS.includes(errno))) return true;

  const message = String(
    error.message ||
    error.sqlMessage ||
    (error.parent && error.parent.message) ||
    (error.original && error.original.message) ||
    ''
  );
  return SKIPPABLE_MESSAGE.test(message);
};

// 「Users.firebaseUid」のような分かる形のラベルを作る
const targetLabel = (args) => {
  const parts = args.filter((arg) => typeof arg === 'string');
  if (parts.length === 0) return '';
  // addColumn(table, column) / addIndex(table, columns|{name}) など
  if (parts.length === 1) return parts[0];
  if (typeof args[1] === 'string') return `${args[0]}.${args[1]}`;
  return args[0];
};

const shortMessage = (error) => String(error.message || error.sqlMessage || error).split('\n')[0].slice(0, 160);

/**
 * @param {object} queryInterface sequelize-cli が渡す queryInterface
 * @param {string} [label] ログに出すマイグレーション名
 * @returns {object} 元のインターフェースのプロトタイプ上に安全版を並べたオブジェクト
 */
const makeSafe = (queryInterface, label = '') => {
  const prefix = label ? `[migrate:${label}] ` : '[migrate] ';
  const safe = Object.create(queryInterface);

  GUARDED_METHODS.forEach((method) => {
    const original = queryInterface[method];
    if (typeof original !== 'function') return;

    safe[method] = async function guarded(...args) {
      try {
        return await original.apply(queryInterface, args);
      } catch (error) {
        if (!isSkippable(error)) throw error;
        console.log(`${prefix}SKIP ${method} ${targetLabel(args)} — ${shortMessage(error)}`);
        return undefined;
      }
    };
  });

  return safe;
};

module.exports = {
  makeSafe,
  isSkippable,
  GUARDED_METHODS,
  SKIPPABLE_ERROR_CODES
};
