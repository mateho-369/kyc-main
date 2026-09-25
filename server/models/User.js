// DB無効時のダミーモデル
//
// 【重要】かつてここは findOne({where:{email:'test@example.com'}}) に対して
// {id:1, name:'Test User'} を返していた。その結果、Sharegram SSO は
// 「成功」したように見せかけ、ダッシュボードは常に同じ Test User を表示した。
// 実データの検証ができないときに偽の身元を返すのは危険なため、
// ここでは身元を作らず、明示的に失敗させる。
if (process.env.DISABLE_DB === 'true') {
  const DISABLED = new Error(
    'DATABASE_DISABLED: DISABLE_DB=true のためユーザーを永続化できません。'
    + ' Sharegram SSO には MySQL が必要です（DB接続設定を行い、DISABLE_DB を外して再起動してください）'
  );

  class User {
    static async findOne() {
      // 存在しないユーザーは null を返す（＝SSO側は新規作成を試み、失敗する）
      return null;
    }

    static async findAll() {
      return [];
    }

    static async count() {
      return 0;
    }

    static async create() {
      throw DISABLED;
    }

    static async update() {
      throw DISABLED;
    }

    static async destroy() {
      throw DISABLED;
    }
  }

  module.exports = User;
} else {
  const { DataTypes } = require('sequelize');
  const { sequelize } = require('../config/db');
  const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'user'),
    defaultValue: 'user'
  },
  // Firebase認証統合フィールド（CEOミッション第2段階）
  sharegramUserId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lastLoginAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  authProvider: {
    type: DataTypes.ENUM('jwt', 'firebase', 'hybrid'),
    defaultValue: 'jwt'
  },
  firebaseUid: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true
  },
  emailVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // Sharegram/Firebase から取得したプロフィール画像（SSOで同期）
  profilePicture: {
    type: DataTypes.STRING(512),
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  failedLoginAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  isLocked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  lockedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  timestamps: true
});

// パスワードハッシュ化のフック
User.beforeCreate(async (user) => {
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(user.password, salt);
});

// パスワード検証メソッド
User.prototype.matchPassword = async function(enteredPassword) {
  // 通常のパスワード検証
  return await bcrypt.compare(enteredPassword, this.password);
};

// Associations
User.associate = function(models) {
  User.hasMany(models.Performer, { 
    foreignKey: 'userId' 
  });
  User.hasMany(models.AuditLog, { 
    foreignKey: 'userId' 
  });
  User.hasMany(models.SharegramIntegration, { 
    foreignKey: 'userId' 
  });
  User.hasMany(models.KYCRequest, { 
    foreignKey: 'reviewedBy', 
    as: 'reviewedKycRequests' 
  });
  User.hasMany(models.KYCVerificationStep, { 
    foreignKey: 'performedBy', 
    as: 'performedVerificationSteps' 
  });
};

module.exports = User;
}
