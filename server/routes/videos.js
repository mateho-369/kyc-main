const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const { Video, Performer } = require('../models');

// @route   GET api/videos
// @desc    Get all videos
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const videos = await Video.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']]
    });
    
    // 各動画の出演者数を取得
    const videosWithCounts = await Promise.all(
      videos.map(async (video) => {
        const performerCount = await Performer.count({
          where: { videoId: video.id }
        });
        
        return {
          ...video.get({ plain: true }),
          performerCount
        };
      })
    );
    
    res.json(videosWithCounts);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// @route   GET api/videos/:id
// @desc    Get video by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const video = await Video.findByPk(req.params.id);
    
    if (!video) {
      return res.status(404).json({ message: '動画が見つかりません' });
    }
    
    // 権限チェック
    if (video.userId !== req.user.id) {
      return res.status(403).json({ message: 'アクセス権限がありません' });
    }
    
    res.json(video);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// @route   POST api/videos
// @desc    Create a video
// @access  Private
router.post(
  '/',
  [
    auth,
    [
      check('title', 'タイトルは必須です').not().isEmpty(),
      check('url', 'URLは必須です').not().isEmpty()
    ]
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { title, url, description } = req.body;
    
    try {
      const video = await Video.create({
        title,
        url,
        description,
        userId: req.user.id
      });
      
      res.json(video);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('サーバーエラーが発生しました');
    }
  }
);

// @route   PUT api/videos/:id
// @desc    Update a video
// @access  Private
router.put('/:id', auth, async (req, res) => {
  const { title, url, description } = req.body;
  
  // 更新フィールドの構築
  const videoFields = {};
  if (title) videoFields.title = title;
  if (url) videoFields.url = url;
  if (description !== undefined) videoFields.description = description;
  
  try {
    let video = await Video.findByPk(req.params.id);
    
    if (!video) {
      return res.status(404).json({ message: '動画が見つかりません' });
    }
    
    // 権限チェック
    if (video.userId !== req.user.id) {
      return res.status(403).json({ message: 'アクセス権限がありません' });
    }
    
    // 更新
    await Video.update(videoFields, {
      where: { id: req.params.id }
    });
    
    // 更新後のデータを取得
    video = await Video.findByPk(req.params.id);
    
    res.json(video);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// @route   DELETE api/videos/:id
// @desc    Delete a video
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const video = await Video.findByPk(req.params.id);
    
    if (!video) {
      return res.status(404).json({ message: '動画が見つかりません' });
    }
    
    // 権限チェック
    if (video.userId !== req.user.id) {
      return res.status(403).json({ message: 'アクセス権限がありません' });
    }
    
    // 関連する出演者情報も削除
    await Performer.destroy({
      where: { videoId: req.params.id }
    });
    
    // 動画を削除
    await Video.destroy({
      where: { id: req.params.id }
    });
    
    res.json({ message: '動画が削除されました' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

module.exports = router;