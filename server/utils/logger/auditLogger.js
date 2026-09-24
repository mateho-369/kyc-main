const { structuredLogger } = require('./logger');
const { ApiLog } = require('../../models');

/**
 * 監査ログアクション定義
 */
const AuditActions = {
  // 認証関連
  LOGIN: 'user.login',
  LOGOUT: 'user.logout',
  LOGIN_FAILED: 'user.login.failed',
  PASSWORD_RESET: 'user.password.reset',
  TOKEN_REFRESH: 'user.token.refresh',
  
  // ユーザー管理
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  USER_ACTIVATE: 'user.activate',
  USER_DEACTIVATE: 'user.deactivate',
  
  // パフォーマー管理
  PERFORMER_CREATE: 'performer.create',
  PERFORMER_UPDATE: 'performer.update',
  PERFORMER_DELETE: 'performer.delete',
  PERFORMER_APPROVE: 'performer.approve',
  PERFORMER_REJECT: 'performer.reject',
  PERFORMER_BULK_IMPORT: 'performer.bulk.import',
  
  // データアクセス
  DATA_EXPORT: 'data.export',
  DATA_VIEW: 'data.view',
  DATA_DOWNLOAD: 'data.download',
  
  // システム管理
  SETTINGS_UPDATE: 'system.settings.update',
  INTEGRATION_CONFIGURE: 'system.integration.configure',
  WEBHOOK_CONFIGURE: 'system.webhook.configure',
  
  // セキュリティ
  PERMISSION_GRANT: 'security.permission.grant',
  PERMISSION_REVOKE: 'security.permission.revoke',
  SUSPICIOUS_ACTIVITY: 'security.suspicious.activity'
};

/**
 * 監査ログクラス
 */
class AuditLogger {
  /**
   * 監査ログ記録
   */
  async log(action, userId, resource, details = {}) {
    try {
      // 構造化ログに記録
      structuredLogger.logAudit(action, userId, resource, details);
      
      // データベースに記録（重要なアクションのみ）
      if (this.isImportantAction(action)) {
        await this.saveToDatabase(action, userId, resource, details);
      }
    } catch (error) {
      console.error('監査ログ記録エラー:', error);
    }
  }

  /**
   * ログイン監査
   */
  async logLogin(userId, success, details = {}) {
    const action = success ? AuditActions.LOGIN : AuditActions.LOGIN_FAILED;
    await this.log(action, userId, 'authentication', {
      ip: details.ip,
      userAgent: details.userAgent,
      method: details.method || 'password',
      ...details
    });
  }

  /**
   * 認証イベント監査（SSO / Firebase 系ルート用）
   *
   * SSO系ルートは { action, userId, success, ...details } のオブジェクト1つで呼び出す。
   * このメソッド自体は絶対に throw しない。呼び出し側は await せずに使うため、
   * ここで例外が漏れると Express 4 では未処理 Promise となりリクエストが
   * ハングする（過去に 504 の原因となった）。
   */
  async logAuth(event = {}) {
    try {
      const { action, userId = null, success = true, ...details } = event || {};

      // action 例: 'SHAREGRAM_SSO_LOGIN' → 'auth.sharegram_sso_login[.failed]'
      const resolvedAction = action
        ? `auth.${String(action).toLowerCase()}${success ? '' : '.failed'}`
        : (success ? AuditActions.LOGIN : AuditActions.LOGIN_FAILED);

      await this.log(resolvedAction, userId, 'authentication', {
        success,
        ...details
      });
    } catch (error) {
      console.error('認証監査ログ記録エラー:', error);
    }
  }

  /**
   * データアクセス監査
   */
  async logDataAccess(userId, resource, action, details = {}) {
    await this.log(action, userId, resource, {
      accessType: details.accessType || 'read',
      recordCount: details.recordCount,
      filters: details.filters,
      ...details
    });
  }

  /**
   * 変更監査
   */
  async logChange(userId, resource, action, before, after, details = {}) {
    const changes = this.calculateChanges(before, after);
    
    await this.log(action, userId, resource, {
      changes,
      changedFields: Object.keys(changes),
      ...details
    });
  }

  /**
   * 一括操作監査
   */
  async logBulkOperation(userId, resource, action, affectedIds, details = {}) {
    await this.log(action, userId, resource, {
      affectedCount: affectedIds.length,
      affectedIds: affectedIds.slice(0, 100), // 最大100件まで記録
      operation: details.operation,
      ...details
    });
  }

  /**
   * セキュリティイベント監査
   */
  async logSecurityEvent(event, userId, severity, details = {}) {
    structuredLogger.logSecurity(event, severity, {
      userId,
      ...details
    });
    
    if (severity === 'critical' || severity === 'high') {
      await this.log(AuditActions.SUSPICIOUS_ACTIVITY, userId, 'security', {
        event,
        severity,
        ...details
      });
    }
  }

  /**
   * 重要なアクションか判定
   */
  isImportantAction(action) {
    const importantActions = [
      AuditActions.USER_DELETE,
      AuditActions.PERFORMER_DELETE,
      AuditActions.DATA_EXPORT,
      AuditActions.SETTINGS_UPDATE,
      AuditActions.PERMISSION_GRANT,
      AuditActions.PERMISSION_REVOKE,
      AuditActions.SUSPICIOUS_ACTIVITY
    ];
    
    return importantActions.includes(action);
  }

  /**
   * データベースに保存
   */
  async saveToDatabase(action, userId, resource, details) {
    try {
      await ApiLog.create({
        userId,
        method: 'AUDIT',
        endpoint: `audit:${action}`,
        requestBody: {
          action,
          resource,
          details
        },
        responseStatus: 200,
        responseTime: 0,
        ipAddress: details.ip || 'system',
        userAgent: details.userAgent || 'system',
        apiVersion: 'audit'
      });
    } catch (error) {
      console.error('監査ログDB保存エラー:', error);
    }
  }

  /**
   * 変更差分計算
   */
  calculateChanges(before, after) {
    const changes = {};
    
    // 削除されたフィールド
    for (const key in before) {
      if (!(key in after)) {
        changes[key] = { before: before[key], after: null };
      }
    }
    
    // 追加・変更されたフィールド
    for (const key in after) {
      if (!(key in before)) {
        changes[key] = { before: null, after: after[key] };
      } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes[key] = { before: before[key], after: after[key] };
      }
    }
    
    return changes;
  }

  /**
   * 監査ログ検索
   */
  async search(filters = {}) {
    const where = {};
    
    if (filters.userId) {
      where.userId = filters.userId;
    }
    
    if (filters.action) {
      where.endpoint = `audit:${filters.action}`;
    }
    
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt[Op.gte] = filters.startDate;
      }
      if (filters.endDate) {
        where.createdAt[Op.lte] = filters.endDate;
      }
    }
    
    const logs = await ApiLog.findAll({
      where: {
        ...where,
        apiVersion: 'audit'
      },
      order: [['createdAt', 'DESC']],
      limit: filters.limit || 100
    });
    
    return logs.map(log => ({
      id: log.id,
      userId: log.userId,
      action: log.endpoint.replace('audit:', ''),
      resource: log.requestBody.resource,
      details: log.requestBody.details,
      timestamp: log.createdAt,
      ip: log.ipAddress
    }));
  }

  /**
   * コンプライアンスレポート生成
   */
  async generateComplianceReport(startDate, endDate) {
    const logs = await this.search({ startDate, endDate });
    
    const report = {
      period: { startDate, endDate },
      summary: {
        totalActions: logs.length,
        uniqueUsers: new Set(logs.map(l => l.userId)).size,
        actionBreakdown: {}
      },
      criticalEvents: [],
      userActivity: {}
    };
    
    // アクション別集計
    logs.forEach(log => {
      const action = log.action;
      report.summary.actionBreakdown[action] = 
        (report.summary.actionBreakdown[action] || 0) + 1;
      
      // ユーザー別集計
      if (!report.userActivity[log.userId]) {
        report.userActivity[log.userId] = {
          actionCount: 0,
          actions: []
        };
      }
      report.userActivity[log.userId].actionCount++;
      report.userActivity[log.userId].actions.push({
        action: log.action,
        timestamp: log.timestamp
      });
      
      // 重要イベント抽出
      if (this.isImportantAction(log.action)) {
        report.criticalEvents.push(log);
      }
    });
    
    return report;
  }
}

// シングルトンインスタンス
const auditLogger = new AuditLogger();

module.exports = {
  auditLogger,
  AuditActions
};