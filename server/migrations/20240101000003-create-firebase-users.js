'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { makeSafe } = require('../utils/migrationGuard');
    // sync({alter:true}) が先に作っている場合があるので「既存」はスキップする
    queryInterface = makeSafe(queryInterface, '03-create-firebase-users');
    await queryInterface.createTable('FirebaseUsers', {
      id: {
        type: Sequelize.INTEGER,
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
      firebaseUid: {
        type: Sequelize.STRING(255),
        unique: true,
        allowNull: false
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      displayName: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      photoURL: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      phoneNumber: {
        type: Sequelize.STRING(20),
        allowNull: true
      },
      providerId: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'google.com, apple.com, password, etc.'
      },
      emailVerified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      disabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      customClaims: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Firebase custom claims'
      },
      firebaseMetadata: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'lastSignInTime, creationTime, etc.'
      },
      lastSyncedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
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
    await queryInterface.addIndex('FirebaseUsers', ['firebaseUid'], {
      name: 'idx_firebase_users_uid',
      unique: true
    });

    await queryInterface.addIndex('FirebaseUsers', ['userId'], {
      name: 'idx_firebase_users_local_user'
    });

    await queryInterface.addIndex('FirebaseUsers', ['email'], {
      name: 'idx_firebase_users_email'
    });

    await queryInterface.addIndex('FirebaseUsers', ['providerId'], {
      name: 'idx_firebase_users_provider'
    });

    await queryInterface.addIndex('FirebaseUsers', ['lastSyncedAt'], {
      name: 'idx_firebase_users_last_sync'
    });
  },

  down: async (queryInterface, Sequelize) => {
    const { makeSafe } = require('../utils/migrationGuard');
    // sync({alter:true}) が先に作っている場合があるので「既存」はスキップする
    queryInterface = makeSafe(queryInterface, '03-create-firebase-users');
    await queryInterface.dropTable('FirebaseUsers');
  }
};