const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const AuditLog = sequelize.define('AuditLog', {
  // 操作を行ったユーザーID
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  // 操作の種類（create, read, update, delete, verify, download）
  action: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // 対象リソースの種類（performer, document）
  resourceType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // 対象リソースのID
  resourceId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  // 詳細情報（JSON形式で保存）
  details: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  // IPアドレス
  ipAddress: {
    type: DataTypes.STRING
  },
  // ユーザーエージェント
  userAgent: {
    type: DataTypes.STRING
  }
}, {
  timestamps: true,
  // 更新はしない（作成のみ）
  updatedAt: false
});

// Associations
AuditLog.associate = function(models) {
  AuditLog.belongsTo(models.User, { 
    foreignKey: 'userId' 
  });
};

module.exports = AuditLog;