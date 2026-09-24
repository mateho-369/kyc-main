const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Performer = sequelize.define('Performer', {
  lastName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lastNameRoman: {
    type: DataTypes.STRING,
    allowNull: false
  },
  firstNameRoman: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // ドキュメント情報はJSONとして保存
  documents: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  // ステータス
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'pending', 'rejected'),
    defaultValue: 'pending'
  },
  // メモ（内部用）
  notes: {
    type: DataTypes.TEXT
  },
  // KYC specific fields
  kycStatus: {
    type: DataTypes.ENUM('not_started', 'in_progress', 'verified', 'rejected', 'expired'),
    defaultValue: 'not_started',
    allowNull: false
  },
  kycVerifiedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  kycExpiresAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  birthDate: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  nationality: {
    type: DataTypes.STRING(2),
    allowNull: true,
    comment: 'ISO 3166-1 alpha-2 country code'
  },
  address: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      street: null,
      city: null,
      state: null,
      postalCode: null,
      country: null
    }
  },
  phoneNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  sharegramUserId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'External user ID in Sharegram system'
  },
  external_id: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true,
    comment: 'External system identifier (e.g., Sharagram performer ID)'
  },
  riskScore: {
    type: DataTypes.FLOAT,
    allowNull: true,
    defaultValue: null,
    comment: 'Risk assessment score from KYC verification'
  },
  kycMetadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  }
}, {
  // 実データは小文字の performers に入っている。tableName を省くと Sequelize が
  // 'Performer' を複数形化して Performers を見に行き、既存22件が見えなくなる。
  // （NODE_ENV=development 時の sync({alter:true}) が空の Performers を生成していた）
  tableName: 'performers',
  timestamps: true,
  indexes: [
    {
      name: 'idx_performers_kyc_status',
      fields: ['kycStatus']
    },
    {
      name: 'idx_performers_sharegram_user_id',
      fields: ['sharegramUserId']
    },
    {
      name: 'idx_performers_kyc_expires_at',
      fields: ['kycExpiresAt']
    }
  ]
});

// Instance methods
Performer.prototype.needsKYC = function() {
  return this.kycStatus === 'not_started' || 
         this.kycStatus === 'expired' ||
         (this.kycStatus === 'verified' && this.kycExpiresAt && new Date() > this.kycExpiresAt);
};

Performer.prototype.isKYCValid = function() {
  return this.kycStatus === 'verified' && 
         (!this.kycExpiresAt || new Date() <= this.kycExpiresAt);
};

Performer.prototype.updateKYCStatus = async function(status, additionalData = {}) {
  this.kycStatus = status;
  
  if (status === 'verified') {
    this.kycVerifiedAt = new Date();
    // Set expiration to 1 year from verification
    const expirationDate = new Date();
    expirationDate.setFullYear(expirationDate.getFullYear() + 1);
    this.kycExpiresAt = expirationDate;
  }
  
  if (additionalData.riskScore !== undefined) {
    this.riskScore = additionalData.riskScore;
  }
  
  if (additionalData.metadata) {
    this.kycMetadata = { ...this.kycMetadata, ...additionalData.metadata };
  }
  
  await this.save();
};

// Associations
Performer.associate = function(models) {
  if (models.User) {
    Performer.belongsTo(models.User, { 
      foreignKey: 'userId' 
    });
  }
  if (models.KYCRequest) {
    Performer.hasMany(models.KYCRequest, { 
      foreignKey: 'performerId', 
      as: 'kycRequests' 
    });
  }
};

module.exports = Performer;