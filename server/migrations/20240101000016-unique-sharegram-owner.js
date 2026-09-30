'use strict';
// Do not merge/delete accounts to make this pass. Existing duplicate non-null
// mappings must be investigated by an operator; an index failure stops rollout.
module.exports = {
  async up(queryInterface) {
    const indexes = await queryInterface.showIndex('Users');
    const name = 'users_sharegram_identity_unique';
    const existing = indexes.find(index => index.name === name);
    if (existing) {
      if (!existing.unique || existing.fields.length !== 1 || existing.fields[0].attribute !== 'sharegramUserId') {
        throw new Error('SHAREGRAM_OWNER_INDEX_DEFINITION_CONFLICT');
      }
      return;
    }
    await queryInterface.addIndex('Users', ['sharegramUserId'], { unique: true, name });
  },
  async down() {
    throw new Error('Removing owner identity uniqueness requires an explicit security review.');
  }
};
