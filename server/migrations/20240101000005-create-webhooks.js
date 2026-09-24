'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Webhooks', {
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
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Webhook名称'
      },
      url: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Webhook送信先URL'
      },
      secret: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: '署名検証用シークレット（暗号化保存）'
      },
      events: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: '[]',
        comment: '購読イベント一覧'
      },
      headers: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'カスタムヘッダー'
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      retryConfig: {
        type: Sequelize.JSON,
        defaultValue: '{"maxRetries": 3, "retryDelay": 1000, "backoffMultiplier": 2}',
        allowNull: false
      },
      lastTriggeredAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      lastStatus: {
        type: Sequelize.ENUM('pending', 'success', 'failed'),
        allowNull: true
      },
      lastError: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      totalCalls: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      successCalls: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      failedCalls: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
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
    await queryInterface.addIndex('Webhooks', ['userId'], {
      name: 'idx_webhooks_user_id'
    });

    await queryInterface.addIndex('Webhooks', ['isActive'], {
      name: 'idx_webhooks_active'
    });

    await queryInterface.addIndex('Webhooks', ['lastTriggeredAt'], {
      name: 'idx_webhooks_last_triggered'
    });

    await queryInterface.addIndex('Webhooks', ['lastStatus'], {
      name: 'idx_webhooks_last_status'
    });

    // 複合インデックス（アクティブなWebhooksを効率的に取得）
    await queryInterface.addIndex('Webhooks', ['userId', 'isActive'], {
      name: 'idx_webhooks_user_active'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Webhooks');
  }
};