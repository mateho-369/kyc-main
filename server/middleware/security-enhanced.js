/**
 * セキュリティ強化機能
 * 
 * 特徴:
 * - 認証バイパス防止機能
 * - セッション管理の強化
 * - 権限昇格攻撃の防止
 * - 監査ログ統合
 * - 不審なアクセスの検出と防御
 */

const crypto = require('crypto');
const { User, AuditLog, SecurityEvent } = require('../models');
const { logger } = require('../utils/logger/logger');
const { auditLogger } = require('../utils/logger/auditLogger');

/**
 * セキュリティイベントタイプ
 */
const SECURITY_EVENT_TYPES = {
  // 認証関連
  AUTH_BYPASS_ATTEMPT: 'auth_bypass_attempt',
  INVALID_TOKEN_REUSE: 'invalid_token_reuse',
  SUSPICIOUS_LOGIN: 'suspicious_login',
  MULTIPLE_FAILED_ATTEMPTS: 'multiple_failed_attempts',
  
  // 権限関連
  PRIVILEGE_ESCALATION: 'privilege_escalation',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  ROLE_TAMPERING: 'role_tampering',
  
  // セッション関連
  SESSION_HIJACKING: 'session_hijacking',
  CONCURRENT_SESSION: 'concurrent_session',
  SESSION_FIXATION: 'session_fixation',
  
  // API関連
  API_ABUSE: 'api_abuse',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  SUSPICIOUS_PAYLOAD: 'suspicious_payload',
  
  // システム関連
  SYSTEM_INTRUSION: 'system_intrusion',
  FILE_TAMPERING: 'file_tampering',
  CONFIGURATION_CHANGE: 'configuration_change'
};

/**
 * セキュリティ強化クラス
 */
class SecurityEnhancer {
  constructor() {
    this.failedAttempts = new Map();
    this.activeSessions = new Map();
    this.suspiciousIPs = new Map();
    this.tokenBlacklist = new Set();
    this.lastCleanup = Date.now();
    this.cleanupInterval = 60 * 60 * 1000; // 1時間
  }

  /**
   * 認証バイパス防止チェック
   */
  async checkAuthenticationBypass(req, res, next) {
    try {
      const clientIP = req.ip || req.connection.remoteAddress;
      const userAgent = req.headers['user-agent'] || 'unknown';
      const requestPath = req.originalUrl;
      
      // 保護されたパスの定義
      const protectedPaths = [
        '/api/admin',
        '/api/auth/admin',
        '/api/performers/admin',
        '/api/audit-logs',
        '/api/system'
      ];

      // 保護されたパスへのアクセスかチェック
      const isProtectedPath = protectedPaths.some(path => 
        requestPath.startsWith(path)
      );

      if (isProtectedPath) {
        // 認証ヘッダーが存在しない場合は即座に拒否
        if (!req.headers.authorization && !req.headers['firebase-token']) {
          await this.logSecurityEvent(
            SECURITY_EVENT_TYPES.AUTH_BYPASS_ATTEMPT,
            'Missing authentication header for protected path',
            { clientIP, userAgent, requestPath }
          );
          
          return res.status(401).json({
            success: false,
            error: 'Authentication required',
            message: 'Access to protected resource requires authentication'
          });
        }

        // 不審なパターンをチェック
        const suspiciousPatterns = [
          /\.\.\//, // Path traversal
          /\/admin\/\w+\/bypass/, // Admin bypass attempts
          /\/auth\/\w+\/skip/, // Auth skip attempts
          /\/system\/\w+\/override/ // System override attempts
        ];

        const hasSuspiciousPattern = suspiciousPatterns.some(pattern => 
          pattern.test(requestPath)
        );

        if (hasSuspiciousPattern) {
          await this.logSecurityEvent(
            SECURITY_EVENT_TYPES.AUTH_BYPASS_ATTEMPT,
            'Suspicious path pattern detected',
            { clientIP, userAgent, requestPath }
          );
          
          return res.status(403).json({
            success: false,
            error: 'Access denied',
            message: 'Suspicious access pattern detected'
          });
        }
      }

      next();
    } catch (error) {
      logger.error('Authentication bypass check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Security check failed'
      });
    }
  }

  /**
   * セッション管理の強化
   */
  async enhanceSessionManagement(req, res, next) {
    try {
      if (!req.user) {
        return next();
      }

      const userId = req.user.id;
      const sessionId = req.headers['x-session-id'] || this.generateSessionId();
      const clientIP = req.ip || req.connection.remoteAddress;
      const userAgent = req.headers['user-agent'] || 'unknown';

      // 現在のセッション情報
      const currentSession = {
        userId,
        sessionId,
        clientIP,
        userAgent,
        lastActivity: Date.now(),
        authMethod: req.authMethod || 'unknown'
      };

      // 既存セッションのチェック
      const existingSession = this.activeSessions.get(userId);
      
      if (existingSession) {
        // 異なるIPからのアクセスをチェック
        if (existingSession.clientIP !== clientIP) {
          await this.logSecurityEvent(
            SECURITY_EVENT_TYPES.SESSION_HIJACKING,
            'Session access from different IP',
            {
              userId,
              originalIP: existingSession.clientIP,
              newIP: clientIP,
              sessionId
            }
          );
          
          // 厳格なセキュリティモードの場合は拒否
          if (process.env.STRICT_SESSION_SECURITY === 'true') {
            return res.status(403).json({
              success: false,
              error: 'Session security violation',
              message: 'Session access from different location detected'
            });
          }
        }

        // 異なるUser-Agentをチェック
        if (existingSession.userAgent !== userAgent) {
          await this.logSecurityEvent(
            SECURITY_EVENT_TYPES.SESSION_HIJACKING,
            'Session access from different user agent',
            {
              userId,
              originalUA: existingSession.userAgent,
              newUA: userAgent,
              sessionId
            }
          );
        }

        // 同時セッションの制限
        const maxConcurrentSessions = process.env.MAX_CONCURRENT_SESSIONS || 3;
        if (existingSession.sessionId !== sessionId) {
          await this.logSecurityEvent(
            SECURITY_EVENT_TYPES.CONCURRENT_SESSION,
            'Multiple concurrent sessions detected',
            {
              userId,
              existingSessionId: existingSession.sessionId,
              newSessionId: sessionId
            }
          );
        }
      }

      // セッション情報を更新
      this.activeSessions.set(userId, currentSession);
      
      // レスポンスヘッダーにセッション情報を設定
      res.setHeader('X-Session-ID', sessionId);
      res.setHeader('X-Session-Timestamp', currentSession.lastActivity);

      next();
    } catch (error) {
      logger.error('Session management error:', error);
      return res.status(500).json({
        success: false,
        error: 'Session management failed'
      });
    }
  }

  /**
   * 権限昇格攻撃の防止
   */
  async preventPrivilegeEscalation(req, res, next) {
    try {
      if (!req.user) {
        return next();
      }

      const userId = req.user.id;
      const currentRole = req.user.role;
      const requestedAction = req.method;
      const targetPath = req.originalUrl;

      // 権限昇格の試行をチェック
      const escalationPatterns = [
        // ロール変更の試行
        { pattern: /\/api\/users\/\d+\/role/, method: 'PUT' },
        { pattern: /\/api\/auth\/promote/, method: 'POST' },
        { pattern: /\/api\/admin\/grant/, method: 'POST' },
        
        // 権限設定の変更
        { pattern: /\/api\/permissions\/\d+/, method: 'PUT' },
        { pattern: /\/api\/roles\/\d+\/permissions/, method: 'POST' },
        
        // システム設定の変更
        { pattern: /\/api\/system\/config/, method: 'PUT' },
        { pattern: /\/api\/admin\/settings/, method: 'POST' }
      ];

      const isEscalationAttempt = escalationPatterns.some(ep => 
        ep.pattern.test(targetPath) && ep.method === requestedAction
      );

      if (isEscalationAttempt) {
        // 高権限が必要な操作に対して現在の権限をチェック
        const allowedRoles = ['admin', 'super_admin'];
        
        if (!allowedRoles.includes(currentRole)) {
          await this.logSecurityEvent(
            SECURITY_EVENT_TYPES.PRIVILEGE_ESCALATION,
            'Privilege escalation attempt detected',
            {
              userId,
              currentRole,
              targetPath,
              requestedAction,
              clientIP: req.ip
            }
          );
          
          return res.status(403).json({
            success: false,
            error: 'Access denied',
            message: 'Insufficient privileges for this operation'
          });
        }
      }

      // リクエストボディでの権限操作チェック
      if (req.body && typeof req.body === 'object') {
        const suspiciousFields = ['role', 'permissions', 'isAdmin', 'level'];
        const hasSuspiciousField = suspiciousFields.some(field => 
          req.body.hasOwnProperty(field)
        );

        if (hasSuspiciousField && currentRole !== 'admin' && currentRole !== 'super_admin') {
          await this.logSecurityEvent(
            SECURITY_EVENT_TYPES.PRIVILEGE_ESCALATION,
            'Role modification attempt in request body',
            {
              userId,
              currentRole,
              requestBody: req.body,
              targetPath
            }
          );
          
          return res.status(403).json({
            success: false,
            error: 'Access denied',
            message: 'Permission field modification not allowed'
          });
        }
      }

      next();
    } catch (error) {
      logger.error('Privilege escalation prevention error:', error);
      return res.status(500).json({
        success: false,
        error: 'Security check failed'
      });
    }
  }

  /**
   * 不審なアクセスの検出
   */
  async detectSuspiciousAccess(req, res, next) {
    try {
      const clientIP = req.ip || req.connection.remoteAddress;
      const userAgent = req.headers['user-agent'] || 'unknown';
      const requestPath = req.originalUrl;
      
      // 不審なアクセスパターンの定義
      const suspiciousPatterns = [
        // SQLインジェクション試行
        /(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bUNION\b)/i,
        
        // XSS試行
        /<script[^>]*>.*?<\/script>/i,
        /javascript:/i,
        /on\w+\s*=/i,
        
        // パストラバーサル
        /\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c/i,
        
        // コマンドインジェクション
        /(\|\||&&|;|`|\$\(|\${)/,
        
        // 機密ファイルアクセス
        /\/(passwd|shadow|hosts|\.env|config\.json)/i
      ];

      // リクエストパスとクエリパラメータをチェック
      const fullRequest = `${requestPath}?${req.query ? JSON.stringify(req.query) : ''}`;
      const hasSuspiciousPattern = suspiciousPatterns.some(pattern => 
        pattern.test(fullRequest)
      );

      if (hasSuspiciousPattern) {
        await this.logSecurityEvent(
          SECURITY_EVENT_TYPES.SUSPICIOUS_PAYLOAD,
          'Suspicious request pattern detected',
          {
            clientIP,
            userAgent,
            requestPath,
            queryParams: req.query,
            method: req.method
          }
        );
        
        // 不審なIPを記録
        this.suspiciousIPs.set(clientIP, {
          count: (this.suspiciousIPs.get(clientIP)?.count || 0) + 1,
          lastSeen: Date.now()
        });
        
        return res.status(400).json({
          success: false,
          error: 'Bad request',
          message: 'Request contains suspicious content'
        });
      }

      // 過度な不審なアクセスをチェック
      const suspiciousIP = this.suspiciousIPs.get(clientIP);
      if (suspiciousIP && suspiciousIP.count > 5) {
        await this.logSecurityEvent(
          SECURITY_EVENT_TYPES.SYSTEM_INTRUSION,
          'Multiple suspicious requests from same IP',
          {
            clientIP,
            suspiciousCount: suspiciousIP.count,
            timeWindow: Date.now() - suspiciousIP.lastSeen
          }
        );
        
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'Multiple security violations detected'
        });
      }

      next();
    } catch (error) {
      logger.error('Suspicious access detection error:', error);
      return res.status(500).json({
        success: false,
        error: 'Security check failed'
      });
    }
  }

  /**
   * セキュリティイベントのログ記録
   */
  async logSecurityEvent(eventType, message, details = {}) {
    try {
      const logEntry = {
        event: eventType,
        message,
        details,
        timestamp: new Date(),
        severity: this.getEventSeverity(eventType),
        source: 'security-enhanced'
      };

      // 監査ログに記録
      await auditLogger.log(logEntry);
      
      // 高重要度の場合はアラート
      if (logEntry.severity === 'high' || logEntry.severity === 'critical') {
        await this.sendSecurityAlert(logEntry);
      }

      logger.warn(`Security event: ${eventType} - ${message}`, details);
    } catch (error) {
      logger.error('Failed to log security event:', error);
    }
  }

  /**
   * イベントの重要度を取得
   */
  getEventSeverity(eventType) {
    const severityMap = {
      [SECURITY_EVENT_TYPES.AUTH_BYPASS_ATTEMPT]: 'high',
      [SECURITY_EVENT_TYPES.PRIVILEGE_ESCALATION]: 'critical',
      [SECURITY_EVENT_TYPES.SESSION_HIJACKING]: 'high',
      [SECURITY_EVENT_TYPES.SYSTEM_INTRUSION]: 'critical',
      [SECURITY_EVENT_TYPES.MULTIPLE_FAILED_ATTEMPTS]: 'medium',
      [SECURITY_EVENT_TYPES.SUSPICIOUS_PAYLOAD]: 'medium',
      [SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS]: 'medium',
      [SECURITY_EVENT_TYPES.CONCURRENT_SESSION]: 'low'
    };

    return severityMap[eventType] || 'low';
  }

  /**
   * セキュリティアラートの送信
   */
  async sendSecurityAlert(logEntry) {
    // TODO: 実装 - メール/Slack/SMS通知
    logger.error(`SECURITY ALERT: ${logEntry.event} - ${logEntry.message}`, logEntry.details);
  }

  /**
   * セッションIDの生成
   */
  generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * 定期的なクリーンアップ
   */
  cleanup() {
    const now = Date.now();
    const timeout = 24 * 60 * 60 * 1000; // 24時間

    // 古いセッションを削除
    for (const [userId, session] of this.activeSessions) {
      if (now - session.lastActivity > timeout) {
        this.activeSessions.delete(userId);
      }
    }

    // 古い不審なIPレコードを削除
    for (const [ip, record] of this.suspiciousIPs) {
      if (now - record.lastSeen > timeout) {
        this.suspiciousIPs.delete(ip);
      }
    }

    // 失敗回数をリセット
    this.failedAttempts.clear();
    
    this.lastCleanup = now;
  }

  /**
   * 定期クリーンアップの実行
   */
  startCleanupInterval() {
    setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }
}

// シングルトンインスタンス
const securityEnhancer = new SecurityEnhancer();

// 定期クリーンアップの開始
securityEnhancer.startCleanupInterval();

/**
 * セキュリティ強化ミドルウェア
 */
const enhancedSecurity = () => {
  return async (req, res, next) => {
    try {
      // 認証バイパス防止
      await securityEnhancer.checkAuthenticationBypass(req, res, () => {
        // 不審なアクセスの検出
        securityEnhancer.detectSuspiciousAccess(req, res, () => {
          // セッション管理の強化
          securityEnhancer.enhanceSessionManagement(req, res, () => {
            // 権限昇格攻撃の防止
            securityEnhancer.preventPrivilegeEscalation(req, res, next);
          });
        });
      });
    } catch (error) {
      logger.error('Enhanced security middleware error:', error);
      return res.status(500).json({
        success: false,
        error: 'Security check failed'
      });
    }
  };
};

module.exports = {
  securityEnhancer,
  enhancedSecurity,
  SECURITY_EVENT_TYPES
};