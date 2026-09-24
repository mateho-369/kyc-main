const { AuditLog } = require('../models');

/**
 * 監査ログを記録する関数
 * @param {Object} logData ログデータ
 * @param {number} logData.userId ユーザーID
 * @param {string} logData.action 操作（create, read, update, delete, verify, download）
 * @param {string} logData.resourceType リソースタイプ（performer, document）
 * @param {number} logData.resourceId リソースID
 * @param {Object} logData.details 詳細情報
 * @param {string} logData.ipAddress IPアドレス
 * @param {string} logData.userAgent ユーザーエージェント
 * @returns {Promise<AuditLog>}
 */
const createAuditLog = async (logData) => {
  try {
    const auditLog = await AuditLog.create(logData);
    return auditLog;
  } catch (error) {
    console.error('監査ログ記録エラー:', error);
    // エラーをスローせず、サイレントに失敗（メイン処理を妨げないため）
    return null;
  }
};

/**
 * 指定されたリソースの監査ログを取得する
 * @param {string} resourceType リソースタイプ
 * @param {number} resourceId リソースID
 * @param {Object} options 追加オプション
 * @returns {Promise<Array<AuditLog>>}
 */
const getResourceAuditLogs = async (resourceType, resourceId, options = {}) => {
  try {
    const query = {
      where: {
        resourceType,
        resourceId
      },
      order: [['createdAt', 'DESC']],
      ...options
    };

    const logs = await AuditLog.findAll(query);
    return logs;
  } catch (error) {
    console.error('監査ログ取得エラー:', error);
    throw error;
  }
};

/**
 * ユーザーの監査ログを取得する
 * @param {number} userId ユーザーID
 * @param {Object} options 追加オプション
 * @returns {Promise<Array<AuditLog>>}
 */
const getUserAuditLogs = async (userId, options = {}) => {
  try {
    const query = {
      where: {
        userId
      },
      order: [['createdAt', 'DESC']],
      ...options
    };

    const logs = await AuditLog.findAll(query);
    return logs;
  } catch (error) {
    console.error('監査ログ取得エラー:', error);
    throw error;
  }
};

/**
 * 監査ログレポートを生成する
 * @param {Object} criteria 検索条件
 * @param {Date} criteria.startDate 開始日
 * @param {Date} criteria.endDate 終了日
 * @param {string} criteria.action アクション
 * @param {string} criteria.resourceType リソースタイプ
 * @param {number} criteria.userId ユーザーID
 * @returns {Promise<Object>} レポートデータ
 */
const generateAuditReport = async (criteria = {}) => {
  try {
    const { startDate, endDate, action, resourceType, userId } = criteria;
    
    const whereClause = {};
    
    if (startDate && endDate) {
      whereClause.createdAt = {
        [Op.between]: [startDate, endDate]
      };
    } else if (startDate) {
      whereClause.createdAt = {
        [Op.gte]: startDate
      };
    } else if (endDate) {
      whereClause.createdAt = {
        [Op.lte]: endDate
      };
    }
    
    if (action) {
      whereClause.action = action;
    }
    
    if (resourceType) {
      whereClause.resourceType = resourceType;
    }
    
    if (userId) {
      whereClause.userId = userId;
    }
    
    const logs = await AuditLog.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']]
    });
    
    // 集計データを作成
    const summary = {
      totalLogs: logs.length,
      byUser: {},
      byAction: {},
      byResourceType: {}
    };
    
    logs.forEach(log => {
      // ユーザー別
      if (!summary.byUser[log.userId]) {
        summary.byUser[log.userId] = 0;
      }
      summary.byUser[log.userId]++;
      
      // アクション別
      if (!summary.byAction[log.action]) {
        summary.byAction[log.action] = 0;
      }
      summary.byAction[log.action]++;
      
      // リソースタイプ別
      if (!summary.byResourceType[log.resourceType]) {
        summary.byResourceType[log.resourceType] = 0;
      }
      summary.byResourceType[log.resourceType]++;
    });
    
    return {
      logs,
      summary
    };
  } catch (error) {
    console.error('監査レポート生成エラー:', error);
    throw error;
  }
};

module.exports = {
  createAuditLog,
  getResourceAuditLogs,
  getUserAuditLogs,
  generateAuditReport
};