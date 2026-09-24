const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const SharegramIntegration = sequelize.define('SharegramIntegration', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  integrationType: {
    type: DataTypes.ENUM('firebase', 'webhook', 'api', 'batch'),
    allowNull: false,
    validate: {
      isIn: [['firebase', 'webhook', 'api', 'batch']]
    }
  },
  configuration: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {},
    validate: {
      isValidConfig(value) {
        if (!value || typeof value !== 'object') {
          throw new Error('設定は有効なJSONオブジェクトである必要があります');
        }
      }
    }
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  lastSyncAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  syncStatus: {
    type: DataTypes.ENUM('pending', 'syncing', 'success', 'failed'),
    defaultValue: 'pending',
    allowNull: false
  },
  syncErrors: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  },
  // 拡張フィールド
  performerMapping: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {},
    comment: 'Mapping between local performer IDs and external IDs'
  },
  rateLimitConfig: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      maxRequestsPerMinute: 60,
      maxRequestsPerHour: 1000,
      maxRequestsPerDay: 10000
    }
  },
  webhookSecret: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Secret key for webhook signature verification'
  },
  priority: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    comment: 'Integration priority for execution order (higher = first)'
  },
  retryConfig: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      maxRetries: 3,
      retryDelay: 1000,
      backoffMultiplier: 2
    }
  },
  lastErrorAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  totalSyncCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  successfulSyncCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  }
}, {
  tableName: 'SharegramIntegrations',
  timestamps: true,
  indexes: [
    {
      name: 'idx_sharegram_integrations_user_id',
      fields: ['userId']
    },
    {
      name: 'idx_sharegram_integrations_type',
      fields: ['integrationType']
    },
    {
      name: 'idx_sharegram_integrations_active',
      fields: ['isActive']
    },
    {
      name: 'idx_sharegram_integrations_sync_status',
      fields: ['syncStatus']
    }
  ],
  hooks: {
    beforeCreate: async (integration) => {
      // 設定の暗号化（必要に応じて）
      if (integration.configuration && integration.configuration.apiKey) {
        // APIキーなどの機密情報を暗号化
        const crypto = require('crypto');
        const cipher = crypto.createCipher('aes-256-cbc', process.env.ENCRYPTION_KEY || 'default-key');
        let encrypted = cipher.update(integration.configuration.apiKey, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        integration.configuration.apiKey = encrypted;
      }
    },
    afterFind: async (result) => {
      // 設定の復号化（必要に応じて）
      const decryptConfig = (integration) => {
        if (integration && integration.configuration && integration.configuration.apiKey) {
          try {
            const crypto = require('crypto');
            const decipher = crypto.createDecipher('aes-256-cbc', process.env.ENCRYPTION_KEY || 'default-key');
            let decrypted = decipher.update(integration.configuration.apiKey, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            integration.configuration.apiKey = decrypted;
          } catch (error) {
            console.error('設定の復号化エラー:', error);
          }
        }
      };

      if (Array.isArray(result)) {
        result.forEach(decryptConfig);
      } else if (result) {
        decryptConfig(result);
      }
    }
  }
});

// インスタンスメソッド
SharegramIntegration.prototype.updateSyncStatus = async function(status, error = null) {
  this.syncStatus = status;
  this.lastSyncAt = new Date();
  this.totalSyncCount += 1;
  
  if (error) {
    this.syncErrors = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date()
    };
    this.lastErrorAt = new Date();
  } else {
    this.syncErrors = null;
    if (status === 'success') {
      this.successfulSyncCount += 1;
    }
  }
  await this.save();
};

// パフォーマーIDマッピング管理
SharegramIntegration.prototype.addPerformerMapping = async function(localId, externalId) {
  if (!this.performerMapping) {
    this.performerMapping = {};
  }
  this.performerMapping[localId] = externalId;
  await this.save();
};

SharegramIntegration.prototype.getExternalPerformerId = function(localId) {
  return this.performerMapping && this.performerMapping[localId];
};

SharegramIntegration.prototype.getLocalPerformerId = function(externalId) {
  if (!this.performerMapping) return null;
  
  for (const [localId, extId] of Object.entries(this.performerMapping)) {
    if (extId === externalId) {
      return localId;
    }
  }
  return null;
};

// レート制限チェック
SharegramIntegration.prototype.isRateLimited = async function() {
  // この実装は実際のレート制限ロジックに置き換える必要があります
  // 例: Redisを使用したレート制限の実装など
  return false;
};

// 再試行設定に基づいた待機時間計算
SharegramIntegration.prototype.getRetryDelay = function(attemptNumber) {
  const config = this.retryConfig || {};
  const baseDelay = config.retryDelay || 1000;
  const multiplier = config.backoffMultiplier || 2;
  return baseDelay * Math.pow(multiplier, attemptNumber - 1);
};

// 成功率の計算
SharegramIntegration.prototype.getSuccessRate = function() {
  if (this.totalSyncCount === 0) return 0;
  return (this.successfulSyncCount / this.totalSyncCount) * 100;
};

SharegramIntegration.prototype.isConfigValid = function() {
  switch (this.integrationType) {
    case 'firebase':
      return !!(this.configuration.projectId && this.configuration.privateKey);
    case 'webhook':
      return !!(this.configuration.url && this.configuration.events);
    case 'api':
      return !!(this.configuration.apiKey && this.configuration.endpoint);
    case 'batch':
      return !!(this.configuration.schedule && this.configuration.jobType);
    default:
      return false;
  }
};

// クラスメソッド
SharegramIntegration.getActiveIntegrations = async function(userId) {
  return await this.findAll({
    where: {
      userId,
      isActive: true
    }
  });
};

SharegramIntegration.getIntegrationsByType = async function(type) {
  return await this.findAll({
    where: {
      integrationType: type,
      isActive: true
    }
  });
};

// 優先度順に統合を取得
SharegramIntegration.getIntegrationsByPriority = async function(userId = null) {
  const where = { isActive: true };
  if (userId) {
    where.userId = userId;
  }
  
  return await this.findAll({
    where,
    order: [['priority', 'DESC'], ['createdAt', 'ASC']]
  });
};

// 同期が必要な統合を取得
SharegramIntegration.getIntegrationsNeedingSync = async function(minutesSinceLastSync = 60) {
  const cutoffTime = new Date(Date.now() - minutesSinceLastSync * 60 * 1000);
  
  return await this.findAll({
    where: {
      isActive: true,
      [require('sequelize').Op.or]: [
        { lastSyncAt: null },
        { lastSyncAt: { [require('sequelize').Op.lt]: cutoffTime } }
      ],
      syncStatus: { [require('sequelize').Op.ne]: 'syncing' }
    }
  });
};

// エラーが多い統合を取得
SharegramIntegration.getFailingIntegrations = async function(failureThreshold = 50) {
  const integrations = await this.findAll({
    where: {
      isActive: true,
      totalSyncCount: { [require('sequelize').Op.gt]: 0 }
    }
  });
  
  return integrations.filter(integration => {
    const successRate = integration.getSuccessRate();
    return successRate < (100 - failureThreshold);
  });
};

// パフォーマーマッピングの一括更新
SharegramIntegration.bulkUpdatePerformerMappings = async function(integrationId, mappings) {
  const integration = await this.findByPk(integrationId);
  if (!integration) {
    throw new Error('Integration not found');
  }
  
  integration.performerMapping = {
    ...integration.performerMapping,
    ...mappings
  };
  
  await integration.save();
  return integration;
};

// Associations
SharegramIntegration.associate = function(models) {
  SharegramIntegration.belongsTo(models.User, { 
    foreignKey: 'userId' 
  });
  SharegramIntegration.hasMany(models.KYCRequest, { 
    foreignKey: 'sharegramIntegrationId', 
    as: 'kycRequests' 
  });
};

module.exports = SharegramIntegration;