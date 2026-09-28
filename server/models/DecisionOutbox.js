'use strict';
const { DataTypes: D } = require('sequelize');
const { sequelize } = require('../config/db');
module.exports = sequelize.define('DecisionOutbox', {
  id: { type: D.UUID, primaryKey: true },
  performerId: { type: D.INTEGER, allowNull: false },
  eventType: { type: D.STRING(64), allowNull: false },
  payload: { type: D.JSON, allowNull: false },
  status: { type: D.STRING(16), allowNull: false, defaultValue: 'pending' },
  attempts: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
  nextAttemptAt: { type: D.DATE, allowNull: false },
  leaseUntil: D.DATE,
  leaseToken: D.UUID,
  lastError: D.STRING(128),
  sentAt: D.DATE
}, { tableName: 'decision_outbox', indexes: [{ name: 'decision_outbox_due', fields: ['status', 'nextAttemptAt'] }] });
