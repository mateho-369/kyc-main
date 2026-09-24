// DB無効時のダミーモデル
if (process.env.DISABLE_DB === 'true') {
  class User {
    static async findOne(options) {
      if (options.where?.email === 'test@example.com') {
        return {
          id: 1,
          email: 'test@example.com',
          name: 'Test User',
          firebaseUid: 'test-uid',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
      return null;
    }

    static async create(userData) {
      return {
        id: Math.floor(Math.random() * 1000),
        ...userData,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }

    static async update(values, options) {
      return [1];
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
