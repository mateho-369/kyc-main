// セッションエンドポイントをkyc-api-complete.jsに追加するパッチ

// ========== Firebase セッションCookie認証エンドポイント ==========

// セッション作成エンドポイント
app.post('/api/auth/session', async (req, res) => {
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
    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
    
    // httpOnly Cookieとして設定
    const options = {
      maxAge: expiresIn,
      httpOnly: true,
      secure: false, // HTTPで動作確認のため一時的にfalse
      sameSite: 'lax', // CORSを考慮してlaxに設定
      path: '/'
    };
    
    res.cookie('__session', sessionCookie, options);
    
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
    const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
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

// セッション検証エンドポイント
app.get('/api/auth/session', verifySessionCookie, (req, res) => {
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
app.post('/api/auth/logout', async (req, res) => {
  // セッションCookieをクリア
  res.clearCookie('__session', {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/'
  });
  
  res.status(200).json({ 
    success: true,
    message: 'Logged out successfully' 
  });
});

// 既存の /api/auth/me エンドポイントを更新（セッションCookie対応）
app.get("/api/auth/me", async (req, res) => {
  // まずセッションCookieをチェック
  const sessionCookie = req.cookies.__session || '';
  
  if (sessionCookie) {
    try {
      const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
      return res.json({
        success: true,
        user: {
          uid: decodedClaims.uid,
          email: decodedClaims.email,
          name: decodedClaims.name,
          role: 'user',
          id: decodedClaims.uid
        }
      });
    } catch (error) {
      console.log('セッションCookie検証失敗:', error.message);
    }
  }
  
  // セッションCookieがない場合は従来の認証方法にフォールバック
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token === "test-token-2025" || token.length > 20) {
      return res.json({ 
        success: true, 
        user: { 
          email: "test@example.com", 
          role: "user", 
          id: "user-123" 
        }
      });
    }
  }
  
  res.status(401).json({ 
    success: false, 
    error: "Authentication required" 
  });
});