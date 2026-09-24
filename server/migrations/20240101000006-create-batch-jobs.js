'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('BatchJobs', {
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
      jobType: {
        type: Sequelize.ENUM('performer_import', 'status_update', 'document_verification', 'data_export', 'cleanup'),
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed', 'cancelled'),
        defaultValue: 'pending',
        allowNull: false
      },
      priority: {
        type: Sequelize.ENUM('low', 'normal', 'high', 'urgent'),
        defaultValue: 'normal',
        allowNull: false
      },
      inputData: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: '入力データ（ファイルパス、パラメータ等）'
      },
      outputData: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: '出力データ（結果、生成ファイル等）'
      },
      progress: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: '進捗率（0-100）'
      },
      totalItems: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: '処理対象総数'
      },
      processedItems: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: '処理済み数'
      },
      successItems: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: '成功数'
      },
      failedItems: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: '失敗数'
      },
      errorLog: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'エラー詳細'
      },
      scheduledAt: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: '実行予定時刻'
      },
      startedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: '実行開始時刻'
      },
      completedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: '完了時刻'
      },
      estimatedCompletion: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: '完了予定時刻'
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
    await queryInterface.addIndex('BatchJobs', ['userId'], {
      name: 'idx_batch_jobs_user_id'
    });

    await queryInterface.addIndex('BatchJobs', ['jobType'], {
      name: 'idx_batch_jobs_type'
    });

    await queryInterface.addIndex('BatchJobs', ['status'], {
      name: 'idx_batch_jobs_status'
    });

    await queryInterface.addIndex('BatchJobs', ['priority', 'status'], {
      name: 'idx_batch_jobs_priority_status'
    });

    await queryInterface.addIndex('BatchJobs', ['scheduledAt'], {
      name: 'idx_batch_jobs_scheduled'
    });

    await queryInterface.addIndex('BatchJobs', ['createdAt'], {
      name: 'idx_batch_jobs_created'
    });

    // 実行待ちジョブの効率的な取得用
    await queryInterface.addIndex('BatchJobs', ['status', 'priority', 'scheduledAt'], {
      name: 'idx_batch_jobs_queue'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('BatchJobs');
  }
};