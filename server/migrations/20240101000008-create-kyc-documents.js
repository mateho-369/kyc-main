'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('KYCDocuments', {
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
      documentType: {
        type: Sequelize.ENUM(
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
        type: Sequelize.STRING,
        allowNull: false
      },
      fileName: {
        type: Sequelize.STRING,
        allowNull: false
      },
      fileSize: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      mimeType: {
        type: Sequelize.STRING,
        allowNull: false
      },
      hash: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'SHA256 hash of the file for integrity verification'
      },
      verificationStatus: {
        type: Sequelize.ENUM('pending', 'verified', 'rejected', 'tampered'),
        defaultValue: 'pending',
        allowNull: false
      },
      verificationDetails: {
        type: Sequelize.JSON,
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
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: {},
        comment: 'OCR extracted data from documents'
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: {
          uploadIp: null,
          userAgent: null,
          uploadTimestamp: null,
          geoLocation: null
        }
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
    await queryInterface.addIndex('KYCDocuments', ['kycRequestId'], {
      name: 'idx_kyc_documents_request'
    });
    await queryInterface.addIndex('KYCDocuments', ['documentType'], {
      name: 'idx_kyc_documents_type'
    });
    await queryInterface.addIndex('KYCDocuments', ['hash'], {
      name: 'idx_kyc_documents_hash',
      unique: true
    });
    await queryInterface.addIndex('KYCDocuments', ['verificationStatus'], {
      name: 'idx_kyc_documents_status'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('KYCDocuments');
  }
};