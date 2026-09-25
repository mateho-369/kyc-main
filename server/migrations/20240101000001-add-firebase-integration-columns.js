'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { makeSafe } = require('../utils/migrationGuard');
    // sync({alter:true}) が先に作っている場合があるので「既存」はスキップする
    queryInterface = makeSafe(queryInterface, '01-add-firebase-integration-columns');
    // Usersテーブルへの拡張
    await queryInterface.addColumn('Users', 'firebaseUid', {
      type: Sequelize.STRING(255),
      unique: true,
      allowNull: true,
      after: 'email'
    });

    await queryInterface.addColumn('Users', 'authProvider', {
      type: Sequelize.ENUM('local', 'firebase', 'google', 'apple'),
      defaultValue: 'local',
      allowNull: false,
      after: 'firebaseUid'
    });

    await queryInterface.addColumn('Users', 'lastLoginAt', {
      type: Sequelize.DATE,
      allowNull: true,
      after: 'authProvider'
    });

    await queryInterface.addColumn('Users', 'emailVerified', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      after: 'lastLoginAt'
    });

    // インデックスの追加
    await queryInterface.addIndex('Users', ['firebaseUid'], {
      name: 'idx_users_firebase_uid'
    });

    await queryInterface.addIndex('Users', ['authProvider'], {
      name: 'idx_users_auth_provider'
    });

    await queryInterface.addIndex('Users', ['lastLoginAt'], {
      name: 'idx_users_last_login'
    });
  },

  down: async (queryInterface, Sequelize) => {
    const { makeSafe } = require('../utils/migrationGuard');
    // sync({alter:true}) が先に作っている場合があるので「既存」はスキップする
    queryInterface = makeSafe(queryInterface, '01-add-firebase-integration-columns');
    // インデックスの削除
    await queryInterface.removeIndex('Users', 'idx_users_last_login');
    await queryInterface.removeIndex('Users', 'idx_users_auth_provider');
    await queryInterface.removeIndex('Users', 'idx_users_firebase_uid');

    // カラムの削除
    await queryInterface.removeColumn('Users', 'emailVerified');
    await queryInterface.removeColumn('Users', 'lastLoginAt');
    await queryInterface.removeColumn('Users', 'authProvider');
    await queryInterface.removeColumn('Users', 'firebaseUid');
  }
};