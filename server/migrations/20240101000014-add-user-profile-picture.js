'use strict';

/**
 * SSO（Sharegram → Firebase）で取得したプロフィール画像を保存するためのカラム。
 * Users.profilePicture が存在しないと、Sequelize は属性を黙って捨てるため
 * /api/auth/firebase-session のレスポンスが常に profilePicture: undefined になる。
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { makeSafe } = require('../utils/migrationGuard');
    // sync({alter:true}) が先に作っている場合があるので「既存」はスキップする
    queryInterface = makeSafe(queryInterface, '14-add-user-profile-picture');
    await queryInterface.addColumn('Users', 'profilePicture', {
      type: Sequelize.STRING(512),
      allowNull: true,
      after: 'emailVerified'
    });
  },

  down: async (queryInterface) => {
    const { makeSafe } = require('../utils/migrationGuard');
    // sync({alter:true}) が先に作っている場合があるので「既存」はスキップする
    queryInterface = makeSafe(queryInterface, '14-add-user-profile-picture');
    await queryInterface.removeColumn('Users', 'profilePicture');
  }
};
