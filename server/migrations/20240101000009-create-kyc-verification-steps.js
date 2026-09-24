'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('KYCVerificationSteps', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      kycRequestId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'KYCRequests',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      stepType: {
        type: Sequelize.ENUM(
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
        type: Sequelize.ENUM('pending', 'in_progress', 'completed', 'failed', 'skipped'),
        allowNull: false,
        defaultValue: 'pending'
      },
      startedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      completedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      performedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        comment: 'User ID who performed manual steps'
      },
      automatedSystem: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Name of the automated system that performed this step'
      },
      result: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: {
          success: null,
          score: null,
          details: {},
          issues: []
        }
      },
      sharegramData: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: {
          requestId: null,
          responseId: null,
          verificationCode: null,
          rawResponse: {}
        }
      },
      retryCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      maxRetries: {
        type: Sequelize.INTEGER,
        defaultValue: 3,
        allowNull: false
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: {}
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // Add indexes
    await queryInterface.addIndex('KYCVerificationSteps', ['kycRequestId'], {
      name: 'idx_kyc_steps_request'
    });
    await queryInterface.addIndex('KYCVerificationSteps', ['stepType'], {
      name: 'idx_kyc_steps_type'
    });
    await queryInterface.addIndex('KYCVerificationSteps', ['status'], {
      name: 'idx_kyc_steps_status'
    });
    await queryInterface.addIndex('KYCVerificationSteps', ['performedBy'], {
      name: 'idx_kyc_steps_performed_by'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('KYCVerificationSteps');
  }
};