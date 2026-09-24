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
const { authenticateFirebase } = require('../middleware/firebaseAuth');

// Important: never fall back to a shared "Test User" for a real SSO request.
// The old code imported a non-existent authenticateFirebaseToken export, caught
// that error, and authenticated every Sharegram account as test@example.com.
const authenticateFirebaseToken = authenticateFirebase({ required: true });

/**
 * Firebase標準SSO実装
 * IDトークンをAuthorizationヘッダーで受け取り、セキュアにセッションを作成
 */
router.post('/firebase-session', authenticateFirebaseToken, async (req, res) => {
  try {
    // authenticateFirebaseTokenミドルウェアで検証済みのユーザー情報
    // firebaseAuth places the verified Firebase identity on req.user and the
    // complete verified claims on req.firebaseToken. Do not use client data.
    const identity = req.user || {};
    const claims = req.firebaseToken || {};
    const uid = claims.uid || identity.firebaseUid || identity.uid;
    const email = claims.email || identity.email;
    // Firebase ID tokens do not always include displayName. Read the
    // authoritative Firebase Auth profile as well; Sharegram should set this
    // when it creates/updates the account.
    let firebaseProfile = null;
    try {
      firebaseProfile = await admin.auth().getUser(uid);
    } catch (profileError) {
      console.warn('Could not load Firebase profile:', profileError.message);
    }
    const name = firebaseProfile?.displayName || claims.account_name || claims.accountName || claims.name || claims.displayName || identity.name || email?.split('@')[0];
    const picture = firebaseProfile?.photoURL || claims.picture || claims.photoURL || null;

    if (!uid || !email) {
      return res.status(401).json({ success: false, error: 'Firebase token has no user identity' });
    }
    
    // Search by Firebase UID first, then email. This prevents an account from
    // being accidentally attached to whichever local user happens to be first.
    let user = await User.findOne({ where: { firebaseUid: uid } });
    if (!user) user = await User.findOne({ where: { email } });
    
    if (!user) {
      // 新規ユーザー作成
      user = await User.create({
        email,
        name,
        profilePicture: picture,
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
        // Firebase password tokens often contain no display name. Preserve an
        // existing name; otherwise use the stable email local-part fallback.
        name: name || user.name || email.split('@')[0]
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