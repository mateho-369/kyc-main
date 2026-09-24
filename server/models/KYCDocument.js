const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const KYCDocument = sequelize.define('KYCDocument', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  kycRequestId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'KYCRequests',
      key: 'id'
    },
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE'
  },
  documentType: {
    type: DataTypes.ENUM(
      'id_front',
      'id_back',
      'passport',
      'drivers_license',
      'selfie',
      'selfie_with_id',
      'address_proof',
      'bank_statement',
      'utility_bill'
    ),
    allowNull: false
  },
  filePath: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  mimeType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  hash: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'SHA256 hash of the file for integrity verification'
  },
  verificationStatus: {
    type: DataTypes.ENUM('pending', 'verified', 'rejected', 'tampered'),
    defaultValue: 'pending',
    allowNull: false
  },
  verificationDetails: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      ocrData: null,
      faceDetection: null,
      documentAuthenticity: null,
      exifData: null,
      sharegramAnalysis: null
    }
  },
  extractedData: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {},
    comment: 'OCR extracted data from documents'
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      uploadIp: null,
      userAgent: null,
      uploadTimestamp: null,
      geoLocation: null
    }
  }
}, {
  tableName: 'KYCDocuments',
  timestamps: true,
  indexes: [
    {
      name: 'idx_kyc_documents_request',
      fields: ['kycRequestId']
    },
    {
      name: 'idx_kyc_documents_type',
      fields: ['documentType']
    },
    {
      name: 'idx_kyc_documents_hash',
      fields: ['hash'],
      unique: true
    },
    {
      name: 'idx_kyc_documents_status',
      fields: ['verificationStatus']
    }
  ]
});

// Associations
KYCDocument.associate = function(models) {
  KYCDocument.belongsTo(models.KYCRequest, {
    foreignKey: 'kycRequestId',
    as: 'kycRequest'
  });
};

// Instance methods
KYCDocument.prototype.verify = async function(details = {}) {
  this.verificationStatus = 'verified';
  this.verificationDetails = {
    ...this.verificationDetails,
    ...details,
    verifiedAt: new Date()
  };
  await this.save();
};

KYCDocument.prototype.reject = async function(reason, details = {}) {
  this.verificationStatus = 'rejected';
  this.verificationDetails = {
    ...this.verificationDetails,
    ...details,
    rejectionReason: reason,
    rejectedAt: new Date()
  };
  await this.save();
};

KYCDocument.prototype.markAsTampered = async function(details = {}) {
  this.verificationStatus = 'tampered';
  this.verificationDetails = {
    ...this.verificationDetails,
    ...details,
    tamperedAt: new Date()
  };
  await this.save();
};

// Class methods
KYCDocument.getDocumentsForRequest = async function(kycRequestId) {
  return await this.findAll({
    where: { kycRequestId },
    order: [['documentType', 'ASC']]
  });
};

KYCDocument.checkDocumentIntegrity = async function(documentId, currentHash) {
  const document = await this.findByPk(documentId);
  if (!document) {
    throw new Error('Document not found');
  }
  
  if (document.hash !== currentHash) {
    await document.markAsTampered({ 
      originalHash: document.hash, 
      currentHash,
      detectedAt: new Date()
    });
    return false;
  }
  
  return true;
};

module.exports = KYCDocument;