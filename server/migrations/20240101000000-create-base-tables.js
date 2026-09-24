'use strict';

/**
 * 基礎テーブル（Users / performers / AuditLogs / Videos）を作成するマイグレーション。
 *
 * 【なぜ必要か】
 * これまでの migrations は「既存テーブルへの追加・拡張」しかしていなかった。
 *   01 → Users へ addColumn
 *   10/11/13 → performers へ addColumn / addIndex
 * なのに、これらのテーブルを作るマイグレーションが1本も存在しなかった。
 * 実際、リポジトリ内の全 createTable が作るのは次の8枚だけだった：
 *   ApiLogs, BatchJobs, FirebaseUsers, KYCDocuments, KYCRequests,
 *   KYCVerificationSteps, SharegramIntegrations, Webhooks
 *
 * テーブルを作っていたのは sequelize.sync()（development の起動時、
 * config/db.js:52）だけ。つまり：
 *   ・空のDBで npm run migrate → 先頭から
 *       ERROR: Table 'safevideo.users' doesn't exist
 *     で止まり、スキーマを構築できなかった（ローカルで実際に起きた）
 *   ・README は「本番は auto-sync を使わずマイグレーション」と言っているため、
 *     本番・staging の新規DBでも同じところで必ず止まっていた
 *
 * 【実装の方針】
 * 列定義をここに書き写さない。モデル定義（server/models）をそのまま
 * 使って作らせることで、モデルとスキーマの乖離を防ぐ。
 * Model.sync() は tableExists を確認してから作成するため
 * （sequelize/lib/model.js:941）、テーブルが既にある環境では no-op。
 * よってこのマイグレーションは何度実行しても安全。
 *
 * 作成順は外部キーの依存関係に従う：
 *   Users（他を参照しない）→ performers / AuditLogs（Users を参照）
 *   → Videos（独立）
 */

const MODEL_ORDER = ['User', 'Performer', 'AuditLog', 'Video'];

const tableNameOf = (model) => {
  const name = model.getTableName();
  return typeof name === 'string' ? name : name.tableName;
};

module.exports = {
  up: async (queryInterface) => {
    const { makeSafe } = require('../utils/migrationGuard');
    // sync({alter:true}) で既に作られている場合は「既存」扱いでスキップされる
    queryInterface = makeSafe(queryInterface, '00-create-base-tables');

    // eslint-disable-next-line global-require
    const models = require('../models');

    const present = new Set(
      ((await queryInterface.showAllTables().catch(() => [])) || []).map((t) => String(t).toLowerCase())
    );

    const created = [];
    for (const modelName of MODEL_ORDER) {
      const model = models[modelName];
      if (!model || typeof model.sync !== 'function') {
        throw new Error(
          `マイグレーション00: モデル ${modelName} を解決できません（server/models/index.js を確認してください）`
        );
      }

      // 既存なら no-op、無ければ CREATE TABLE（モデル定義そのまま）
      await model.sync();

      const table = String(tableNameOf(model));
      if (!present.has(table.toLowerCase())) created.push(table);
    }

    console.log(
      created.length > 0
        ? `[migrate:00-create-base-tables] 作成: ${created.join(', ')}`
        : '[migrate:00-create-base-tables] 全テーブルが既存のため作成スキップ'
    );
  },

  down: async (queryInterface) => {
    const { makeSafe } = require('../utils/migrationGuard');
    queryInterface = makeSafe(queryInterface, '00-create-base-tables');

    // eslint-disable-next-line global-require
    const models = require('../models');

    // 作成と逆順に落とす（参照側のテーブルを先に消すため）
    for (const modelName of [...MODEL_ORDER].reverse()) {
      const model = models[modelName];
      if (!model) continue;
      await queryInterface.dropTable(tableNameOf(model));
    }
  },

  // テストとREADMEから参照される（このマイグレーションが作るテーブル一覧）
  MODEL_ORDER,
  tableNameOf
};
