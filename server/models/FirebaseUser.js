const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const FirebaseUser = sequelize.define('FirebaseUser', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  firebaseUid: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      isEmail: true
    }
  },
  displayName: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  photoURL: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: {
      isUrl: true
    }
  },
  phoneNumber: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: {
      is: /^\+?[1-9]\d{1,14}$/  // E.164形式
    }
  },
  providerId: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'google.com, apple.com, password, etc.'
  },
  emailVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  disabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  customClaims: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  },
  firebaseMetadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {},
    comment: 'lastSignInTime, creationTime, etc.'
  },
  lastSyncedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'FirebaseUsers',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['firebaseUid']
    },
    {
      fields: ['userId']
    },
    {
      fields: ['email']
    },
    {
      fields: ['providerId']
    }
  ]
});

// インスタンスメソッド
FirebaseUser.prototype.syncWithLocalUser = async function() {
  if (!this.userId) {
    // ローカルユーザーを検索または作成
    const User = require('./User');
    const [user, created] = await User.findOrCreate({
      where: { email: this.email },
      defaults: {
        email: this.email,
        name: this.displayName || this.email.split('@')[0],
        password: 'FIREBASE_AUTH', // Firebase認証を示す特別な値
        authProvider: 'firebase',
        firebaseUid: this.firebaseUid,
        emailVerified: this.emailVerified
      }
    });

    if (!created && !user.firebaseUid) {
      // 既存ユーザーにFirebase情報を追加
      await user.update({
        firebaseUid: this.firebaseUid,
        authProvider: 'firebase',
        emailVerified: this.emailVerified
      });
    }

    this.userId = user.id;
    await this.save();
    return user;
  }
  return null;
};

FirebaseUser.prototype.updateFromFirebase = async function(firebaseUserRecord) {
  this.email = firebaseUserRecord.email || this.email;
  this.displayName = firebaseUserRecord.displayName || this.displayName;
  this.photoURL = firebaseUserRecord.photoURL || this.photoURL;
  this.phoneNumber = firebaseUserRecord.phoneNumber || this.phoneNumber;
  this.emailVerified = firebaseUserRecord.emailVerified;
  this.disabled = firebaseUserRecord.disabled;
  
  if (firebaseUserRecord.providerData && firebaseUserRecord.providerData.length > 0) {
    this.providerId = firebaseUserRecord.providerData[0].providerId;
  }
  
  this.firebaseMetadata = {
    lastSignInTime: firebaseUserRecord.metadata.lastSignInTime,
    creationTime: firebaseUserRecord.metadata.creationTime,
    lastRefreshTime: firebaseUserRecord.metadata.lastRefreshTime
  };
  
  this.customClaims = firebaseUserRecord.customClaims || {};
  this.lastSyncedAt = new Date();
  
  await this.save();
};

// クラスメソッド
FirebaseUser.findByFirebaseUid = async function(firebaseUid) {
  return await this.findOne({
    where: { firebaseUid },
    include: [{
      model: sequelize.models.User,
      as: 'localUser'
    }]
  });
};

FirebaseUser.syncBatchFromFirebase = async function(firebaseUsers) {
  const results = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: []
  };

  for (const fbUser of firebaseUsers) {
    try {
      const [user, created] = await this.findOrCreate({
        where: { firebaseUid: fbUser.uid },
        defaults: {
          firebaseUid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName,
          photoURL: fbUser.photoURL,
          phoneNumber: fbUser.phoneNumber,
          emailVerified: fbUser.emailVerified,
          disabled: fbUser.disabled,
          providerId: fbUser.providerData?.[0]?.providerId,
          customClaims: fbUser.customClaims || {},
          firebaseMetadata: {
            lastSignInTime: fbUser.metadata.lastSignInTime,
            creationTime: fbUser.metadata.creationTime
          }
        }
      });

      if (created) {
        results.created++;
        await user.syncWithLocalUser();
      } else {
        await user.updateFromFirebase(fbUser);
        results.updated++;
      }
    } catch (error) {
      results.failed++;
      results.errors.push({
        firebaseUid: fbUser.uid,
        error: error.message
      });
    }
  }

  return results;
};

module.exports = FirebaseUser;