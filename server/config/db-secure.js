const { Sequelize } = require('sequelize');
const crypto = require('crypto');
require('dotenv').config();

// 環境変数の暗号化/復号化クラス
class SecureConfig {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.secretKey = process.env.DB_ENCRYPTION_KEY || this.generateKey();
  }

  generateKey() {
    // 本番環境では必ず環境変数から取得すること
    console.warn('警告: DB_ENCRYPTION_KEYが設定されていません。自動生成されたキーを使用します。');
    return crypto.randomBytes(32).toString('hex');
  }

  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, Buffer.from(this.secretKey, 'hex'), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  decrypt(encryptedData) {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(this.algorithm, Buffer.from(this.secretKey, 'hex'), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

const secureConfig = new SecureConfig();

// セキュアなデータベース接続設定
const getSecureDbConfig = () => {
  // 環境変数から暗号化された値を取得
  const encryptedPassword = process.env.DB_PASSWORD_ENCRYPTED;
  
  // パスワードの復号化（暗号化されている場合）
  const dbPassword = encryptedPassword 
    ? secureConfig.decrypt(encryptedPassword)
    : process.env.DB_PASSWORD || '';

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'safevideo',
    username: process.env.DB_USER || 'root',
    password: dbPassword,
    dialect: 'mysql',
    dialectOptions: {
      ssl: process.env.NODE_ENV === 'production' ? {
        require: true,
        rejectUnauthorized: true,
        ca: process.env.DB_SSL_CA // CA証明書
      } : false,
      connectTimeout: 60000,
      // 追加のセキュリティオプション
      flags: ['+LOCAL_INFILE'],
      multipleStatements: false // SQLインジェクション対策
    },
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '5'),
      min: parseInt(process.env.DB_POOL_MIN || '0'),
      acquire: 30000,
      idle: 10000,
      evict: 60000
    },
    logging: process.env.NODE_ENV === 'development' && process.env.DB_LOGGING === 'true' 
      ? console.log 
      : false,
    benchmark: process.env.NODE_ENV === 'development',
    define: {
      timestamps: true,
      underscored: false,
      freezeTableName: false,
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci'
    },
    // セキュリティ強化オプション
    retry: {
      max: 3,
      timeout: 30000,
      match: [
        /ETIMEDOUT/,
        /EHOSTUNREACH/,
        /ECONNRESET/,
        /ECONNREFUSED/,
        /ETIMEDOUT/,
        /ESOCKETTIMEDOUT/,
        /EHOSTUNREACH/,
        /EPIPE/,
        /EAI_AGAIN/
      ]
    }
  };
};

// Sequelizeインスタンスの作成
const dbConfig = getSecureDbConfig();
const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  dbConfig
);

// セキュアな接続関数
const connectDB = async () => {
  let retries = 5;
  
  while (retries) {
    try {
      // 接続前のセキュリティチェック
      if (process.env.NODE_ENV === 'production' && !process.env.DB_ENCRYPTION_KEY) {
        throw new Error('本番環境ではDB_ENCRYPTION_KEYの設定が必須です');
      }

      await sequelize.authenticate();
      console.log('MySQL接続成功（セキュア接続）');
      
      // 本番環境ではマイグレーションを使用
      if (process.env.NODE_ENV === 'development' && process.env.DB_SYNC === 'true') {
        await sequelize.sync({ alter: true });
        console.log('データベーステーブルが同期されました');
      }
      
      // 接続成功時のセキュリティ設定
      await sequelize.query("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");
      
      return true;
    } catch (err) {
      retries -= 1;
      console.error(`MySQL接続エラー (残り試行回数: ${retries}):`, err.message);
      
      // エラー内容をサニタイズ（パスワード等の機密情報を除去）
      const sanitizedError = err.message.replace(/password=\S+/gi, 'password=***');
      console.error('詳細:', sanitizedError);
      
      if (retries === 0) {
        console.error('最大試行回数に達しました。プロセスを終了します。');
        process.exit(1);
      }
      
      // バックオフ戦略で待機
      const waitTime = (6 - retries) * 5000; // 5秒、10秒、15秒...
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
};

// 接続プールの監視
sequelize.connectionManager.pool.on('acquire', (connection) => {
  console.log('接続プールから接続を取得:', connection.threadId);
});

sequelize.connectionManager.pool.on('release', (connection) => {
  console.log('接続プールに接続を返却:', connection.threadId);
});

module.exports = { 
  sequelize, 
  connectDB,
  secureConfig,
  getSecureDbConfig
};