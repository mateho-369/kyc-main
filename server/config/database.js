const { Sequelize } = require('sequelize');
require('dotenv').config();

// 環境変数から接続情報を取得（環境変数名を統一）
const DB_HOST = process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.MYSQL_PORT || process.env.DB_PORT || 3306;
const DB_NAME = process.env.MYSQL_DATABASE || process.env.DB_NAME || 'safevideo';
const DB_USER = process.env.MYSQL_USER || process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '';

console.log('データベース接続試行:', `${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);

// sequelizeインスタンスを作成
const sequelize = new Sequelize(
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  {
    host: DB_HOST,
    dialect: 'mysql',
    port: DB_PORT,
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    // 接続が切れたときに自動的に再接続
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    // クエリタイムアウト設定
    dialectOptions: {
      connectTimeout: 60000
    }
  }
);

// データベース接続関数
const connectDB = async () => {
  let retries = 5;
  
  while (retries) {
    try {
      await sequelize.authenticate();
      console.log('MySQL接続成功');
      
      // 開発環境ではテーブルを自動同期
      if (process.env.NODE_ENV === 'development') {
        await sequelize.sync({ alter: true });
        console.log('データベーステーブルが同期されました');
      }
      return true;
    } catch (err) {
      retries -= 1;
      console.error(`MySQL接続エラー (残り試行回数: ${retries}):`, err);
      
      if (retries === 0) {
        console.error('最大試行回数に達しました。プロセスを終了します。');
        process.exit(1);
      }
      
      // 5秒待機してから再試行
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// モデルを初期化する関数
const initializeModels = () => {
  // モデルの定義は後で行う
  return sequelize;
};

module.exports = { 
  sequelize, 
  connectDB,
  initializeModels,
  Sequelize
};