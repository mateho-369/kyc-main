const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const { Performer, AuditLog, User } = require('../models');

// @route   GET api/dashboard/stats
// @desc    Get dashboard statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    // 登録出演者数
    const totalPerformers = await Performer.count();
    
    // 検証待ち書類のある出演者数
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    
    const pendingVerification = await Performer.count({
      where: {
        [Op.and]: [
          { 
            documents: {
              [Op.ne]: null
            } 
          },
          { 
            [Op.or]: [
              { 'documents.agreementFile.verified': false },
              { 'documents.idFront.verified': false },
              { 'documents.selfie.verified': false }
            ]
          }
        ]
      }
    });
    
    // 最近更新された出演者数（過去7日間）
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentlyUpdated = await Performer.count({
      where: {
        updatedAt: {
          [Op.gte]: sevenDaysAgo
        }
      }
    });
    
    // 期限切れ間近の書類（30日以内に期限切れになる書類）
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
    
    // 仮のロジック（実際の期限切れ判定はアプリケーションの要件による）
    const expiringDocuments = await Performer.count({
      where: {
        // 例として3ヶ月以上前に作成され、検証済みの書類を「期限切れ間近」とする
        createdAt: {
          [Op.lte]: new Date(new Date().setMonth(new Date().getMonth() - 3))
        },
        [Op.and]: [
          { 
            documents: {
              [Op.ne]: null
            } 
          },
          { 
            [Op.or]: [
              { 'documents.agreementFile.verified': true },
              { 'documents.idFront.verified': true },
              { 'documents.selfie.verified': true }
            ]
          }
        ]
      }
    });
    
    // 最近のアクティビティ
    const recentActivity = await AuditLog.findAll({
      include: [{
        model: User,
        attributes: ['id', 'name', 'email']
      }],
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
    // アクティビティデータをフォーマット
    const formattedActivity = recentActivity.map(log => {
      let description = '';
      
      switch(log.action) {
        case 'create':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}を新規作成しました。`;
          break;
        case 'update':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}情報を更新しました。`;
          break;
        case 'delete':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}を削除しました。`;
          break;
        case 'verify':
          description = `書類を検証しました。`;
          break;
        case 'download':
          description = `書類をダウンロードしました。`;
          break;
        default:
          description = `${log.resourceType}に対して${log.action}を実行しました。`;
      }
      
      return {
        id: log.id,
        timestamp: log.createdAt,
        userName: log.User ? log.User.name : `ユーザーID: ${log.userId}`,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        description
      };
    });
    
    res.json({
      totalPerformers,
      pendingVerification,
      recentlyUpdated,
      expiringDocuments,
      recentActivity: formattedActivity
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// @route   GET api/dashboard/activity
// @desc    Get recent activity
// @access  Private
router.get('/activity', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const recentActivity = await AuditLog.findAll({
      include: [{
        model: User,
        attributes: ['id', 'name', 'email']
      }],
      order: [['createdAt', 'DESC']],
      limit
    });
    
    // アクティビティデータをフォーマット
    const formattedActivity = recentActivity.map(log => {
      let description = '';
      
      switch(log.action) {
        case 'create':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}を新規作成しました。`;
          break;
        case 'update':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}情報を更新しました。`;
          break;
        case 'delete':
          description = `${log.resourceType === 'performer' ? '出演者' : '書類'}を削除しました。`;
          break;
        case 'verify':
          description = `書類を検証しました。`;
          break;
        case 'download':
          description = `書類をダウンロードしました。`;
          break;
        default:
          description = `${log.resourceType}に対して${log.action}を実行しました。`;
      }
      
      return {
        id: log.id,
        timestamp: log.createdAt,
        userName: log.User ? log.User.name : `ユーザーID: ${log.userId}`,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        description
      };
    });
    
    res.json(formattedActivity);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

// @route   GET api/dashboard/chart
// @desc    Get chart data
// @access  Private
router.get('/chart', auth, async (req, res) => {
  try {
    const type = req.query.type || 'monthly';
    const now = new Date();
    
    // 期間の設定
    let startDate;
    let groupFormat;
    let labels = [];
    
    switch (type) {
      case 'daily':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 30); // 過去30日
        groupFormat = '%Y-%m-%d';
        // 日付ラベルを生成
        for (let i = 0; i < 30; i++) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + i);
          labels.push(d.toISOString().slice(0, 10));
        }
        break;
      case 'weekly':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7 * 12); // 過去12週間
        groupFormat = '%Y-%u'; // 年-週番号
        // 週ラベルを生成
        for (let i = 0; i < 12; i++) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + i * 7);
          labels.push(`Week ${i + 1}`);
        }
        break;
      case 'monthly':
      default:
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 12); // 過去12ヶ月
        groupFormat = '%Y-%m';
        // 月ラベルを生成
        for (let i = 0; i < 12; i++) {
          const d = new Date(startDate);
          d.setMonth(d.getMonth() + i);
          labels.push(d.toISOString().slice(0, 7));
        }
        break;
    }
    
    // 以下は簡易的なデータ例（実際にはデータベースからの集計を実装）
    const performers = Array(labels.length).fill(0).map(() => Math.floor(Math.random() * 10));
    const documents = Array(labels.length).fill(0).map(() => Math.floor(Math.random() * 20));
    const verifications = Array(labels.length).fill(0).map(() => Math.floor(Math.random() * 15));
    
    res.json({
      labels,
      datasets: [
        {
          label: '出演者登録数',
          data: performers
        },
        {
          label: '書類アップロード数',
          data: documents
        },
        {
          label: '検証完了数',
          data: verifications
        }
      ]
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

module.exports = router;