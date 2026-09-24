const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const KYCRequest = sequelize.define('KYCRequest', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  performerId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      // Performer モデルの実テーブルは小文字の performers（models/Performer.js の tableName）
      model: 'performers',
      key: 'id'
    },
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  },
  sharegramIntegrationId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'SharegramIntegrations',
      key: 'id'
    }
  },
  requestType: {
    type: DataTypes.ENUM('initial', 'update', 're-verification'),
    allowNull: false,
    defaultValue: 'initial'
  },
  status: {
    type: DataTypes.ENUM('draft', 'submitted', 'in_review', 'approved', 'rejected', 'expired'),
    allowNull: false,
    defaultValue: 'draft'
  },
  submittedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reviewedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reviewedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  documentData: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {
      idDocument: {
        type: null, // 'passport', 'drivers_license', 'national_id'
        frontImage: null,
        backImage: null,
        number: null,
        expiryDate: null,
        issuingCountry: null
      },
      addressProof: {
        type: null, // 'utility_bill', 'bank_statement', 'rental_agreement'
        documentImage: null,
        issueDate: null
      },
      selfie: {
        image: null,
        withIdDocument: false,
        timestamp: null
      }
    }
  },
  verificationResults: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      documentVerification: {
        status: null,
        score: null,
        issues: []
      },
      faceMatch: {
        status: null,
        confidence: null,
        issues: []
      },
      addressVerification: {
        status: null,
        issues: []
      },
      sharegramVerification: {
        verificationId: null,
        status: null,
        details: {}
      }
    }
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  }
}, {
  tableName: 'KYCRequests',
  timestamps: true,
  indexes: [
    {
      name: 'idx_kyc_requests_performer',
      fields: ['performerId']
    },
    {
      name: 'idx_kyc_requests_status',
      fields: ['status']
    },
    {
      name: 'idx_kyc_requests_integration',
      fields: ['sharegramIntegrationId']
    },
    {
      name: 'idx_kyc_requests_submitted',
      fields: ['submittedAt']
    },
    {
      name: 'idx_kyc_requests_expires',
      fields: ['expiresAt']
    }
  ]
});

// Associations will be defined in index.js
KYCRequest.associate = function(models) {
  KYCRequest.belongsTo(models.Performer, {
    foreignKey: 'performerId',
    as: 'performer'
  });
  KYCRequest.belongsTo(models.SharegramIntegration, {
    foreignKey: 'sharegramIntegrationId',
    as: 'sharegramIntegration'
  });
  KYCRequest.belongsTo(models.User, {
    foreignKey: 'reviewedBy',
    as: 'reviewer'
  });
  KYCRequest.hasMany(models.KYCDocument, {
    foreignKey: 'kycRequestId',
    as: 'documents'
  });
  KYCRequest.hasMany(models.KYCVerificationStep, {
    foreignKey: 'kycRequestId',
    as: 'verificationSteps'
  });
};

// Instance methods
KYCRequest.prototype.submit = async function() {
  if (this.status !== 'draft') {
    throw new Error('Only draft KYC requests can be submitted');
  }
  
  this.status = 'submitted';
  this.submittedAt = new Date();
  await this.save();
};

KYCRequest.prototype.approve = async function(reviewerId) {
  if (this.status !== 'in_review') {
    throw new Error('Only requests in review can be approved');
  }
  
  this.status = 'approved';
  this.reviewedAt = new Date();
  this.reviewedBy = reviewerId;
  await this.save();
};

KYCRequest.prototype.reject = async function(reviewerId, reason) {
  if (this.status !== 'in_review') {
    throw new Error('Only requests in review can be rejected');
  }
  
  this.status = 'rejected';
  this.reviewedAt = new Date();
  this.reviewedBy = reviewerId;
  this.rejectionReason = reason;
  await this.save();
};

KYCRequest.prototype.isExpired = function() {
  return this.expiresAt && new Date() > this.expiresAt;
};

// Class methods
KYCRequest.getPendingRequests = async function() {
  return await this.findAll({
    where: {
      status: 'submitted'
    },
    order: [['submittedAt', 'ASC']]
  });
};

KYCRequest.getActiveRequestForPerformer = async function(performerId) {
  return await this.findOne({
    where: {
      performerId,
      status: ['draft', 'submitted', 'in_review', 'approved']
    },
    order: [['createdAt', 'DESC']]
  });
};

module.exports = KYCRequest;