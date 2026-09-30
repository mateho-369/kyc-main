'use strict';
module.exports = {
  async up(queryInterface, S) {
    const { makeSafe } = require('../utils/migrationGuard');
    const q = makeSafe(queryInterface, '15-create-review-decisions-outbox');
    await q.createTable('performer_decisions', {
      id: { type: S.UUID, primaryKey: true, allowNull: false },
      performerId: { type: S.INTEGER, allowNull: false },
      reviewerId: { type: S.INTEGER, allowNull: false },
      action: { type: S.STRING(32), allowNull: false },
      reason: { type: S.TEXT, allowNull: true },
      reasonCode: { type: S.STRING(64), allowNull: true },
      previousStatus: { type: S.STRING(32), allowNull: false },
      previousKycStatus: { type: S.STRING(32), allowNull: false },
      status: { type: S.STRING(32), allowNull: false },
      kycStatus: { type: S.STRING(32), allowNull: false },
      createdAt: { type: S.DATE, allowNull: false }
    });
    // Intentionally no cascade FK: retained decisions/events survive record deletion.
    await q.createTable('decision_outbox', {
      id: { type: S.UUID, primaryKey: true, allowNull: false },
      performerId: { type: S.INTEGER, allowNull: false },
      eventType: { type: S.STRING(64), allowNull: false },
      payload: { type: S.JSON, allowNull: false },
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'pending' },
      attempts: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: S.DATE, allowNull: false },
      leaseUntil: { type: S.DATE, allowNull: true },
      leaseToken: { type: S.UUID, allowNull: true },
      lastError: { type: S.STRING(128), allowNull: true },
      sentAt: { type: S.DATE, allowNull: true },
      createdAt: { type: S.DATE, allowNull: false },
      updatedAt: { type: S.DATE, allowNull: false }
    });
    await q.addIndex('decision_outbox', ['status', 'nextAttemptAt'], { name: 'decision_outbox_due' });
  },
  async down() {
    throw new Error('Decision history/outbox are retained. Export and explicitly authorize a destructive rollback.');
  }
};
