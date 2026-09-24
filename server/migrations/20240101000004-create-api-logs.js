'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ApiLogs', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      apiKey: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: '使用されたAPIキー（ハッシュ化）'
      },
      method: {
        type: Sequelize.ENUM('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
        allowNull: false
      },
      endpoint: {
        type: Sequelize.STRING(500),
        allowNull: false
      },
      requestHeaders: {
        type: Sequelize.JSON,
        allowNull: true
      },
      requestBody: {
        type: Sequelize.JSON,
        allowNull: true
      },
      responseStatus: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      responseBody: {
        type: Sequelize.JSON,
        allowNull: true
      },
      responseTime: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Response time in milliseconds'
      },
      ipAddress: {
        type: Sequelize.STRING(45),
        allowNull: true
      },
      userAgent: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      errorMessage: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      apiVersion: {
        type: Sequelize.STRING(10),
        defaultValue: 'v1',
        allowNull: false
      },
      rateLimitRemaining: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // インデックスの追加（パフォーマンス最適化）
    await queryInterface.addIndex('ApiLogs', ['userId'], {
      name: 'idx_api_logs_user_id'
    });

    await queryInterface.addIndex('ApiLogs', ['apiKey'], {
      name: 'idx_api_logs_api_key'
    });

    await queryInterface.addIndex('ApiLogs', ['method', 'endpoint'], {
      name: 'idx_api_logs_method_endpoint'
    });

    await queryInterface.addIndex('ApiLogs', ['responseStatus'], {
      name: 'idx_api_logs_response_status'
    });

    await queryInterface.addIndex('ApiLogs', ['createdAt'], {
      name: 'idx_api_logs_created_at'
    });

    await queryInterface.addIndex('ApiLogs', ['ipAddress'], {
      name: 'idx_api_logs_ip_address'
    });

    // パーティショニング用の日付インデックス
    await queryInterface.addIndex('ApiLogs', ['createdAt', 'userId'], {
      name: 'idx_api_logs_partition'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('ApiLogs');
  }
};