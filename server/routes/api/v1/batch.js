const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authHybrid, requireAdmin } = require('../../../middleware/auth-hybrid');
const { Performer, BatchJob, AuditLog } = require('../../../models');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const csv = require('csv-parse/sync');

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../../uploads/batch');
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `batch-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.csv', '.json'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('CSVまたはJSONファイルのみアップロード可能です'));
    }
  }
});

/**
 * @route   POST /api/v1/batch/performers
 * @desc    バッチで複数の出演者を一括登録
 * @access  Private (Admin only)
 */
router.post('/performers', 
  authHybrid,
  requireAdmin,
  upload.single('file'),
  [
    body('dryRun').optional().isBoolean().withMessage('dryRunは真偽値である必要があります'),
    body('skipDuplicates').optional().isBoolean().withMessage('skipDuplicatesは真偽値である必要があります'),
    body('notifyOnComplete').optional().isBoolean().withMessage('notifyOnCompleteは真偽値である必要があります')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { dryRun = false, skipDuplicates = true, notifyOnComplete = true } = req.body;
      let performers = [];

      // ファイルからデータを読み込み
      if (req.file) {
        const filePath = req.file.path;
        const fileContent = await fs.readFile(filePath, 'utf-8');
        
        if (req.file.mimetype === 'text/csv' || path.extname(req.file.originalname) === '.csv') {
          // CSV処理
          performers = csv.parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true
          });
        } else {
          // JSON処理
          performers = JSON.parse(fileContent);
        }
        
        // ファイルを削除（処理後）
        await fs.unlink(filePath);
      } else if (req.body.performers) {
        // リクエストボディから直接データを取得
        performers = req.body.performers;
      } else {
        return res.status(400).json({ 
          error: 'データが提供されていません',
          message: 'ファイルまたはperformers配列を提供してください'
        });
      }

      // バッチジョブを作成
      const batchJob = await BatchJob.create({
        userId: req.user.id,
        jobType: 'performer_import',
        status: 'processing',
        inputData: {
          totalCount: performers.length,
          dryRun,
          skipDuplicates,
          notifyOnComplete
        },
        totalItems: performers.length,
        metadata: {
          uploadedBy: req.user.email,
          authMethod: req.authMethod
        }
      });

      // 非同期でバッチ処理を実行
      processBatchImport(batchJob, performers, { dryRun, skipDuplicates });

      // 監査ログ記録
      await AuditLog.create({
        action: 'create',
        resourceType: 'BatchJob',
        resourceId: batchJob.id,
        userId: req.user.id,
        userEmail: req.user.email,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: {
          jobType: 'performer_import',
          itemCount: performers.length,
          options: { dryRun, skipDuplicates }
        }
      });

      res.status(202).json({
        message: 'バッチ処理を開始しました',
        jobId: batchJob.id,
        totalItems: performers.length,
        status: 'processing',
        trackingUrl: `/api/v1/batch/jobs/${batchJob.id}`
      });

    } catch (error) {
      console.error('バッチ処理エラー:', error);
      res.status(500).json({ 
        error: 'バッチ処理の開始に失敗しました',
        message: error.message 
      });
    }
  }
);

/**
 * @route   GET /api/v1/batch/jobs/:jobId
 * @desc    バッチジョブの状態を取得
 * @access  Private
 */
router.get('/jobs/:jobId', authHybrid, async (req, res) => {
  try {
    const job = await BatchJob.findOne({
      where: {
        id: req.params.jobId,
        userId: req.user.role === 'admin' ? { [Op.ne]: null } : req.user.id
      }
    });

    if (!job) {
      return res.status(404).json({ 
        error: 'ジョブが見つかりません' 
      });
    }

    res.json({
      id: job.id,
      type: job.jobType,
      status: job.status,
      progress: job.progress,
      totalItems: job.totalItems,
      processedItems: job.processedItems,
      successItems: job.successItems,
      failedItems: job.failedItems,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      estimatedCompletion: job.estimatedCompletion,
      errors: job.errorLog
    });

  } catch (error) {
    console.error('ジョブ状態取得エラー:', error);
    res.status(500).json({ 
      error: 'ジョブ状態の取得に失敗しました',
      message: error.message 
    });
  }
});

/**
 * @route   DELETE /api/v1/batch/jobs/:jobId
 * @desc    バッチジョブをキャンセル
 * @access  Private
 */
router.delete('/jobs/:jobId', authHybrid, async (req, res) => {
  try {
    const job = await BatchJob.findOne({
      where: {
        id: req.params.jobId,
        userId: req.user.role === 'admin' ? { [Op.ne]: null } : req.user.id
      }
    });

    if (!job) {
      return res.status(404).json({ 
        error: 'ジョブが見つかりません' 
      });
    }

    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return res.status(400).json({ 
        error: `${job.status}状態のジョブはキャンセルできません` 
      });
    }

    await job.cancel();

    res.json({
      message: 'ジョブをキャンセルしました',
      jobId: job.id,
      status: job.status
    });

  } catch (error) {
    console.error('ジョブキャンセルエラー:', error);
    res.status(500).json({ 
      error: 'ジョブのキャンセルに失敗しました',
      message: error.message 
    });
  }
});

/**
 * バッチインポート処理（非同期）
 */
async function processBatchImport(job, performers, options) {
  try {
    await job.start();
    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < performers.length; i++) {
      const performerData = performers[i];
      
      try {
        // 重複チェック
        if (options.skipDuplicates) {
          const existing = await Performer.findOne({
            where: {
              [Op.or]: [
                {
                  lastName: performerData.lastName,
                  firstName: performerData.firstName
                },
                {
                  lastNameRoman: performerData.lastNameRoman,
                  firstNameRoman: performerData.firstNameRoman
                }
              ]
            }
          });

          if (existing) {
            results.push({
              index: i,
              status: 'skipped',
              reason: 'duplicate',
              data: performerData
            });
            continue;
          }
        }

        // ドライランモード
        if (options.dryRun) {
          results.push({
            index: i,
            status: 'dry_run',
            data: performerData
          });
          successCount++;
        } else {
          // 実際の作成
          const performer = await Performer.create({
            lastName: performerData.lastName || '',
            firstName: performerData.firstName || '',
            lastNameRoman: performerData.lastNameRoman || '',
            firstNameRoman: performerData.firstNameRoman || '',
            status: 'pending',
            documents: {},
            notes: performerData.notes || `バッチインポート (Job ID: ${job.id})`
          });

          results.push({
            index: i,
            status: 'created',
            performerId: performer.id,
            data: performerData
          });
          successCount++;
        }

      } catch (error) {
        failedCount++;
        results.push({
          index: i,
          status: 'failed',
          error: error.message,
          data: performerData
        });
        
        await job.addError(error, { 
          index: i, 
          performerData 
        });
      }

      // 進捗更新
      if ((i + 1) % 10 === 0 || i === performers.length - 1) {
        await job.updateProgress(i + 1, successCount, failedCount);
      }
    }

    // ジョブ完了
    await job.complete({
      results,
      summary: {
        total: performers.length,
        success: successCount,
        failed: failedCount,
        skipped: results.filter(r => r.status === 'skipped').length
      }
    });

    // 通知処理（必要に応じて）
    if (options.notifyOnComplete) {
      // WebhookやEmailによる通知を実装
      const Webhook = require('../../../models/Webhook');
      await Webhook.triggerForUser(job.userId, 'batch.completed', {
        jobId: job.id,
        type: job.jobType,
        summary: job.outputData.summary
      });
    }

  } catch (error) {
    console.error('バッチ処理エラー:', error);
    await job.fail(error);
  }
}

module.exports = router;