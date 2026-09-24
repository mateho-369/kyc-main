const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

// Firebase Admin SDKの初期化（既に初期化されている場合はスキップ）
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || 'adroit-standard-496710-r5'
  });
}

// セッション作成エンドポイント
router.post('/api/auth/session', async (req, res) => {
  const { idToken } = req.body;
  
  if (!idToken) {
    return res.status(400).json({ 
      success: false, 
      error: 'ID token is required' 
    });
  }
  
  try {
    // IDトークンを検証
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // セッションCookieを作成（有効期限: 5日間）
    const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5日間
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
    
    // httpOnly Cookieとして設定
    const options = {
      maxAge: expiresIn,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // 本番環境でのみHTTPS必須
      sameSite: 'strict',
      path: '/'
    };
    
    // Firebase Hostingの制約により __session という名前を使用
    res.cookie('__session', sessionCookie, options);
    
    // ユーザー情報も返す
    res.status(200).json({ 
      success: true,
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name
      }
    });
    
  } catch (error) {
    console.error('Session creation error:', error);
    res.status(401).json({ 
      success: false, 
      error: 'Invalid token' 
    });
  }
});

// セッションCookieを検証するミドルウェア
const verifySessionCookie = async (req, res, next) => {
  const sessionCookie = req.cookies.__session || '';
  
  if (!sessionCookie) {
    return res.status(401).json({ 
      success: false, 
      error: 'No session cookie found' 
    });
  }
  
  try {
    // セッションCookieを検証（checkRevoked: true でトークンの取り消しもチェック）
    const decodedClaims = await admin.auth().verifySessionCookie(
      sessionCookie, 
      true /* checkRevoked */
    );
    
    // リクエストオブジェクトにユーザー情報を追加
    req.firebaseUser = decodedClaims;
    next();
  } catch (error) {
    console.error('Session verification error:', error);
    res.status(401).json({ 
      success: false, 
      error: 'Invalid or expired session' 
    });
  }
};

// セッション検証エンドポイント（認証状態の確認用）
router.get('/api/auth/session', verifySessionCookie, (req, res) => {
  res.json({
    success: true,
    user: {
      uid: req.firebaseUser.uid,
      email: req.firebaseUser.email,
      name: req.firebaseUser.name
    }
  });
});

// ログアウトエンドポイント
router.post('/api/auth/logout', verifySessionCookie, async (req, res) => {
  const uid = req.firebaseUser.uid;
  
  try {
    // リフレッシュトークンを無効化（すべてのセッションを強制ログアウト）
    await admin.auth().revokeRefreshTokens(uid);
    
    // セッションCookieをクリア
    res.clearCookie('__session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    });
    
    res.status(200).json({ 
      success: true,
      message: 'Logged out successfully' 
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Logout failed' 
    });
  }
});

// 既存のトークン認証からセッション認証への移行エンドポイント
router.post('/api/auth/migrate-to-session', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      error: 'No token provided' 
    });
  }
  
  const idToken = authHeader.substring(7);
  
  try {
    // IDトークンを検証
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // 新しいセッションCookieを作成
    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
    
    const options = {
      maxAge: expiresIn,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    };
    
    res.cookie('__session', sessionCookie, options);
    res.status(200).json({ 
      success: true,
      message: 'Migrated to session cookie authentication' 
    });
    
  } catch (error) {
    console.error('Migration error:', error);
    res.status(401).json({ 
      success: false, 
      error: 'Invalid token' 
    });
  }
});

module.exports = {
  router,
  verifySessionCookie
};