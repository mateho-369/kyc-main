const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { User, Performer } = require('../models');
const { Op } = require('sequelize');

// 全ルートに認証 + 管理者権限チェックを適用
router.use(auth, checkRole(['admin']));

/**
 * GET /api/admin/users
 * ユーザー一覧（検索・ページネーション対応）
 */
router.get('/', async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 検索条件
    const where = {};
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows: users } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password'] },
      include: [{
        model: Performer,
        attributes: ['id']
      }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    // 出演者数を付与
    const usersWithCount = users.map(user => {
      const userData = user.toJSON();
      userData.performerCount = userData.Performers ? userData.Performers.length : 0;
      delete userData.Performers;
      return userData;
    });

    res.json({
      success: true,
      data: usersWithCount,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('ユーザー一覧取得エラー:', error);
    res.status(500).json({
      success: false,
      message: 'ユーザー一覧の取得に失敗しました',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/admin/users/:id
 * ユーザー詳細 + 出演者一覧
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] },
      include: [{
        model: Performer,
        attributes: ['id', 'lastName', 'firstName', 'lastNameRoman', 'firstNameRoman', 'status', 'kycStatus', 'createdAt']
      }]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'ユーザーが見つかりません'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('ユーザー詳細取得エラー:', error);
    res.status(500).json({
      success: false,
      message: 'ユーザー詳細の取得に失敗しました',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
