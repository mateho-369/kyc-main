const jwt = require('jsonwebtoken');
const { User, FirebaseUser } = require('../models');
const { verifyIdToken, logger } = require('../config/firebase-admin');
const { cookieConfig } = require('./security');

/**
 * ハイブリッド認証ミドルウェア
 * JWT（既存）とFirebase認証の両方をサポート
 */
const authHybrid = async (req, res, next) => {
  try {
    // ヘッダーからトークンを取得
    const jwtToken = req.header('Authorization')?.replace('Bearer ', '');
    const firebaseToken = req.header('Firebase-Token');
    
    // トークンが存在しない場合
    if (!jwtToken && !firebaseToken) {
      return res.status(401).json({ 
        error: '認証が必要です',
        message: 'Authorization または Firebase-Token ヘッダーが必要です'
      });
    }
    
    let user = null;
    let authMethod = null;
    
    // Firebase認証を優先
    if (firebaseToken) {
      try {
        // Firebase IDトークンの検証
        const decodedToken = await verifyIdToken(firebaseToken, true);
        
        // FirebaseユーザーをDBから取得または作成
        let firebaseUser = await FirebaseUser.findByFirebaseUid(decodedToken.uid);
        
        if (!firebaseUser) {
          // 新規Firebaseユーザーの場合
          firebaseUser = await FirebaseUser.create({
            firebaseUid: decodedToken.uid,
            email: decodedToken.email || '',
            displayName: decodedToken.name || decodedToken.email?.split('@')[0] || '',
            emailVerified: decodedToken.email_verified || false,
            providerId: decodedToken.firebase?.sign_in_provider || 'unknown',
            firebaseMetadata: {
              lastSignInTime: new Date().toISOString(),
              creationTime: new Date(decodedToken.auth_time * 1000).toISOString()
            }
          });
          
          // ローカルユーザーと同期
          await firebaseUser.syncWithLocalUser();
        }
        
        // ローカルユーザーを取得
        if (firebaseUser.userId) {
          user = await User.findByPk(firebaseUser.userId);
        } else {
          // ローカルユーザーがまだ存在しない場合は作成
          const localUser = await firebaseUser.syncWithLocalUser();
          user = localUser;
        }
        
        authMethod = 'firebase';
        
        // カスタムクレームの適用
        if (decodedToken.customClaims) {
          req.customClaims = decodedToken.customClaims;
        }
        
        // 最終ログイン時刻を更新
        if (user) {
          await user.update({ lastLoginAt: new Date() });
        }
        
      } catch (firebaseError) {
        console.error('Firebase認証エラー:', firebaseError.message);
        
        // Firebaseトークンが無効でもJWTがある場合は続行
        if (!jwtToken) {
          return res.status(401).json({ 
            error: 'Firebase認証エラー',
            message: firebaseError.message 
          });
        }
      }
    }
    
    // JWT認証（Firebaseで認証されていない場合）
    if (!user && jwtToken) {
      try {
        // JWTトークンの検証
        const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET);
        
        // ユーザー情報を取得
        user = await User.findByPk(decoded.user.id);
        
        if (!user) {
          throw new Error('ユーザーが見つかりません');
        }
        
        authMethod = 'jwt';
        
        // 最終ログイン時刻を更新
        await user.update({ lastLoginAt: new Date() });
        
      } catch (jwtError) {
        return res.status(401).json({ 
          error: 'JWT認証エラー',
          message: 'トークンが無効または期限切れです'
        });
      }
    }
    
    // 認証成功
    if (user) {
      // リクエストオブジェクトにユーザー情報を追加
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      };
      req.authMethod = authMethod;
      req.userId = user.id;
      
      // 監査ログ用の情報を追加
      req.authInfo = {
        method: authMethod,
        userId: user.id,
        userEmail: user.email,
        timestamp: new Date().toISOString()
      };
      
      next();
    } else {
      return res.status(401).json({ 
        error: '認証エラー',
        message: 'ユーザー情報の取得に失敗しました'
      });
    }
    
  } catch (error) {
    console.error('認証ミドルウェアエラー:', error);
    return res.status(500).json({ 
      error: 'サーバーエラー',
      message: '認証処理中にエラーが発生しました'
    });
  }
};

/**
 * オプショナル認証ミドルウェア
 * 認証は必須ではないが、トークンがある場合は検証する
 */
const authOptional = async (req, res, next) => {
  const jwtToken = req.header('Authorization')?.replace('Bearer ', '');
  const firebaseToken = req.header('Firebase-Token');
  
  if (!jwtToken && !firebaseToken) {
    // トークンがない場合はそのまま続行
    req.user = null;
    return next();
  }
  
  // トークンがある場合は通常の認証を実行
  return authHybrid(req, res, next);
};

/**
 * 管理者権限チェックミドルウェア
 * authHybridの後に使用
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ 
      error: 'アクセス拒否',
      message: '管理者権限が必要です'
    });
  }
  next();
};

/**
 * レート制限チェック（API保護）
 */
const checkRateLimit = async (req, res, next) => {
  // 簡易的なレート制限実装
  const userId = req.user?.id || req.ip;
  const key = `rate_limit:${userId}:${req.path}`;
  
  // TODO: Redisなどを使用した本格的な実装に置き換え
  next();
};

module.exports = {
  authHybrid,
  authOptional,
  requireAdmin,
  checkRateLimit
};