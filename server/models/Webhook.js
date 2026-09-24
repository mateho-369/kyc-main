const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const crypto = require('crypto');
const axios = require('axios');

const Webhook = sequelize.define('Webhook', {
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
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  url: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      isUrl: true,
      isHttps(value) {
        if (process.env.NODE_ENV === 'production' && !value.startsWith('https://')) {
          throw new Error('本番環境ではHTTPS URLが必須です');
        }
      }
    }
  },
  secret: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '署名検証用シークレット（暗号化保存）'
  },
  events: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [],
    validate: {
      isValidEvents(value) {
        const validEvents = [
          'performer.created',
          'performer.updated',
          'performer.deleted',
          'performer.verified',
          'performer.rejected',
          'performer.approved',
          'performer.registration_completed',
          'document.uploaded',
          'document.verified',
          'batch.completed',
          'integration.synced'
        ];
        
        if (!Array.isArray(value)) {
          throw new Error('イベントは配列である必要があります');
        }
        
        const invalidEvents = value.filter(event => !validEvents.includes(event));
        if (invalidEvents.length > 0) {
          throw new Error(`無効なイベント: ${invalidEvents.join(', ')}`);
        }
      }
    }
  },
  headers: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  retryConfig: {
    type: DataTypes.JSON,
    defaultValue: {
      maxRetries: 3,
      retryDelay: 1000,
      backoffMultiplier: 2
    },
    allowNull: false
  },
  lastTriggeredAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastStatus: {
    type: DataTypes.ENUM('pending', 'success', 'failed'),
    allowNull: true
  },
  lastError: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  totalCalls: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  successCalls: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  failedCalls: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  }
}, {
  tableName: 'Webhooks',
  timestamps: true,
  indexes: [
    {
      fields: ['userId']
    },
    {
      fields: ['isActive']
    },
    {
      fields: ['lastTriggeredAt']
    },
    {
      fields: ['userId', 'isActive']
    }
  ],
  hooks: {
    beforeCreate: async (webhook) => {
      // シークレットの生成（指定されていない場合）
      if (!webhook.secret) {
        webhook.secret = crypto.randomBytes(32).toString('hex');
      }
      // シークレットの暗号化
      webhook.secret = encryptSecret(webhook.secret);
    },
    beforeUpdate: async (webhook) => {
      // シークレットが変更された場合は暗号化
      if (webhook.changed('secret') && webhook.secret) {
        webhook.secret = encryptSecret(webhook.secret);
      }
    }
  }
});

// シークレットの暗号化/復号化
function encryptSecret(secret) {
  const algorithm = 'aes-256-gcm';
  const key = crypto.scryptSync(process.env.WEBHOOK_ENCRYPTION_KEY || 'default-key', 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

function decryptSecret(encryptedSecret) {
  try {
    const parts = encryptedSecret.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.WEBHOOK_ENCRYPTION_KEY || 'default-key', 'salt', 32);
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('シークレットの復号化エラー:', error);
    return null;
  }
}

// インスタンスメソッド
Webhook.prototype.getDecryptedSecret = function() {
  return this.secret ? decryptSecret(this.secret) : null;
};

Webhook.prototype.generateSignature = function(payload) {
  const secret = this.getDecryptedSecret();
  if (!secret) return null;
  
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
};

Webhook.prototype.trigger = async function(event, data) {
  if (!this.isActive || !this.events.includes(event)) {
    return null;
  }

  const payload = {
    event,
    data,
    timestamp: new Date().toISOString(),
    webhookId: this.id
  };

  const signature = this.generateSignature(payload);
  const headers = {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
    'X-Webhook-Event': event,
    'X-Webhook-ID': this.id,
    ...this.headers
  };

  let attempt = 0;
  let lastError = null;
  const retryConfig = this.retryConfig;

  while (attempt <= retryConfig.maxRetries) {
    try {
      const response = await axios.post(this.url, payload, {
        headers,
        timeout: 30000, // 30秒タイムアウト
        validateStatus: (status) => status < 500 // 5xx以外は成功とみなす
      });

      // 成功時の処理
      this.totalCalls++;
      this.successCalls++;
      this.lastTriggeredAt = new Date();
      this.lastStatus = 'success';
      this.lastError = null;
      await this.save();

      return {
        success: true,
        statusCode: response.status,
        response: response.data
      };
    } catch (error) {
      lastError = error;
      attempt++;
      
      if (attempt <= retryConfig.maxRetries) {
        // リトライ待機（指数バックオフ）
        const delay = retryConfig.retryDelay * Math.pow(retryConfig.backoffMultiplier, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // 失敗時の処理
  this.totalCalls++;
  this.failedCalls++;
  this.lastTriggeredAt = new Date();
  this.lastStatus = 'failed';
  this.lastError = lastError.message;
  await this.save();

  return {
    success: false,
    error: lastError.message,
    attempts: attempt
  };
};

// クラスメソッド
Webhook.triggerForUser = async function(userId, event, data) {
  const webhooks = await this.findAll({
    where: {
      userId,
      isActive: true
    }
  });

  const results = await Promise.all(
    webhooks
      .filter(webhook => webhook.events.includes(event))
      .map(webhook => webhook.trigger(event, data))
  );

  return results;
};

Webhook.getHealthStats = async function(userId) {
  const webhooks = await this.findAll({
    where: { userId }
  });

  return webhooks.map(webhook => ({
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    isActive: webhook.isActive,
    healthScore: webhook.totalCalls > 0 
      ? (webhook.successCalls / webhook.totalCalls * 100).toFixed(2) 
      : 0,
    totalCalls: webhook.totalCalls,
    successRate: webhook.totalCalls > 0 
      ? (webhook.successCalls / webhook.totalCalls * 100).toFixed(2) + '%'
      : 'N/A',
    lastStatus: webhook.lastStatus,
    lastTriggered: webhook.lastTriggeredAt
  }));
};

module.exports = Webhook;