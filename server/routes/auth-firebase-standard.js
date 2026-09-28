const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const admin = require('firebase-admin');
const { User } = require('../models');
const { setAuthCookies } = require('../utils/auth');
const tokenService = require('../services/tokenService');
const { authenticateFirebase } = require('../middleware/firebaseAuth');
const sharegramAccount = require('../services/sharegram/sharegramAccountService');

// Important: never fall back to a shared "Test User" for a real SSO request.
// The old code imported a non-existent authenticateFirebaseToken export, caught
// that error, and authenticated every Sharegram account as test@example.com.
const authenticateFirebaseToken = authenticateFirebase({ required: true });

/**
 * SSOユーザーの表示名を決定する。
 *
 * 優先順位:
 *   1. Sharegram のアカウント名（トークンのクレーム or Sharegram API）
 *   2. Firebase の displayName
 *   3. トークン内の name / displayName クレーム
 *   4. 既にDBに保存されている名前（上書きして消さない）
 *   5. メールアドレスのローカル部（最終フォールバック）
 *
 * @returns {{name: string, sharegramUserId: string|null, avatar: string|null}}
 */
const resolveProfile = async ({ claims, identity, firebaseProfile, email }) => {
  const emailLocalPart = typeof email === 'string' && email.includes('@')
    ? email.split('@')[0]
    : email;

  // 1) Sharegram ID Token のクレーム
  let account = sharegramAccount.fromTokenClaims(claims);

  // 2) 設定されている場合のみ Sharegram API から補完（失敗してもログインは継続）
  if (!sharegramAccount.displayName(account)) {
    const remote = await sharegramAccount.findAccountByEmail(email);
    if (remote) {
      account = {
        ...remote,
        // クレームにIDが入っていればそちらを優先する
        sharegramUserId: account?.sharegramUserId || remote.sharegramUserId
      };
    }
  }

  const name =
    sharegramAccount.displayName(account) ||
    firebaseProfile?.displayName ||
    claims.name ||
    claims.displayName ||
    (identity.name && identity.name !== emailLocalPart ? identity.name : null) ||
    emailLocalPart;

  return {
    name,
    sharegramUserId: account?.sharegramUserId || claims.sharegram_user_id || null,
    // ここでも一度絞る（サービス側の正規化を通らない出所——Firebase の
    // photoURL や picture クレーム——があるため）。512字を超えると
    // Users.profilePicture への書き込み自体が失敗する。
    avatar: sharegramAccount.safeProfilePicture(
      account?.avatar || firebaseProfile?.photoURL || claims.picture
    )
  };
};

/**
 * Firebase標準SSO実装
 * SharegramからリダイレクトされたIDトークンを受け取り、
 * そのトークンが指すユーザーをDBに作成/更新してセッションを発行する。
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

    if (!uid || !email) {
      return res.status(401).json({ success: false, error: 'Firebase token has no user identity' });
    }

    // Firebase ID tokens do not always include displayName. Read the
    // authoritative Firebase Auth profile as well; Sharegram should set this
    // when it creates/updates the account.
    let firebaseProfile = null;
    try {
      firebaseProfile = await admin.auth().getUser(uid);
    } catch (profileError) {
      console.warn('Could not load Firebase profile:', profileError.message);
    }

    const profile = await resolveProfile({ claims, identity, firebaseProfile, email });

    // Identity was bound by the verified-token middleware. Never redo email
    // linking or assign external ownership from display-profile lookup results.
    const user = await User.findByPk(identity.id);
    if (!user || user.firebaseUid !== uid || user.isActive === false || user.isLocked) {
      return res.status(403).json({ success: false, code: 'ACCOUNT_UNAVAILABLE' });
    }
    await user.update({
      lastLoginAt: new Date(),
      profilePicture: profile.avatar || user.profilePicture,
      emailVerified: user.emailVerified || claims.email_verified === true,
      name: profile.name || user.name || email.split('@')[0]
    });

    // JWTトークン生成（tokenServiceを使用して互換性のあるトークンを生成）
    const accessToken = await tokenService.generateAccessToken(user, {
      sso: true,
      provider: 'firebase',
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    const refreshToken = await tokenService.generateRefreshToken(user, {
      sessionStartedAt: claims.auth_time,
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
        role: user.role,
        firebaseUid: user.firebaseUid,
        sharegramUserId: user.sharegramUserId,
        lastLoginAt: user.lastLoginAt
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
// No public self-service owner/permission mutation. The KYC namespaced claim
// contract and privileged invitation/reconciliation workflow are not implemented.
router.post('/firebase-claims', (req, res) => res.status(403).json({
  success: false, code: 'CLAIM_MANAGEMENT_DISABLED'
}));

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