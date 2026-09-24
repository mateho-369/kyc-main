const { AuditLog } = require('../models');

/**
 * 監査ログを記録するミドルウェア
 * @param {string} action 操作の種類
 * @param {string} resourceType リソースの種類
 * @param {function} getResourceId リソースIDを取得する関数（req, res => id）
 * @param {function} getDetails 詳細情報を取得する関数（req, res => Object）
 */
const auditLogger = (action, resourceType, getResourceId, getDetails = () => ({})) => {
  return async (req, res, next) => {
    // 元のend関数を保存
    const originalEnd = res.end;
    
    // endを上書きして、レスポンス送信後に監査ログを記録
    res.end = async function(...args) {
      // 元のend関数を呼び出し
      originalEnd.apply(res, args);
      
      try {
        // レスポンスが成功した場合のみログを記録
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const resourceId = getResourceId(req, res);
          
          if (resourceId) {
            await AuditLog.create({
              userId: req.user.id,
              action,
              resourceType,
              resourceId,
              details: getDetails(req, res),
              ipAddress: req.ip,
              userAgent: req.get('user-agent') || ''
            });
          }
        }
      } catch (error) {
        console.error('監査ログ記録エラー:', error);
        // エラーを無視（メイン処理を妨げないため）
      }
    };
    
    next();
  };
};

// よく使うアクションのヘルパー関数
const auditCreate = (resourceType, getResourceId, getDetails) => {
  return auditLogger('create', resourceType, getResourceId, getDetails);
};

const auditRead = (resourceType, getResourceId, getDetails) => {
  return auditLogger('read', resourceType, getResourceId, getDetails);
};

const auditUpdate = (resourceType, getResourceId, getDetails) => {
  return auditLogger('update', resourceType, getResourceId, getDetails);
};

const auditDelete = (resourceType, getResourceId, getDetails) => {
  return auditLogger('delete', resourceType, getResourceId, getDetails);
};

const auditDownload = (resourceType, getResourceId, getDetails) => {
  return auditLogger('download', resourceType, getResourceId, getDetails);
};

const auditVerify = (resourceType, getResourceId, getDetails) => {
  return auditLogger('verify', resourceType, getResourceId, getDetails);
};

module.exports = {
  auditLogger,
  auditCreate,
  auditRead,
  auditUpdate,
  auditDelete,
  auditDownload,
  auditVerify
};