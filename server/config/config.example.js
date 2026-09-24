// sequelize-cli 用設定のテンプレート。
//
// 【重要】このファイルはリポジトリに含まれていますが、sequelize-cli が実際に
// 読み込むのは 同じフォルダの `config.js` の方です:
//
//   cp config/config.example.js config/config.js
//
// `config.js` は本番・staging では実値（DB クレデンシャル）を持つため、意図的に
// 追跡していません。ここでのデフォルトはすべて環境変数から取るので、値を
// ハードコードする必要はありません。
//
// マイグレーションが対象とする DB は、アプリ本体（server/config/db.js）が
// 接続している DB と必ず同一にしてください。ずれていると
// 「migrate は成功したのにカラムが無い」になります。
'use strict';

const path = require('path');

// server.js と同じ規則で .env を読む（NODE_ENV=production → .env.production）
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
require('dotenv').config({ path: path.join(__dirname, '..', envFile) });

const dbConfig = (env) => ({
  username: env.MYSQL_USER || env.DB_USER || 'root',
  password: env.MYSQL_PASSWORD || env.DB_PASSWORD || '',
  database: env.MYSQL_DATABASE || env.DB_NAME || 'safevideo',
  host: env.MYSQL_HOST || env.DB_HOST || '127.0.0.1',
  port: Number(env.MYSQL_PORT || env.DB_PORT || 3306),
  dialect: 'mysql',
  // MySQL が IPv6 で待ち受けていない環境で ECONNREFUSED ::1 を避ける
  dialectOptions: {
    connectTimeout: Number(env.DB_CONNECT_TIMEOUT_MS || 60000)
  },
  logging: false
});

module.exports = {
  development: dbConfig(process.env),
  test: dbConfig({
    ...process.env,
    MYSQL_DATABASE: process.env.TEST_DB_NAME || process.env.TEST_MYSQL_DATABASE || 'safevideo_test'
  }),
  production: {
    ...dbConfig(process.env),
    // 本番ではマイグレーションのみをスキーマ変更手段とする
    seederStorage: 'sequelize',
    migrationStorageTableName: 'SequelizeMeta'
  }
};
