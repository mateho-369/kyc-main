'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('KYCRequests', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      performerId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Performers',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      sharegramIntegrationId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'SharegramIntegrations',
          key: 'id'
        }
      },
      requestType: {
        type: Sequelize.ENUM('initial', 'update', 're-verification'),
        allowNull: false,
        defaultValue: 'initial'
      },
      status: {
        type: Sequelize.ENUM('draft', 'submitted', 'in_review', 'approved', 'rejected', 'expired'),
        allowNull: false,
        defaultValue: 'draft'
      },
      submittedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      reviewedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      reviewedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        }
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      documentData: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: {
          idDocument: {
            type: null,
            frontImage: null,
            backImage: null,
            number: null,
            expiryDate: null,
            issuingCountry: null
          },
          addressProof: {
            type: null,
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
        type: Sequelize.JSON,
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
    await queryInterface.addIndex('KYCRequests', ['performerId'], {
      name: 'idx_kyc_requests_performer'
    });
    await queryInterface.addIndex('KYCRequests', ['status'], {
      name: 'idx_kyc_requests_status'
    });
    await queryInterface.addIndex('KYCRequests', ['sharegramIntegrationId'], {
      name: 'idx_kyc_requests_integration'
    });
    await queryInterface.addIndex('KYCRequests', ['submittedAt'], {
      name: 'idx_kyc_requests_submitted'
    });
    await queryInterface.addIndex('KYCRequests', ['expiresAt'], {
      name: 'idx_kyc_requests_expires'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('KYCRequests');
  }
};