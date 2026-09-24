const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const firebaseAuth = require('../middleware/firebaseAuth');
const { User, FirebaseUser, SharegramIntegration } = require('../models');

// @route   POST api/users/sharegram-register
// @desc    Register user information for Sharegram integration
// @access  Private (Firebase Auth)
router.post('/sharegram-register', firebaseAuth, [
  check('firebase_uid', 'Firebase UIDは必須です').notEmpty(),
  check('sharegram_user_id', 'Sharegram ユーザーIDは必須です').notEmpty(),
  check('email', 'メールアドレスは必須です').isEmail(),
  check('session_id', 'セッションIDは必須です').optional(),
  check('company_id', '企業IDは必須です').optional(),
  check('locale', 'ロケールは必須です').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    firebase_uid,
    sharegram_user_id,
    email,
    display_name,
    photo_url,
    session_id,
    company_id,
    locale
  } = req.body;

  try {
    // Firebase UIDの検証
    if (req.user.uid !== firebase_uid) {
      return res.status(403).json({ message: 'Firebase UIDが一致しません' });
    }

    // Firebase ユーザー情報の保存/更新
    const [firebaseUser] = await FirebaseUser.findOrCreate({
      where: { firebase_uid: firebase_uid },
      defaults: {
        firebase_uid: firebase_uid,
        email: email,
        display_name: display_name || req.user.name,
        photo_url: photo_url || req.user.picture,
        provider: req.user.firebase?.sign_in_provider || 'unknown',
        email_verified: req.user.email_verified || false,
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // 既存のレコードの場合は更新
    if (!firebaseUser.isNewRecord) {
      await firebaseUser.update({
        email: email,
        display_name: display_name || req.user.name,
        photo_url: photo_url || req.user.picture,
        email_verified: req.user.email_verified || false,
        updated_at: new Date()
      });
    }

    // Sharegram統合情報の保存/更新
    const [integration] = await SharegramIntegration.findOrCreate({
      where: { 
        sharegram_user_id: sharegram_user_id,
        firebase_uid: firebase_uid
      },
      defaults: {
        sharegram_user_id: sharegram_user_id,
        firebase_uid: firebase_uid,
        email: email,
        display_name: display_name || req.user.name,
        photo_url: photo_url || req.user.picture,
        session_id: session_id,
        company_id: company_id,
        locale: locale,
        status: 'registered',
        created_at: new Date(),
        updated_at: new Date()
      }
    });

    // 既存のレコードの場合は更新
    if (!integration.isNewRecord) {
      await integration.update({
        email: email,
        display_name: display_name || req.user.name,
        photo_url: photo_url || req.user.picture,
        session_id: session_id,
        company_id: company_id,
        locale: locale,
        status: 'registered',
        updated_at: new Date()
      });
    }

    res.json({
      message: 'ユーザー情報を登録しました',
      firebase_user: {
        id: firebaseUser.id,
        firebase_uid: firebaseUser.firebase_uid,
        email: firebaseUser.email,
        display_name: firebaseUser.display_name,
        photo_url: firebaseUser.photo_url
      },
      integration: {
        id: integration.id,
        sharegram_user_id: integration.sharegram_user_id,
        status: integration.status,
        session_id: integration.session_id,
        company_id: integration.company_id,
        locale: integration.locale
      }
    });

  } catch (error) {
    console.error('Sharegramユーザー登録エラー:', error);
    res.status(500).json({ 
      message: 'サーバーエラーが発生しました',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET api/users/profile
// @desc    Get user profile information
// @access  Private (Firebase Auth)
router.get('/profile', firebaseAuth, async (req, res) => {
  try {
    const firebaseUser = await FirebaseUser.findOne({
      where: { firebase_uid: req.user.uid }
    });

    if (!firebaseUser) {
      return res.status(404).json({ message: 'ユーザーが見つかりません' });
    }

    const integrations = await SharegramIntegration.findAll({
      where: { firebase_uid: req.user.uid }
    });

    res.json({
      user: {
        id: firebaseUser.id,
        firebase_uid: firebaseUser.firebase_uid,
        email: firebaseUser.email,
        display_name: firebaseUser.display_name,
        photo_url: firebaseUser.photo_url,
        provider: firebaseUser.provider,
        email_verified: firebaseUser.email_verified,
        created_at: firebaseUser.created_at,
        updated_at: firebaseUser.updated_at
      },
      integrations: integrations.map(integration => ({
        id: integration.id,
        sharegram_user_id: integration.sharegram_user_id,
        status: integration.status,
        session_id: integration.session_id,
        company_id: integration.company_id,
        locale: integration.locale,
        created_at: integration.created_at,
        updated_at: integration.updated_at
      }))
    });

  } catch (error) {
    console.error('ユーザープロフィール取得エラー:', error);
    res.status(500).json({ 
      message: 'サーバーエラーが発生しました',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT api/users/profile
// @desc    Update user profile information
// @access  Private (Firebase Auth)
router.put('/profile', firebaseAuth, [
  check('display_name', '表示名は必須です').optional().notEmpty(),
  check('photo_url', 'フォトURLは必須です').optional().isURL()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { display_name, photo_url } = req.body;

  try {
    const firebaseUser = await FirebaseUser.findOne({
      where: { firebase_uid: req.user.uid }
    });

    if (!firebaseUser) {
      return res.status(404).json({ message: 'ユーザーが見つかりません' });
    }

    // ユーザー情報を更新
    const updateData = {
      updated_at: new Date()
    };

    if (display_name !== undefined) {
      updateData.display_name = display_name;
    }

    if (photo_url !== undefined) {
      updateData.photo_url = photo_url;
    }

    await firebaseUser.update(updateData);

    // Sharegram統合情報も更新
    await SharegramIntegration.update(
      updateData,
      { where: { firebase_uid: req.user.uid } }
    );

    res.json({
      message: 'プロフィールを更新しました',
      user: {
        id: firebaseUser.id,
        firebase_uid: firebaseUser.firebase_uid,
        email: firebaseUser.email,
        display_name: firebaseUser.display_name,
        photo_url: firebaseUser.photo_url,
        provider: firebaseUser.provider,
        email_verified: firebaseUser.email_verified,
        updated_at: firebaseUser.updated_at
      }
    });

  } catch (error) {
    console.error('プロフィール更新エラー:', error);
    res.status(500).json({ 
      message: 'サーバーエラーが発生しました',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   DELETE api/users/account
// @desc    Delete user account
// @access  Private (Firebase Auth)
router.delete('/account', firebaseAuth, async (req, res) => {
  try {
    // Sharegram統合情報を削除
    await SharegramIntegration.destroy({
      where: { firebase_uid: req.user.uid }
    });

    // Firebase ユーザー情報を削除
    await FirebaseUser.destroy({
      where: { firebase_uid: req.user.uid }
    });

    res.json({ message: 'アカウントを削除しました' });

  } catch (error) {
    console.error('アカウント削除エラー:', error);
    res.status(500).json({ 
      message: 'サーバーエラーが発生しました',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;