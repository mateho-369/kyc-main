/**
 * 🚨 CRITICAL SECURITY FIX: 特定のロールを持つユーザーのみアクセスを許可するミドルウェア
 * @param {Array} roles 許可するロールの配列（例: ['admin']）
 */
const checkRole = (roles) => {
  return (req, res, next) => {
    console.log('🔍 checkRole実行開始:', {
      requestPath: req.path,
      requestMethod: req.method,
      requiredRoles: roles,
      timestamp: new Date().toISOString()
    });
    
    // 🚨 CRITICAL: 認証されていない場合
    if (!req.user) {
      console.log('🚨 SECURITY ALERT: User not authenticated');
      return res.status(401).json({ 
        message: '認証されていません。アクセスが拒否されました。',
        code: 'UNAUTHORIZED'
      });
    }
    
    // 🚨 CRITICAL: userオブジェクトにroleが存在しない場合
    if (!req.user.role) {
      console.log('🚨 SECURITY ALERT: User role not found', {
        userId: req.user.id,
        userObject: req.user
      });
      return res.status(403).json({ 
        message: '権限情報が見つかりません。アクセスが拒否されました。',
        code: 'ROLE_NOT_FOUND'
      });
    }
    
    // 🚨 CRITICAL: 必要なロールを持っていない場合
    if (!roles.includes(req.user.role)) {
      console.log('🚨 SECURITY ALERT: Insufficient permissions', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: roles,
        accessPath: req.path
      });
      return res.status(403).json({ 
        message: '権限がありません。この操作にはシステム管理者権限が必要です。',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredRoles: roles,
        userRole: req.user.role
      });
    }
    
    console.log('✅ checkRole権限チェック通過:', {
      userId: req.user.id,
      userRole: req.user.role,
      requiredRoles: roles,
      accessPath: req.path
    });
    
    // 権限チェック通過
    next();
  };
};

// 両方のインポートスタイルをサポート
// const checkRole = require(...) と const { checkRole } = require(...) の両方に対応
module.exports = checkRole;
module.exports.checkRole = checkRole;