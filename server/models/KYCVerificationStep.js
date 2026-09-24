const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const KYCVerificationStep = sequelize.define('KYCVerificationStep', {
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
  stepType: {
    type: DataTypes.ENUM(
      'document_upload',
      'document_verification',
      'face_matching',
      'address_verification',
      'sharegram_verification',
      'manual_review',
      'final_approval'
    ),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'failed', 'skipped'),
    allowNull: false,
    defaultValue: 'pending'
  },
  startedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  performedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    },
    comment: 'User ID who performed manual steps'
  },
  automatedSystem: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Name of the automated system that performed this step'
  },
  result: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      success: null,
      score: null,
      details: {},
      issues: []
    }
  },
  sharegramData: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      requestId: null,
      responseId: null,
      verificationCode: null,
      rawResponse: {}
    }
  },
  retryCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  maxRetries: {
    type: DataTypes.INTEGER,
    defaultValue: 3,
    allowNull: false
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  }
}, {
  tableName: 'KYCVerificationSteps',
  timestamps: true,
  indexes: [
    {
      name: 'idx_kyc_steps_request',
      fields: ['kycRequestId']
    },
    {
      name: 'idx_kyc_steps_type',
      fields: ['stepType']
    },
    {
      name: 'idx_kyc_steps_status',
      fields: ['status']
    },
    {
      name: 'idx_kyc_steps_performed_by',
      fields: ['performedBy']
    }
  ]
});

// Associations
KYCVerificationStep.associate = function(models) {
  KYCVerificationStep.belongsTo(models.KYCRequest, {
    foreignKey: 'kycRequestId',
    as: 'kycRequest'
  });
  KYCVerificationStep.belongsTo(models.User, {
    foreignKey: 'performedBy',
    as: 'performedByUser'
  });
};

// Instance methods
KYCVerificationStep.prototype.start = async function(performerId = null, system = null) {
  if (this.status !== 'pending') {
    throw new Error('Only pending steps can be started');
  }
  
  this.status = 'in_progress';
  this.startedAt = new Date();
  this.performedBy = performerId;
  this.automatedSystem = system;
  await this.save();
};

KYCVerificationStep.prototype.complete = async function(result) {
  if (this.status !== 'in_progress') {
    throw new Error('Only in-progress steps can be completed');
  }
  
  this.status = 'completed';
  this.completedAt = new Date();
  this.result = {
    ...this.result,
    ...result,
    success: true
  };
  await this.save();
};

KYCVerificationStep.prototype.fail = async function(reason, details = {}) {
  if (this.status !== 'in_progress') {
    throw new Error('Only in-progress steps can be failed');
  }
  
  this.status = 'failed';
  this.completedAt = new Date();
  this.result = {
    ...this.result,
    success: false,
    failureReason: reason,
    details
  };
  await this.save();
};

KYCVerificationStep.prototype.retry = async function() {
  if (this.retryCount >= this.maxRetries) {
    throw new Error('Maximum retry attempts exceeded');
  }
  
  this.status = 'pending';
  this.retryCount += 1;
  this.startedAt = null;
  this.completedAt = null;
  this.result = {
    success: null,
    score: null,
    details: {},
    issues: []
  };
  await this.save();
};

KYCVerificationStep.prototype.skip = async function(reason) {
  this.status = 'skipped';
  this.completedAt = new Date();
  this.notes = reason;
  await this.save();
};

// Class methods
KYCVerificationStep.createWorkflow = async function(kycRequestId) {
  const steps = [
    { kycRequestId, stepType: 'document_upload', status: 'pending' },
    { kycRequestId, stepType: 'document_verification', status: 'pending' },
    { kycRequestId, stepType: 'face_matching', status: 'pending' },
    { kycRequestId, stepType: 'address_verification', status: 'pending' },
    { kycRequestId, stepType: 'sharegram_verification', status: 'pending' },
    { kycRequestId, stepType: 'manual_review', status: 'pending' },
    { kycRequestId, stepType: 'final_approval', status: 'pending' }
  ];
  
  return await this.bulkCreate(steps);
};

KYCVerificationStep.getNextPendingStep = async function(kycRequestId) {
  return await this.findOne({
    where: {
      kycRequestId,
      status: 'pending'
    },
    order: [['createdAt', 'ASC']]
  });
};

KYCVerificationStep.getWorkflowStatus = async function(kycRequestId) {
  const steps = await this.findAll({
    where: { kycRequestId },
    order: [['createdAt', 'ASC']]
  });
  
  const totalSteps = steps.length;
  const completedSteps = steps.filter(s => s.status === 'completed').length;
  const failedSteps = steps.filter(s => s.status === 'failed').length;
  const inProgressSteps = steps.filter(s => s.status === 'in_progress').length;
  
  return {
    totalSteps,
    completedSteps,
    failedSteps,
    inProgressSteps,
    progressPercentage: Math.round((completedSteps / totalSteps) * 100),
    currentStep: steps.find(s => s.status === 'in_progress' || s.status === 'pending'),
    steps
  };
};

module.exports = KYCVerificationStep;