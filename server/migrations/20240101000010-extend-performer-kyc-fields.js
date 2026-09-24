'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add KYC-specific columns to Performers table
    await queryInterface.addColumn('Performers', 'kycStatus', {
      type: Sequelize.ENUM('not_started', 'in_progress', 'verified', 'rejected', 'expired'),
      defaultValue: 'not_started',
      allowNull: false
    });

    await queryInterface.addColumn('Performers', 'kycVerifiedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('Performers', 'kycExpiresAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('Performers', 'birthDate', {
      type: Sequelize.DATEONLY,
      allowNull: true
    });

    await queryInterface.addColumn('Performers', 'nationality', {
      type: Sequelize.STRING(2),
      allowNull: true,
      comment: 'ISO 3166-1 alpha-2 country code'
    });

    await queryInterface.addColumn('Performers', 'address', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: {
        street: null,
        city: null,
        state: null,
        postalCode: null,
        country: null
      }
    });

    await queryInterface.addColumn('Performers', 'phoneNumber', {
      type: Sequelize.STRING,
      allowNull: true
    });

    await queryInterface.addColumn('Performers', 'sharegramUserId', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'External user ID in Sharegram system'
    });

    await queryInterface.addColumn('Performers', 'riskScore', {
      type: Sequelize.FLOAT,
      allowNull: true,
      defaultValue: null,
      comment: 'Risk assessment score from KYC verification'
    });

    await queryInterface.addColumn('Performers', 'kycMetadata', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: {}
    });

    // Add indexes for the new columns
    await queryInterface.addIndex('Performers', ['kycStatus'], {
      name: 'idx_performers_kyc_status'
    });

    await queryInterface.addIndex('Performers', ['sharegramUserId'], {
      name: 'idx_performers_sharegram_user_id'
    });

    await queryInterface.addIndex('Performers', ['kycExpiresAt'], {
      name: 'idx_performers_kyc_expires_at'
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Remove indexes
    await queryInterface.removeIndex('Performers', 'idx_performers_kyc_status');
    await queryInterface.removeIndex('Performers', 'idx_performers_sharegram_user_id');
    await queryInterface.removeIndex('Performers', 'idx_performers_kyc_expires_at');

    // Remove columns
    await queryInterface.removeColumn('Performers', 'kycStatus');
    await queryInterface.removeColumn('Performers', 'kycVerifiedAt');
    await queryInterface.removeColumn('Performers', 'kycExpiresAt');
    await queryInterface.removeColumn('Performers', 'birthDate');
    await queryInterface.removeColumn('Performers', 'nationality');
    await queryInterface.removeColumn('Performers', 'address');
    await queryInterface.removeColumn('Performers', 'phoneNumber');
    await queryInterface.removeColumn('Performers', 'sharegramUserId');
    await queryInterface.removeColumn('Performers', 'riskScore');
    await queryInterface.removeColumn('Performers', 'kycMetadata');
  }
};