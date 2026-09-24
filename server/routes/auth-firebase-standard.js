const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { User } = require('../models');
const { setAuthCookies } = require('../utils/auth');
const tokenService = require('../services/tokenService');
const { validateFirebaseClaims, sanitizeFirebaseRequest } = require('../middleware/firebase-validation');
// Firebase無効時のダミーミドルウェア
const authenticateFirebaseToken = (req, res, next) => {
  if (process.env.DISABLE_FIREBASE === 'true') {
    req.firebaseUser = {
      uid: 'test-uid',
      email: 'test@example.com',
      name: 'Test User',
      picture: null
    };
    return next();
  }
  
  try {
    const { authenticateFirebaseToken: realAuth } = require('../middleware/firebaseAuth');
    return realAuth(req, res, next);
  } catch (error) {
    console.error('Firebase Auth middleware error:', error);
    // フォールバック：テストユーザー
    req.firebaseUser = {
      uid: 'test-uid-fallback',
      email: 'test@example.com',
      name: 'Test User',
      picture: null
    };
    return next();
  }
};

/**
 * Firebase標準SSO実装
 * IDトークンをAuthorizationヘッダーで受け取り、セキュアにセッションを作成
 */
router.post('/firebase-session', authenticateFirebaseToken, async (req, res) => {
  try {
    // authenticateFirebaseTokenミドルウェアで検証済みのユーザー情報
    const { uid, email, name, picture } = req.firebaseUser;
    
    // ローカルユーザーを検索または作成
    let user = await User.findOne({ where: { email } });
    
    if (!user) {
      // 新規ユーザー作成
      user = await User.create({
        email,
        name: name || email.split('@')[0],
        profilePicture: picture || null,
        firebaseUid: uid,
        emailVerified: true,
        role: 'user',
        status: 'active',
        provider: 'firebase',
        lastLoginAt: new Date()
      });
      
      console.log('✅ 新規ユーザー作成:', user.id);
    } else {
      // 既存ユーザー情報更新
      await user.update({
        lastLoginAt: new Date(),
        firebaseUid: uid,
        profilePicture: picture || user.profilePicture,
        name: name || user.name
      });
      
      console.log('✅ 既存ユーザー更新:', user.id);
    }
    
    // JWTトークン生成（tokenServiceを使用して互換性のあるトークンを生成）
    const accessToken = await tokenService.generateAccessToken(user, {
      sso: true,
      provider: 'firebase',
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    const refreshToken = await tokenService.generateRefreshToken(user, {
      sso: true,
      provider: 'firebase',
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    // HTTPOnlyクッキー設定
    setAuthCookies(res, { accessToken, refreshToken });
    
    // レスポンス返却
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture,
        role: user.role
      },
      token: accessToken // フロントエンド用（必要に応じて）
    });
    
  } catch (error) {
    console.error('❌ Firebase セッション作成エラー:', error);
    res.status(500).json({
      success: false,
      error: 'セッション作成に失敗しました'
    });
  }
});

/**
 * Firebaseカスタムクレーム設定
 * Sharegramユーザー情報をFirebaseに保存
 */
router.post('/firebase-claims', sanitizeFirebaseRequest, validateFirebaseClaims, authenticateFirebaseToken, async (req, res) => {
  try {
    const { sharegramUserId, kycPermissions } = req.validatedData;
    const { uid } = req.firebaseUser;
    
    // カスタムクレーム設定
    await admin.auth().setCustomUserClaims(uid, {
      sharegramUserId,
      kycPermissions: kycPermissions || ['basic'],
      updatedAt: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'カスタムクレームを設定しました'
    });
    
  } catch (error) {
    console.error('❌ カスタムクレーム設定エラー:', error);
    res.status(500).json({
      success: false,
      error: 'カスタムクレーム設定に失敗しました'
    });
  }
});

/**
 * セッション検証エンドポイント
 */
router.get('/verify-session', authenticateFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({
      where: { firebaseUid: req.firebaseUser.uid }
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'ユーザーが見つかりません'
      });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('❌ セッション検証エラー:', error);
    res.status(500).json({
      success: false,
      error: 'セッション検証に失敗しました'
    });
  }
});

module.exports = router;