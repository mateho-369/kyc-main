'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add new columns to SharegramIntegrations table
    await queryInterface.addColumn('SharegramIntegrations', 'performerMapping', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: {},
      comment: 'Mapping between local performer IDs and external IDs'
    });

    await queryInterface.addColumn('SharegramIntegrations', 'rateLimitConfig', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: {
        maxRequestsPerMinute: 60,
        maxRequestsPerHour: 1000,
        maxRequestsPerDay: 10000
      }
    });

    await queryInterface.addColumn('SharegramIntegrations', 'webhookSecret', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Secret key for webhook signature verification'
    });

    await queryInterface.addColumn('SharegramIntegrations', 'priority', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false,
      comment: 'Integration priority for execution order (higher = first)'
    });

    await queryInterface.addColumn('SharegramIntegrations', 'retryConfig', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: {
        maxRetries: 3,
        retryDelay: 1000,
        backoffMultiplier: 2
      }
    });

    await queryInterface.addColumn('SharegramIntegrations', 'lastErrorAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('SharegramIntegrations', 'totalSyncCount', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false
    });

    await queryInterface.addColumn('SharegramIntegrations', 'successfulSyncCount', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false
    });

    // Add indexes for new columns
    await queryInterface.addIndex('SharegramIntegrations', ['priority'], {
      name: 'idx_sharegram_integrations_priority'
    });

    await queryInterface.addIndex('SharegramIntegrations', ['lastErrorAt'], {
      name: 'idx_sharegram_integrations_last_error'
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Remove indexes
    await queryInterface.removeIndex('SharegramIntegrations', 'idx_sharegram_integrations_priority');
    await queryInterface.removeIndex('SharegramIntegrations', 'idx_sharegram_integrations_last_error');

    // Remove columns
    await queryInterface.removeColumn('SharegramIntegrations', 'performerMapping');
    await queryInterface.removeColumn('SharegramIntegrations', 'rateLimitConfig');
    await queryInterface.removeColumn('SharegramIntegrations', 'webhookSecret');
    await queryInterface.removeColumn('SharegramIntegrations', 'priority');
    await queryInterface.removeColumn('SharegramIntegrations', 'retryConfig');
    await queryInterface.removeColumn('SharegramIntegrations', 'lastErrorAt');
    await queryInterface.removeColumn('SharegramIntegrations', 'totalSyncCount');
    await queryInterface.removeColumn('SharegramIntegrations', 'successfulSyncCount');
  }
};