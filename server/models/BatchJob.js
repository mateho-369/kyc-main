const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const { EventEmitter } = require('events');

class BatchJobEmitter extends EventEmitter {}
const batchJobEmitter = new BatchJobEmitter();

const BatchJob = sequelize.define('BatchJob', {
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
  jobType: {
    type: DataTypes.ENUM(
      'performer_import',
      'status_update',
      'document_verification',
      'data_export',
      'cleanup'
    ),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'cancelled'),
    defaultValue: 'pending',
    allowNull: false
  },
  priority: {
    type: DataTypes.ENUM('low', 'normal', 'high', 'urgent'),
    defaultValue: 'normal',
    allowNull: false
  },
  inputData: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  },
  outputData: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null
  },
  progress: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    validate: {
      min: 0,
      max: 100
    }
  },
  totalItems: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  processedItems: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  successItems: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  failedItems: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  errorLog: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  },
  scheduledAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  startedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  estimatedCompletion: {
    type: DataTypes.DATE,
    allowNull: true
  },
  retryCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false
  },
  maxRetries: {
    type: DataTypes.INTEGER,
    defaultValue: 3,
    allowNull: false
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  }
}, {
  tableName: 'BatchJobs',
  timestamps: true,
  indexes: [
    {
      fields: ['userId']
    },
    {
      fields: ['jobType']
    },
    {
      fields: ['status']
    },
    {
      fields: ['priority', 'status']
    },
    {
      fields: ['scheduledAt']
    },
    {
      fields: ['status', 'priority', 'scheduledAt'],
      name: 'idx_batch_jobs_queue'
    }
  ]
});

// インスタンスメソッド
BatchJob.prototype.start = async function() {
  if (this.status !== 'pending') {
    throw new Error(`ジョブは既に${this.status}状態です`);
  }
  
  this.status = 'processing';
  this.startedAt = new Date();
  await this.save();
  
  batchJobEmitter.emit('job:started', this);
  return this;
};

BatchJob.prototype.updateProgress = async function(processed, success = 0, failed = 0) {
  this.processedItems = processed;
  this.successItems += success;
  this.failedItems += failed;
  
  if (this.totalItems) {
    this.progress = Math.round((this.processedItems / this.totalItems) * 100);
    
    // 残り時間の推定
    const elapsedTime = new Date() - this.startedAt;
    const itemsPerMs = this.processedItems / elapsedTime;
    const remainingItems = this.totalItems - this.processedItems;
    const estimatedRemainingTime = remainingItems / itemsPerMs;
    this.estimatedCompletion = new Date(Date.now() + estimatedRemainingTime);
  }
  
  await this.save();
  batchJobEmitter.emit('job:progress', this);
  return this;
};

BatchJob.prototype.complete = async function(outputData = null) {
  this.status = 'completed';
  this.completedAt = new Date();
  this.progress = 100;
  if (outputData) {
    this.outputData = outputData;
  }
  
  await this.save();
  batchJobEmitter.emit('job:completed', this);
  return this;
};

BatchJob.prototype.fail = async function(error) {
  this.status = 'failed';
  this.completedAt = new Date();
  
  if (!this.errorLog) {
    this.errorLog = [];
  }
  
  this.errorLog.push({
    timestamp: new Date(),
    error: error.message,
    stack: error.stack,
    attempt: this.retryCount + 1
  });
  
  await this.save();
  batchJobEmitter.emit('job:failed', this);
  return this;
};

BatchJob.prototype.cancel = async function() {
  if (['completed', 'failed'].includes(this.status)) {
    throw new Error('完了済みまたは失敗したジョブはキャンセルできません');
  }
  
  this.status = 'cancelled';
  this.completedAt = new Date();
  await this.save();
  
  batchJobEmitter.emit('job:cancelled', this);
  return this;
};

BatchJob.prototype.retry = async function() {
  if (this.retryCount >= this.maxRetries) {
    throw new Error('最大リトライ回数に達しました');
  }
  
  this.status = 'pending';
  this.retryCount++;
  this.scheduledAt = new Date(Date.now() + (this.retryCount * 60000)); // リトライごとに1分追加
  this.startedAt = null;
  this.completedAt = null;
  this.estimatedCompletion = null;
  
  await this.save();
  batchJobEmitter.emit('job:retry', this);
  return this;
};

BatchJob.prototype.addError = async function(error, context = {}) {
  if (!this.errorLog) {
    this.errorLog = [];
  }
  
  this.errorLog.push({
    timestamp: new Date(),
    error: error.message,
    context,
    item: this.processedItems
  });
  
  // エラーログが100件を超えたら古いものから削除
  if (this.errorLog.length > 100) {
    this.errorLog = this.errorLog.slice(-100);
  }
  
  await this.save();
};

// クラスメソッド
BatchJob.getNextJob = async function() {
  const job = await this.findOne({
    where: {
      status: 'pending',
      [sequelize.Op.or]: [
        { scheduledAt: null },
        { scheduledAt: { [sequelize.Op.lte]: new Date() } }
      ]
    },
    order: [
      ['priority', 'DESC'],
      ['createdAt', 'ASC']
    ]
  });
  
  return job;
};

BatchJob.getActiveJobs = async function(userId = null) {
  const where = {
    status: ['pending', 'processing']
  };
  
  if (userId) {
    where.userId = userId;
  }
  
  return await this.findAll({
    where,
    order: [['createdAt', 'DESC']]
  });
};

BatchJob.getJobStats = async function(userId, timeRange = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeRange);
  
  const stats = await this.findAll({
    where: {
      userId,
      createdAt: {
        [sequelize.Op.gte]: startDate
      }
    },
    attributes: [
      'jobType',
      'status',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      [sequelize.fn('AVG', sequelize.col('processedItems')), 'avgProcessed'],
      [sequelize.fn('SUM', sequelize.col('successItems')), 'totalSuccess'],
      [sequelize.fn('SUM', sequelize.col('failedItems')), 'totalFailed']
    ],
    group: ['jobType', 'status']
  });
  
  return stats;
};

// バッチジョブの実行キュー
BatchJob.processQueue = async function() {
  const job = await this.getNextJob();
  if (!job) return null;
  
  try {
    await job.start();
    
    // ジョブタイプに応じた処理を実行
    switch (job.jobType) {
      case 'performer_import':
        // パフォーマーインポート処理
        break;
      case 'status_update':
        // ステータス更新処理
        break;
      case 'document_verification':
        // ドキュメント検証処理
        break;
      case 'data_export':
        // データエクスポート処理
        break;
      case 'cleanup':
        // クリーンアップ処理
        break;
    }
    
    return job;
  } catch (error) {
    await job.fail(error);
    
    if (job.retryCount < job.maxRetries) {
      await job.retry();
    }
    
    throw error;
  }
};

// イベントエミッターをエクスポート
BatchJob.events = batchJobEmitter;

module.exports = BatchJob;