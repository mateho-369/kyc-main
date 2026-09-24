'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('SharegramIntegrations', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      integrationType: {
        type: Sequelize.ENUM('firebase', 'webhook', 'api', 'batch'),
        allowNull: false
      },
      configuration: {
        type: Sequelize.JSON,
        allowNull: false,
        comment: '統合設定（API keys, endpoints, etc.）'
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      lastSyncAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      syncStatus: {
        type: Sequelize.ENUM('pending', 'syncing', 'success', 'failed'),
        defaultValue: 'pending',
        allowNull: false
      },
      syncErrors: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: '最後の同期エラー情報'
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: '追加メタデータ'
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

    // インデックスの追加
    await queryInterface.addIndex('SharegramIntegrations', ['userId'], {
      name: 'idx_sharegram_integrations_user_id'
    });

    await queryInterface.addIndex('SharegramIntegrations', ['integrationType'], {
      name: 'idx_sharegram_integrations_type'
    });

    await queryInterface.addIndex('SharegramIntegrations', ['isActive'], {
      name: 'idx_sharegram_integrations_active'
    });

    await queryInterface.addIndex('SharegramIntegrations', ['syncStatus'], {
      name: 'idx_sharegram_integrations_sync_status'
    });

    await queryInterface.addIndex('SharegramIntegrations', ['lastSyncAt'], {
      name: 'idx_sharegram_integrations_last_sync'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('SharegramIntegrations');
  }
};