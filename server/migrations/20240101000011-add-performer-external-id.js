'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
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
    // Remove index
    await queryInterface.removeIndex('Performers', 'idx_performers_external_id');
    
    // Remove column
    await queryInterface.removeColumn('Performers', 'external_id');
  }
};