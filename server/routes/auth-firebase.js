const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { User } = require('../models');
const { csrfProtection, generateCSRFToken } = require('../middleware/security');
const { 
  validateFirebaseVerify, 
  validateFirebaseSSOQuery,
  sanitizeFirebaseRequest,
  validateRedirectUrl 
} = require('../middleware/firebase-validation');
const asyncHandler = require('../utils/asyncHandler');

// Firebase Admin SDK初期化（エラーハンドリング強化）
const initializeFirebase = () => {
  try {
    if (!admin.apps.length) {
      // 環境変数の存在確認
      if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
        console.warn('Firebase環境変数が不完全です。モックモードで動作します。');
        return false;
      }
      
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL
        })
      });
      console.log('Firebase Admin SDK initialized successfully');
      return true;
    }
    return true;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    return false;
  }
};

// 初期化
initializeFirebase();

// Firebase ID Token検証エンドポイント
router.post('/firebase-verify', sanitizeFirebaseRequest, validateFirebaseVerify, asyncHandler(async (req, res) => {
  try {
    const { id_token, client_id } = req.validatedData;

    // Firebase ID Tokenを検証（エラーハンドリング付き）
    let decodedToken;
    try {
      if (!admin.apps.length) {
        console.warn('Firebase未初期化、モック認証を使用');
        decodedToken = {
          uid: 'mock-uid-' + Date.now(),
          email: 'mock@example.com',
          name: 'Mock User'
        };
      } else {
        decodedToken = await admin.auth().verifyIdToken(id_token);
      }
    } catch (error) {
      console.error('Firebase token verification error:', error);
      return res.status(401).json({
        success: false,
        error: {
          code: 'FIREBASE_AUTH_ERROR',
          message: 'ID Tokenの検証に失敗しました'
        }
      });
    }
    
    // ユーザー情報取得
    const firebaseUser = await admin.auth().getUser(decodedToken.uid);

    // ローカルユーザーを作成または更新
    let user = await User.findOne({ 
      where: { email: firebaseUser.email } 
    });

    if (!user) {
      // 新規ユーザー作成
      user = await User.create({
        email: firebaseUser.email,
        name: firebaseUser.displayName || 'Sharegram User',
        password: require('crypto').randomBytes(32).toString('hex'),
        role: 'user',
        firebaseUid: decodedToken.uid,
        sharegramUserId: decodedToken.sharegram_user_id || null
      });
    } else {
      // 既存ユーザー更新
      await user.update({
        name: firebaseUser.displayName || user.name,
        firebaseUid: decodedToken.uid,
        sharegramUserId: decodedToken.sharegram_user_id || user.sharegramUserId
      });
    }

    // ローカルセッショントークン生成
    const payload = {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        firebaseUid: user.firebaseUid,
        sharegramUserId: user.sharegramUserId
      }
    };

    const sessionToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '24h'
    });

    // Generate CSRF token for the session
    const csrfToken = generateCSRFToken();
    res.cookie('csrf-token', csrfToken, {
      httpOnly: false, // Must be readable by JavaScript
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000 // 1 hour
    });

    res.json({
      success: true,
      data: {
        user: {
          firebase_uid: decodedToken.uid,
          name: user.name,
          email: user.email,
          external_id: user.sharegramUserId
        },
        session_token: sessionToken,
        csrf_token: csrfToken
      }
    });

  } catch (error) {
    console.error('Firebase認証エラー:', error);
    
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_EXPIRED_TOKEN',
          message: 'ID Tokenの有効期限が切れています'
        }
      });
    }

    if (error.code === 'auth/invalid-id-token') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_INVALID_TOKEN',
          message: 'ID Tokenが無効です'
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'FIREBASE_AUTH_ERROR',
        message: 'Firebase認証に失敗しました'
      }
    });
  }
}));

// リダイレクトURL検証用ホワイトリスト
const isAllowedRedirect = (url) => {
  if (!url) return false;
  
  // 相対パスを許可
  if (url.startsWith('/') && !url.startsWith('//')) {
    return true;
  }
  
  // 許可されたドメインのリスト
  const allowedDomains = [
    'https://stg.id-manager.com',
    'https://id-manager.com',
    process.env.FRONTEND_URL
  ].filter(Boolean);
  
  try {
    const urlObj = new URL(url);
    return allowedDomains.some(domain => {
      const domainObj = new URL(domain);
      return urlObj.origin === domainObj.origin;
    });
  } catch {
    return false;
  }
};

// Firebase SSO認証開始（即座にリダイレクト方式）
router.get('/firebase-sso', sanitizeFirebaseRequest, validateFirebaseSSOQuery, asyncHandler(async (req, res) => {
  try {
    const { id_token, redirect_url } = req.validatedQuery;

    // ID Tokenを検証 (checkRevoked=true で失効チェック)
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(id_token, true);
    } catch (error) {
      console.error('Firebase SSO: Token verification failed:', error);
      if (error.code === 'auth/id-token-expired') {
        return res.status(401).redirect('/login?error=AUTH_EXPIRED_TOKEN');
      }
      return res.status(401).redirect('/login?error=AUTH_INVALID_TOKEN');
    }
    
    // ユーザー情報取得
    const firebaseUser = await admin.auth().getUser(decodedToken.uid);

    // ローカルユーザーを作成または更新
    let user = await User.findOne({ 
      where: { email: firebaseUser.email } 
    });

    if (!user) {
      user = await User.create({
        email: firebaseUser.email,
        name: firebaseUser.displayName || 'Sharegram User',
        password: require('crypto').randomBytes(32).toString('hex'),
        role: 'user',
        firebaseUid: decodedToken.uid,
        sharegramUserId: decodedToken.sharegram_user_id || null
      });
    } else {
      await user.update({
        firebaseUid: decodedToken.uid,
        sharegramUserId: decodedToken.sharegram_user_id || user.sharegramUserId,
        lastLogin: new Date()
      });
    }

    // ローカルセッショントークン生成
    const payload = {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        firebaseUid: user.firebaseUid,
        sharegramUserId: user.sharegramUserId
      }
    };

    const sessionToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '24h'
    });
    
    const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
      expiresIn: '7d'
    });

    // セッショントークンをHttpOnly Cookieとして設定
    res.cookie('session_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    // リフレッシュトークンもCookieに設定
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // CSRF token生成と設定
    const csrfToken = generateCSRFToken();
    res.cookie('csrf-token', csrfToken, {
      httpOnly: false, // JavaScriptから読める必要がある
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600000 // 1 hour
    });

    // リダイレクトURLをホワイトリストで検証
    const safeRedirectUrl = validateRedirectUrl(redirect_url);
    
    // 即座に指定されたURLへ302リダイレクト（中間画面なし）
    console.log(`Firebase SSO: Successful login for ${user.email}, redirecting to ${safeRedirectUrl}`);
    return res.redirect(302, safeRedirectUrl);

  } catch (error) {
    console.error('Firebase SSO認証エラー:', error);
    // エラー時のみログイン画面を表示
    return res.status(401).redirect('/login?error=AUTH_FIREBASE_ERROR');
  }
}));

// Firebase連携状態確認
router.get('/firebase-status', asyncHandler(async (req, res) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
      return res.json({ 
        success: true,
        data: { connected: false }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findByPk(decoded.user.id);
    
    res.json({
      success: true,
      data: {
        connected: !!user.firebaseUid,
        firebaseUid: user.firebaseUid,
        sharegramUserId: user.sharegramUserId
      }
    });

  } catch (err) {
    res.json({
      success: true,
      data: { connected: false }
    });
  }
}));

module.exports = router;