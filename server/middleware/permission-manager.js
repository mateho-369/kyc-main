/**
 * 権限管理システム
 * 
 * 特徴:
 * - ロールベースアクセス制御（RBAC）
 * - パーミッションベースアクセス制御
 * - 階層的権限管理
 * - 動的権限チェック
 * - 細粒度のアクセス制御
 */

const { User, Role, Permission, UserRole, RolePermission } = require('../models');
const { logger } = require('../utils/logger/logger');
const { auditLogger } = require('../utils/logger/auditLogger');

/**
 * 権限定義
 */
const PERMISSIONS = {
  // システム管理
  SYSTEM_ADMIN: 'system:admin',
  SYSTEM_CONFIG: 'system:config',
  SYSTEM_LOGS: 'system:logs',
  
  // ユーザー管理
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_LIST: 'user:list',
  
  // パフォーマー管理
  PERFORMER_CREATE: 'performer:create',
  PERFORMER_READ: 'performer:read',
  PERFORMER_UPDATE: 'performer:update',
  PERFORMER_DELETE: 'performer:delete',
  PERFORMER_LIST: 'performer:list',
  PERFORMER_APPROVE: 'performer:approve',
  PERFORMER_SUSPEND: 'performer:suspend',
  
  // KYC管理
  KYC_CREATE: 'kyc:create',
  KYC_READ: 'kyc:read',
  KYC_UPDATE: 'kyc:update',
  KYC_DELETE: 'kyc:delete',
  KYC_VERIFY: 'kyc:verify',
  KYC_APPROVE: 'kyc:approve',
  KYC_REJECT: 'kyc:reject',
  
  // ドキュメント管理
  DOCUMENT_CREATE: 'document:create',
  DOCUMENT_READ: 'document:read',
  DOCUMENT_UPDATE: 'document:update',
  DOCUMENT_DELETE: 'document:delete',
  DOCUMENT_DOWNLOAD: 'document:download',
  
  // 監査ログ
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',
  
  // API管理
  API_READ: 'api:read',
  API_WRITE: 'api:write',
  API_ADMIN: 'api:admin',
  
  // 統合管理
  INTEGRATION_READ: 'integration:read',
  INTEGRATION_WRITE: 'integration:write',
  INTEGRATION_ADMIN: 'integration:admin'
};

/**
 * デフォルトロール定義
 */
const DEFAULT_ROLES = {
  SUPER_ADMIN: {
    name: 'super_admin',
    displayName: 'Super Administrator',
    description: 'Full system access',
    permissions: Object.values(PERMISSIONS),
    level: 1000
  },
  ADMIN: {
    name: 'admin',
    displayName: 'Administrator',
    description: 'Administrative access',
    permissions: [
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.USER_LIST,
      PERMISSIONS.PERFORMER_CREATE,
      PERMISSIONS.PERFORMER_READ,
      PERMISSIONS.PERFORMER_UPDATE,
      PERMISSIONS.PERFORMER_LIST,
      PERMISSIONS.PERFORMER_APPROVE,
      PERMISSIONS.PERFORMER_SUSPEND,
      PERMISSIONS.KYC_CREATE,
      PERMISSIONS.KYC_READ,
      PERMISSIONS.KYC_UPDATE,
      PERMISSIONS.KYC_VERIFY,
      PERMISSIONS.KYC_APPROVE,
      PERMISSIONS.KYC_REJECT,
      PERMISSIONS.DOCUMENT_CREATE,
      PERMISSIONS.DOCUMENT_READ,
      PERMISSIONS.DOCUMENT_UPDATE,
      PERMISSIONS.DOCUMENT_DELETE,
      PERMISSIONS.DOCUMENT_DOWNLOAD,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.API_READ,
      PERMISSIONS.API_WRITE,
      PERMISSIONS.INTEGRATION_READ,
      PERMISSIONS.INTEGRATION_WRITE
    ],
    level: 800
  },
  MODERATOR: {
    name: 'moderator',
    displayName: 'Moderator',
    description: 'Content moderation access',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_LIST,
      PERMISSIONS.PERFORMER_READ,
      PERMISSIONS.PERFORMER_LIST,
      PERMISSIONS.PERFORMER_APPROVE,
      PERMISSIONS.PERFORMER_SUSPEND,
      PERMISSIONS.KYC_READ,
      PERMISSIONS.KYC_VERIFY,
      PERMISSIONS.DOCUMENT_READ,
      PERMISSIONS.DOCUMENT_DOWNLOAD,
      PERMISSIONS.API_READ
    ],
    level: 600
  },
  SUPPORT: {
    name: 'support',
    displayName: 'Support Staff',
    description: 'Customer support access',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_LIST,
      PERMISSIONS.PERFORMER_READ,
      PERMISSIONS.PERFORMER_LIST,
      PERMISSIONS.KYC_READ,
      PERMISSIONS.DOCUMENT_READ,
      PERMISSIONS.API_READ
    ],
    level: 400
  },
  USER: {
    name: 'user',
    displayName: 'Regular User',
    description: 'Basic user access',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.PERFORMER_READ,
      PERMISSIONS.KYC_CREATE,
      PERMISSIONS.KYC_READ,
      PERMISSIONS.DOCUMENT_CREATE,
      PERMISSIONS.DOCUMENT_READ
    ],
    level: 200
  },
  GUEST: {
    name: 'guest',
    displayName: 'Guest',
    description: 'Limited access',
    permissions: [
      PERMISSIONS.USER_READ
    ],
    level: 100
  }
};

/**
 * 権限管理クラス
 */
class PermissionManager {
  constructor() {
    this.permissionCache = new Map();
    this.roleCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5分間のキャッシュ
  }

  /**
   * ユーザーの権限を取得
   */
  async getUserPermissions(userId) {
    const cacheKey = `user_permissions_${userId}`;
    const cached = this.permissionCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.permissions;
    }

    try {
      const user = await User.findByPk(userId, {
        include: [{
          model: Role,
          through: { attributes: [] },
          include: [{
            model: Permission,
            through: { attributes: [] }
          }]
        }]
      });

      if (!user) {
        throw new Error('User not found');
      }

      const permissions = new Set();
      
      // ロールから権限を取得
      if (user.Roles) {
        user.Roles.forEach(role => {
          if (role.Permissions) {
            role.Permissions.forEach(permission => {
              permissions.add(permission.name);
            });
          }
        });
      }

      // レガシー role フィールドからの権限も追加
      if (user.role && DEFAULT_ROLES[user.role.toUpperCase()]) {
        const rolePermissions = DEFAULT_ROLES[user.role.toUpperCase()].permissions;
        rolePermissions.forEach(permission => permissions.add(permission));
      }

      const userPermissions = Array.from(permissions);
      
      // キャッシュに保存
      this.permissionCache.set(cacheKey, {
        permissions: userPermissions,
        timestamp: Date.now()
      });

      return userPermissions;
      
    } catch (error) {
      logger.error('Error getting user permissions:', error);
      return [];
    }
  }

  /**
   * ユーザーの権限をチェック
   */
  async checkPermission(userId, requiredPermission) {
    try {
      const userPermissions = await this.getUserPermissions(userId);
      return userPermissions.includes(requiredPermission);
    } catch (error) {
      logger.error('Error checking permission:', error);
      return false;
    }
  }

  /**
   * 複数権限をチェック（すべて必要）
   */
  async checkAllPermissions(userId, requiredPermissions) {
    try {
      const userPermissions = await this.getUserPermissions(userId);
      return requiredPermissions.every(permission => 
        userPermissions.includes(permission)
      );
    } catch (error) {
      logger.error('Error checking all permissions:', error);
      return false;
    }
  }

  /**
   * 複数権限をチェック（いずれか必要）
   */
  async checkAnyPermission(userId, requiredPermissions) {
    try {
      const userPermissions = await this.getUserPermissions(userId);
      return requiredPermissions.some(permission => 
        userPermissions.includes(permission)
      );
    } catch (error) {
      logger.error('Error checking any permission:', error);
      return false;
    }
  }

  /**
   * 階層的権限チェック
   */
  async checkHierarchicalPermission(userId, requiredRole) {
    try {
      const user = await User.findByPk(userId);
      if (!user) return false;

      const userRoleLevel = DEFAULT_ROLES[user.role?.toUpperCase()]?.level || 0;
      const requiredRoleLevel = DEFAULT_ROLES[requiredRole.toUpperCase()]?.level || 0;

      return userRoleLevel >= requiredRoleLevel;
    } catch (error) {
      logger.error('Error checking hierarchical permission:', error);
      return false;
    }
  }

  /**
   * リソースベースの権限チェック
   */
  async checkResourcePermission(userId, resource, action, resourceOwnerId = null) {
    try {
      const permission = `${resource}:${action}`;
      const hasPermission = await this.checkPermission(userId, permission);
      
      if (hasPermission) {
        return true;
      }

      // 自分のリソースの場合は読み取り権限を許可
      if (resourceOwnerId && userId === resourceOwnerId && action === 'read') {
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error checking resource permission:', error);
      return false;
    }
  }

  /**
   * 権限キャッシュをクリア
   */
  clearCache(userId = null) {
    if (userId) {
      this.permissionCache.delete(`user_permissions_${userId}`);
    } else {
      this.permissionCache.clear();
    }
  }

  /**
   * デフォルトロールを初期化
   */
  async initializeDefaultRoles() {
    try {
      for (const [roleName, roleData] of Object.entries(DEFAULT_ROLES)) {
        // ロールの作成または更新
        const [role] = await Role.findOrCreate({
          where: { name: roleData.name },
          defaults: {
            displayName: roleData.displayName,
            description: roleData.description,
            level: roleData.level
          }
        });

        // 権限の作成または更新
        for (const permissionName of roleData.permissions) {
          const [permission] = await Permission.findOrCreate({
            where: { name: permissionName },
            defaults: {
              displayName: permissionName,
              description: `Permission: ${permissionName}`
            }
          });

          // ロールと権限の関連付け
          await RolePermission.findOrCreate({
            where: {
              roleId: role.id,
              permissionId: permission.id
            }
          });
        }
      }

      logger.info('Default roles and permissions initialized successfully');
    } catch (error) {
      logger.error('Error initializing default roles:', error);
      throw error;
    }
  }
}

// シングルトンインスタンス
const permissionManager = new PermissionManager();

/**
 * 権限チェックミドルウェア
 */
const requirePermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          message: 'User not authenticated'
        });
      }

      const hasPermission = await permissionManager.checkPermission(
        req.user.id,
        requiredPermission
      );

      if (!hasPermission) {
        // 監査ログに記録
        await auditLogger.log({
          event: 'PERMISSION_DENIED',
          userId: req.user.id,
          requiredPermission,
          path: req.originalUrl,
          method: req.method,
          ip: req.ip
        });

        return res.status(403).json({
          success: false,
          error: 'Permission denied',
          message: 'Insufficient permissions',
          required: requiredPermission
        });
      }

      next();
    } catch (error) {
      logger.error('Permission check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Permission check failed',
        message: 'Internal server error'
      });
    }
  };
};

/**
 * 複数権限チェックミドルウェア（すべて必要）
 */
const requireAllPermissions = (requiredPermissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const hasAllPermissions = await permissionManager.checkAllPermissions(
        req.user.id,
        requiredPermissions
      );

      if (!hasAllPermissions) {
        await auditLogger.log({
          event: 'PERMISSION_DENIED',
          userId: req.user.id,
          requiredPermissions,
          path: req.originalUrl,
          method: req.method,
          ip: req.ip
        });

        return res.status(403).json({
          success: false,
          error: 'Permission denied',
          message: 'Insufficient permissions',
          required: requiredPermissions
        });
      }

      next();
    } catch (error) {
      logger.error('Permission check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Permission check failed'
      });
    }
  };
};

/**
 * 複数権限チェックミドルウェア（いずれか必要）
 */
const requireAnyPermission = (requiredPermissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const hasAnyPermission = await permissionManager.checkAnyPermission(
        req.user.id,
        requiredPermissions
      );

      if (!hasAnyPermission) {
        await auditLogger.log({
          event: 'PERMISSION_DENIED',
          userId: req.user.id,
          requiredPermissions,
          path: req.originalUrl,
          method: req.method,
          ip: req.ip
        });

        return res.status(403).json({
          success: false,
          error: 'Permission denied',
          message: 'Insufficient permissions',
          required: requiredPermissions
        });
      }

      next();
    } catch (error) {
      logger.error('Permission check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Permission check failed'
      });
    }
  };
};

/**
 * 階層的権限チェックミドルウェア
 */
const requireRole = (requiredRole) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const hasRole = await permissionManager.checkHierarchicalPermission(
        req.user.id,
        requiredRole
      );

      if (!hasRole) {
        await auditLogger.log({
          event: 'ROLE_DENIED',
          userId: req.user.id,
          requiredRole,
          userRole: req.user.role,
          path: req.originalUrl,
          method: req.method,
          ip: req.ip
        });

        return res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'Insufficient role level',
          required: requiredRole,
          current: req.user.role
        });
      }

      next();
    } catch (error) {
      logger.error('Role check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Role check failed'
      });
    }
  };
};

module.exports = {
  permissionManager,
  PERMISSIONS,
  DEFAULT_ROLES,
  requirePermission,
  requireAllPermissions,
  requireAnyPermission,
  requireRole
};