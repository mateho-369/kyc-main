const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { User } = require('../models');
const { generateTokens, setAuthCookies } = require('../utils/auth');
const { validateFirebaseClaims, sanitizeFirebaseRequest } = require('../middleware/firebase-validation');

// Custom Firebase token authentication middleware
const authenticateFirebaseToken = async (req, res, next) => {
  try {
    // Check if Firebase is disabled
    if (process.env.DISABLE_FIREBASE === 'true') {
      req.firebaseUser = {
        uid: 'test-uid',
        email: 'test@example.com',
        name: 'Test User',
        picture: null,
        email_verified: true
      };
      console.log('⚠️ Firebase disabled - using test user');
      return next();
    }

    // Extract ID token from request
    const idToken = req.body?.idToken || req.headers.authorization?.replace('Bearer ', '');

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Firebase ID token is required'
      });
    }

    // Verify Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    req.firebaseUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || decodedToken.email?.split('@')[0],
      picture: decodedToken.picture || null,
      email_verified: decodedToken.email_verified || false
    };

    console.log('✅ Firebase ID Token verified:', req.firebaseUser.email);
    next();

  } catch (error) {
    console.error('❌ Firebase token verification error:', error);

    // Provide detailed error message
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Firebase ID token has expired'
      });
    } else if (error.code === 'auth/argument-error') {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Invalid Firebase ID token format'
      });
    } else {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or expired Firebase ID token'
      });
    }
  }
};

/**
 * Firebase標準SSO実装 - セッション作成
 * IDトークンをAuthorizationヘッダーまたはリクエストボディで受け取り、セキュアにセッションを作成
 *
 * Support both /firebase-session and /firebase/session paths for compatibility
 */
router.post(['/firebase-session', '/firebase/session'], authenticateFirebaseToken, async (req, res) => {
  try {
    // authenticateFirebaseTokenミドルウェアで検証済みのユーザー情報
    const { uid, email, name, picture } = req.firebaseUser;

    console.log('🔐 Creating session for Firebase user:', email);

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

    // JWTトークン生成
    const { accessToken, refreshToken } = generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      firebaseUid: uid
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
      error: 'セッション作成に失敗しました',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Firebaseカスタムクレーム設定
 * Sharegramユーザー情報をFirebaseに保存
 */
router.post(['/firebase-claims'], sanitizeFirebaseRequest, validateFirebaseClaims, authenticateFirebaseToken, async (req, res) => {
  try {
    const { sharegramUserId, kycPermissions } = req.validatedData;
    const { uid } = req.firebaseUser;

    console.log('🔐 Setting custom claims for Firebase user:', uid);

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
      error: 'カスタムクレーム設定に失敗しました',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
      error: 'セッション検証に失敗しました',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
