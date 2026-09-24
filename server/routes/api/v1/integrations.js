const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { authHybrid, requireAdmin } = require('../../../middleware/auth-hybrid');
const { SharegramIntegration, AuditLog } = require('../../../models');
const firebaseSyncService = require('../../../services/sync/firebaseSync');
const dataSyncService = require('../../../services/sync/dataSync');

/**
 * @route   GET /api/v1/integrations
 * @desc    統合設定一覧を取得
 * @access  Private
 */
router.get('/', authHybrid, async (req, res) => {
  try {
    const integrations = await SharegramIntegration.findAll({
      where: {
        userId: req.user.id
      },
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      count: integrations.length,
      integrations: integrations.map(i => ({
        ...i.toJSON(),
        configuration: i.configuration ? '***設定済み***' : null // セキュリティのため詳細は隠す
      }))
    });

  } catch (error) {
    console.error('統合設定取得エラー:', error);
    res.status(500).json({
      error: '統合設定の取得に失敗しました',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/v1/integrations/firebase/sync
 * @desc    Firebase同期を実行
 * @access  Private (Admin only)
 */
router.post('/firebase/sync',
  authHybrid,
  requireAdmin,
  [
    body('syncType').optional().isIn(['full', 'delta', 'user']).withMessage('無効な同期タイプです'),
    body('firebaseUid').optional().isString().withMessage('Firebase UIDが必要です')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { syncType = 'delta', firebaseUid } = req.body;

    try {
      // Firebase同期サービスの初期化
      await firebaseSyncService.initialize();

      let result;

      switch (syncType) {
        case 'full':
          // 完全同期
          result = await firebaseSyncService.batchSync();
          break;

        case 'delta':
          // 差分同期
          result = await firebaseSyncService.deltaSync();
          break;

        case 'user':
          // 特定ユーザーの同期
          if (!firebaseUid) {
            return res.status(400).json({
              error: 'Firebase UIDが必要です'
            });
          }
          result = await firebaseSyncService.syncUser(firebaseUid);
          break;
      }

      // 監査ログ記録
      await AuditLog.create({
        action: 'update',
        resourceType: 'Integration',
        resourceId: null,
        userId: req.user.id,
        userEmail: req.user.email,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          integrationType: 'firebase',
          syncType,
          result
        }
      });

      res.json({
        success: true,
        syncType,
        result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Firebase同期エラー:', error);
      res.status(500).json({
        error: 'Firebase同期に失敗しました',
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/v1/integrations/firebase/stats
 * @desc    Firebase同期統計を取得
 * @access  Private (Admin only)
 */
router.get('/firebase/stats',
  authHybrid,
  requireAdmin,
  async (req, res) => {
    try {
      const stats = await firebaseSyncService.getSyncStats();

      res.json({
        success: true,
        stats
      });

    } catch (error) {
      console.error('Firebase統計取得エラー:', error);
      res.status(500).json({
        error: '統計情報の取得に失敗しました',
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/v1/integrations/firebase/realtime
 * @desc    リアルタイム同期の開始/停止
 * @access  Private (Admin only)
 */
router.post('/firebase/realtime',
  authHybrid,
  requireAdmin,
  [
    body('action').isIn(['start', 'stop']).withMessage('無効なアクションです'),
    body('intervalMinutes').optional().isInt({ min: 1, max: 60 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { action, intervalMinutes = 5 } = req.body;

    try {
      if (action === 'start') {
        await firebaseSyncService.initialize();
        firebaseSyncService.startRealtimeSync(intervalMinutes);
        
        res.json({
          success: true,
          message: 'リアルタイム同期を開始しました',
          intervalMinutes
        });
      } else {
        firebaseSyncService.stopRealtimeSync();
        
        res.json({
          success: true,
          message: 'リアルタイム同期を停止しました'
        });
      }

    } catch (error) {
      console.error('リアルタイム同期制御エラー:', error);
      res.status(500).json({
        error: 'リアルタイム同期の制御に失敗しました',
        message: error.message
      });
    }
  }
);

/**
 * @route   POST /api/v1/integrations/sync
 * @desc    汎用データ同期
 * @access  Private
 */
router.post('/sync',
  authHybrid,
  [
    body('resourceType').isIn(['performer', 'user', 'document']).withMessage('無効なリソースタイプです'),
    body('resourceId').optional().isInt(),
    body('action').isIn(['create', 'update', 'delete']).withMessage('無効なアクションです'),
    body('integrationId').isInt().withMessage('統合IDが必要です')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { resourceType, resourceId, action, integrationId } = req.body;

    try {
      // 統合設定を取得
      const integration = await SharegramIntegration.findOne({
        where: {
          id: integrationId,
          userId: req.user.id,
          isActive: true
        }
      });

      if (!integration) {
        return res.status(404).json({
          error: '統合設定が見つからないか、無効です'
        });
      }

      // データ同期サービスの初期化
      await dataSyncService.initialize();

      // 同期ジョブをスケジュール
      const job = await dataSyncService.scheduleSync(resourceType, {
        action,
        resourceId,
        integration: integration.toJSON(),
        options: {
          userId: req.user.id
        }
      });

      res.json({
        success: true,
        message: '同期ジョブをスケジュールしました',
        jobId: job.id,
        resourceType,
        action
      });

    } catch (error) {
      console.error('データ同期エラー:', error);
      res.status(500).json({
        error: 'データ同期に失敗しました',
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/v1/integrations/sync/status
 * @desc    同期状態を取得
 * @access  Private
 */
router.get('/sync/status', authHybrid, async (req, res) => {
  try {
    const status = await dataSyncService.getSyncStatus();

    res.json({
      success: true,
      status
    });

  } catch (error) {
    console.error('同期状態取得エラー:', error);
    res.status(500).json({
      error: '同期状態の取得に失敗しました',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/v1/integrations/:id/test
 * @desc    統合設定のテスト
 * @access  Private
 */
router.post('/:id/test',
  authHybrid,
  [
    param('id').isInt().withMessage('有効な統合IDが必要です')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const integration = await SharegramIntegration.findOne({
        where: {
          id: req.params.id,
          userId: req.user.id
        }
      });

      if (!integration) {
        return res.status(404).json({
          error: '統合設定が見つかりません'
        });
      }

      // 統合タイプに応じたテスト
      let testResult;

      switch (integration.integrationType) {
        case 'firebase':
          // Firebase接続テスト
          try {
            await firebaseSyncService.initialize();
            const stats = await firebaseSyncService.getSyncStats();
            testResult = {
              success: true,
              message: 'Firebase接続に成功しました',
              stats
            };
          } catch (error) {
            testResult = {
              success: false,
              message: 'Firebase接続に失敗しました',
              error: error.message
            };
          }
          break;

        case 'webhook':
          // Webhook設定のテスト（実装済み）
          testResult = {
            success: true,
            message: 'Webhook統合は/api/v1/webhooks/:id/testで個別にテストしてください'
          };
          break;

        case 'api':
          // API接続テスト
          testResult = await dataSyncService.callExternalAPI(
            integration.configuration,
            { test: true },
            'test'
          );
          break;

        default:
          testResult = {
            success: false,
            message: '未対応の統合タイプです'
          };
      }

      res.json({
        success: true,
        integrationId: integration.id,
        integrationType: integration.integrationType,
        testResult
      });

    } catch (error) {
      console.error('統合テストエラー:', error);
      res.status(500).json({
        error: '統合テストに失敗しました',
        message: error.message
      });
    }
  }
);

module.exports = router;