'use strict';

/**
 * sequelize-cli 用設定（db:migrate / db:seed など）。
 *
 * 【このファイルに認証情報は書かない】接続情報は server/.env から読む。
 * 以前ここはリポジトリに含まれないマシンローカルファイルで、
 * 「クリーンな clone では db:migrate が一度も実行できない」
 * 「`config.json` が無い」というエラーの原因になっていた（実物消失済み）。
 * 追跡して環境変数駆動にすることで、CLI とアプリが必ず同じ DB を
 * 見るようにする（ズレると「migrate したのにカラムが無い」になる）。
 *
 * 読み込みは server.js と同じ規則。選んだファイルが無い場合だけ
 * もう一方にフォールバックする（dotenv は既存の値を上書きしないので、
 * 先に読んだ .env 側の値が優先される）。
 */

const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..');
const preferred = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const fallback = preferred === '.env.production' ? '.env' : '.env.production';

const loaded = [];
[preferred, fallback].forEach((name) => {
  const file = path.join(SERVER_DIR, name);
  if (fs.existsSync(file)) {
    // eslint-disable-next-line global-require
    require('dotenv').config({ path: file });
    if (!loaded.includes(name)) loaded.push(name);
  }
});

// server/config/db.js とまったく同じ優先順位で解決する。
// ここだけ変えるとアプリとCLIが別DBを向くので、必ず両方を直すこと。
const resolve = (env) => ({
  username: env.MYSQL_USER || env.DB_USER || 'root',
  password: env.MYSQL_PASSWORD || env.DB_PASSWORD || '',
  database: env.MYSQL_DATABASE || env.DB_NAME || 'safevideo',
  host: env.MYSQL_HOST || env.DB_HOST || 'localhost',
  port: Number(env.MYSQL_PORT || env.DB_PORT || 3306),
  dialect: 'mysql',
  dialectOptions: {
    connectTimeout: Number(env.DB_CONNECT_TIMEOUT_MS || 60000)
  },
  logging: false
});

const build = (env, extra = {}) => ({
  ...resolve(env),
  // sequelize-cli は these を env ブロック側から読む。ルートを残しつつ両方に置く。
  migrationStorageTableName: 'SequelizeMeta',
  seederStorage: 'sequelize',
  ...extra
});

module.exports = {
  development: build(process.env),
  test: build({ ...process.env, MYSQL_DATABASE: process.env.TEST_DB_NAME || 'safevideo_test' }),
  production: build(process.env),
  // マイグレーション履歴は既定のテーブル名。明示しておくdeploy事故防止
  migrationStorageTableName: 'SequelizeMeta',
  seederStorage: 'sequelize',
  // 参考: どの .env を読んだか（CLI のエラーログに残しやすくする）
  loadedEnvFiles: loaded
};
