const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const ApiLog = sequelize.define('ApiLog', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  apiKey: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '使用されたAPIキー（ハッシュ化）'
  },
  method: {
    type: DataTypes.ENUM('GET', 'POST', 'PUT', 'DELETE', 'PATCH'),
    allowNull: false
  },
  endpoint: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  requestHeaders: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  },
  requestBody: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null
  },
  responseStatus: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  responseBody: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null
  },
  responseTime: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Response time in milliseconds'
  },
  ipAddress: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  userAgent: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  apiVersion: {
    type: DataTypes.STRING(10),
    defaultValue: 'v1',
    allowNull: false
  },
  rateLimitRemaining: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'ApiLogs',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: false,
  indexes: [
    {
      fields: ['userId']
    },
    {
      fields: ['apiKey']
    },
    {
      fields: ['method', 'endpoint']
    },
    {
      fields: ['responseStatus']
    },
    {
      fields: ['ipAddress']
    },
    {
      fields: ['createdAt']
    }
  ],
  hooks: {
    beforeCreate: (log) => {
      // APIキーのハッシュ化
      if (log.apiKey) {
        const crypto = require('crypto');
        log.apiKey = crypto.createHash('sha256').update(log.apiKey).digest('hex').substring(0, 100);
      }

      // 機密情報のサニタイズ
      if (log.requestHeaders) {
        const sanitizedHeaders = { ...log.requestHeaders };
        // Authorizationヘッダーをマスク
        if (sanitizedHeaders.authorization) {
          sanitizedHeaders.authorization = '***REDACTED***';
        }
        if (sanitizedHeaders.cookie) {
          sanitizedHeaders.cookie = '***REDACTED***';
        }
        log.requestHeaders = sanitizedHeaders;
      }

      // リクエストボディから機密情報を除去
      if (log.requestBody) {
        const sanitizedBody = { ...log.requestBody };
        const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'creditCard'];
        sensitiveFields.forEach(field => {
          if (sanitizedBody[field]) {
            sanitizedBody[field] = '***REDACTED***';
          }
        });
        log.requestBody = sanitizedBody;
      }

      // レスポンスボディのサイズ制限
      if (log.responseBody && JSON.stringify(log.responseBody).length > 10000) {
        log.responseBody = {
          message: 'Response body too large to store',
          size: JSON.stringify(log.responseBody).length
        };
      }
    }
  }
});

// クラスメソッド
ApiLog.prototype.isError = function() {
  return this.responseStatus >= 400;
};

ApiLog.prototype.isServerError = function() {
  return this.responseStatus >= 500;
};

ApiLog.prototype.isClientError = function() {
  return this.responseStatus >= 400 && this.responseStatus < 500;
};

// 統計メソッド
ApiLog.getStatsByUser = async function(userId, startDate, endDate) {
  const where = { userId };
  if (startDate && endDate) {
    where.createdAt = {
      [Op.between]: [startDate, endDate]
    };
  }

  const stats = await this.findAll({
    where,
    attributes: [
      'method',
      'endpoint',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      [sequelize.fn('AVG', sequelize.col('responseTime')), 'avgResponseTime'],
      [sequelize.fn('MIN', sequelize.col('responseTime')), 'minResponseTime'],
      [sequelize.fn('MAX', sequelize.col('responseTime')), 'maxResponseTime']
    ],
    group: ['method', 'endpoint']
  });

  return stats;
};

ApiLog.getErrorStats = async function(timeRange = 24) {
  const startTime = new Date();
  startTime.setHours(startTime.getHours() - timeRange);

  const errors = await this.findAll({
    where: {
      responseStatus: {
        [Op.gte]: 400
      },
      createdAt: {
        [Op.gte]: startTime
      }
    },
    attributes: [
      'responseStatus',
      'endpoint',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count']
    ],
    group: ['responseStatus', 'endpoint'],
    order: [[sequelize.literal('count'), 'DESC']]
  });

  return errors;
};

// ログローテーション用メソッド
ApiLog.archiveOldLogs = async function(daysToKeep = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const archived = await this.destroy({
    where: {
      createdAt: {
        [Op.lt]: cutoffDate
      }
    }
  });

  return archived;
};

module.exports = ApiLog;