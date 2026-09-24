'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { makeSafe } = require('../utils/migrationGuard');
    // sync({alter:true}) が先に作っている場合があるので「既存」はスキップする
    queryInterface = makeSafe(queryInterface, '11-add-performer-external-id');
    // Add external_id column to Performers table
    await queryInterface.addColumn('Performers', 'external_id', {
      type: Sequelize.STRING,
      unique: true,
      allowNull: true,
      comment: 'External system identifier (e.g., Sharagram performer ID)'
    });

    // Add index for external_id for better query performance
    await queryInterface.addIndex('Performers', ['external_id'], {
      name: 'idx_performers_external_id',
      unique: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    const { makeSafe } = require('../utils/migrationGuard');
    // sync({alter:true}) が先に作っている場合があるので「既存」はスキップする
    queryInterface = makeSafe(queryInterface, '11-add-performer-external-id');
    // Remove index
    await queryInterface.removeIndex('Performers', 'idx_performers_external_id');
    
    // Remove column
    await queryInterface.removeColumn('Performers', 'external_id');
  }
};