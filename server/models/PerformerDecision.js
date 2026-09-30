'use strict';
const { DataTypes: D } = require('sequelize');
const { sequelize } = require('../config/db');
module.exports = sequelize.define('PerformerDecision', {
  id: { type: D.UUID, primaryKey: true },
  performerId: { type: D.INTEGER, allowNull: false },
  reviewerId: { type: D.INTEGER, allowNull: false },
  action: { type: D.STRING(32), allowNull: false },
  reason: { type: D.TEXT, allowNull: true },
  reasonCode: { type: D.STRING(64), allowNull: true },
  previousStatus: { type: D.STRING(32), allowNull: false },
  previousKycStatus: { type: D.STRING(32), allowNull: false },
  status: { type: D.STRING(32), allowNull: false },
  kycStatus: { type: D.STRING(32), allowNull: false }
}, { tableName: 'performer_decisions', updatedAt: false });
