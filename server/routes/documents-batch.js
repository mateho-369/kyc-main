// バッチドキュメントアップロード機能（CEO完全制覇ミッション）
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { Op } = require('sequelize');
const { Performer, AuditLog } = require('../models');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');

// Multerストレージ設定（一時アップロード用）
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/temp');
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `batch_${uniqueSuffix}_${sanitizedFilename}`);
  }
});

// ファイルフィルター（セキュリティ）
const fileFilter = (req, file, cb) => {
  // 許可されるファイルタイプ
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/webp'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不正なファイルタイプ: ${file.mimetype}。PDF、JPEG、PNG、WebPのみ許可されています。`), false);
  }
};

// Multer設定
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB制限
    files: 50 // 最大50ファイル
  }
});

// @route   POST /api/documents/batch
// @desc    Batch document upload
// @access  Private (Admin/Manager)
router.post('/batch', 
  auth, 
  checkRole(['admin', 'manager']),
  upload.array('documents', 50),
  async (req, res) => {
    const uploadedFiles = [];
    const errors = [];
    const results = [];

    try {
      const { 
        performerIds, // カンマ区切りまたは配列
        documentType = 'batch_upload',
        description = '',
        autoVerify = false
      } = req.body;

      // バリデーション
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILES_UPLOADED',
            message: 'アップロードするファイルが見つかりません。'
          }
        });
      }

      // パフォーマーID処理
      let targetPerformerIds = [];
      if (performerIds) {
        targetPerformerIds = Array.isArray(performerIds) 
          ? performerIds 
          : performerIds.split(',').map(id => id.trim());
      }

      // パフォーマー存在確認
      let targetPerformers = [];
      if (targetPerformerIds.length > 0) {
        targetPerformers = await Performer.findAll({
          where: {
            id: {
              [Op.in]: targetPerformerIds
            }
          }
        });

        if (targetPerformers.length !== targetPerformerIds.length) {
          const foundIds = targetPerformers.map(p => p.id.toString());
          const missingIds = targetPerformerIds.filter(id => !foundIds.includes(id));
          return res.status(404).json({
            success: false,
            error: {
              code: 'PERFORMERS_NOT_FOUND',
              message: `次のパフォーマーIDが見つかりません: ${missingIds.join(', ')}`
            }
          });
        }
      }

      // バッチ処理開始
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const processedFiles = [];

      for (const file of req.files) {
        uploadedFiles.push(file.path); // クリーンアップ用
        
        try {
          // ファイル情報
          const fileInfo = {
            originalName: file.originalname,
            filename: file.filename,
            size: file.size,
            mimeType: file.mimetype,
            uploadedAt: new Date().toISOString(),
            uploadedBy: req.user.id,
            batchId: batchId
          };

          // 特定パフォーマーに紐付ける場合
          if (targetPerformers.length > 0) {
            for (const performer of targetPerformers) {
              // 既存ドキュメント更新
              const existingDocs = performer.documents ? JSON.parse(performer.documents) : {};
              
              // バッチアップロードセクション作成
              if (!existingDocs.batchUploads) {
                existingDocs.batchUploads = [];
              }

              existingDocs.batchUploads.push({
                ...fileInfo,
                documentType: documentType,
                description: description,
                verified: autoVerify,
                verifiedAt: autoVerify ? new Date().toISOString() : null,
                verifiedBy: autoVerify ? req.user.id : null
              });

              // パフォーマー更新
              await performer.update({
                documents: JSON.stringify(existingDocs),
                updatedAt: new Date()
              });

              processedFiles.push({
                performerId: performer.id,
                filename: file.filename,
                originalName: file.originalname,
                status: 'success'
              });
            }
          } else {
            // 一般的なバッチアップロード（特定パフォーマーに紐付けない）
            processedFiles.push({
              filename: file.filename,
              originalName: file.originalname,
              status: 'success',
              note: '一般アップロード（パフォーマー未指定）'
            });
          }

        } catch (fileError) {
          console.error(`ファイル処理エラー (${file.filename}):`, fileError);
          errors.push({
            filename: file.filename,
            error: fileError.message
          });
          
          processedFiles.push({
            filename: file.filename,
            originalName: file.originalname,
            status: 'error',
            error: fileError.message
          });
        }
      }

      // 統計計算
      const successCount = processedFiles.filter(f => f.status === 'success').length;
      const errorCount = processedFiles.filter(f => f.status === 'error').length;

      // 監査ログ記録
      await AuditLog.create({
        userId: req.user.id,
        action: 'BATCH_DOCUMENT_UPLOAD',
        targetId: null,
        targetType: 'BatchUpload',
        details: {
          batchId: batchId,
          totalFiles: req.files.length,
          successCount: successCount,
          errorCount: errorCount,
          targetPerformers: targetPerformerIds.length,
          documentType: documentType,
          autoVerify: autoVerify,
          uploadedBy: req.user.email
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });

      // 成功レスポンス
      res.json({
        success: true,
        message: `バッチアップロード完了: ${successCount}件成功、${errorCount}件エラー`,
        data: {
          batchId: batchId,
          summary: {
            totalFiles: req.files.length,
            successCount: successCount,
            errorCount: errorCount,
            targetPerformers: targetPerformers.length
          },
          processedFiles: processedFiles,
          errors: errors.length > 0 ? errors : undefined,
          uploadedAt: new Date().toISOString(),
          uploadedBy: {
            id: req.user.id,
            email: req.user.email
          }
        }
      });

    } catch (error) {
      console.error('バッチアップロードエラー:', error);

      // 監査ログ（エラー）
      try {
        await AuditLog.create({
          userId: req.user.id,
          action: 'BATCH_UPLOAD_ERROR',
          targetId: null,
          targetType: 'BatchUpload',
          details: {
            error: error.message,
            filesCount: req.files ? req.files.length : 0,
            stack: error.stack
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        });
      } catch (logError) {
        console.error('監査ログ記録エラー:', logError);
      }

      res.status(500).json({
        success: false,
        error: {
          code: 'BATCH_UPLOAD_ERROR',
          message: 'バッチアップロード中にエラーが発生しました。'
        }
      });
    } finally {
      // 一時ファイルクリーンアップ
      for (const filePath of uploadedFiles) {
        try {
          await fs.unlink(filePath);
        } catch (unlinkError) {
          console.error(`一時ファイル削除エラー (${filePath}):`, unlinkError);
        }
      }
    }
  }
);

// @route   GET /api/documents/batch/:batchId
// @desc    Get batch upload status
// @access  Private
router.get('/batch/:batchId', auth, async (req, res) => {
  try {
    const { batchId } = req.params;

    // 監査ログからバッチ情報取得
    const batchLog = await AuditLog.findOne({
      where: {
        action: 'BATCH_DOCUMENT_UPLOAD',
        'details.batchId': batchId
      },
      order: [['createdAt', 'DESC']]
    });

    if (!batchLog) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BATCH_NOT_FOUND',
          message: '指定されたバッチIDが見つかりません。'
        }
      });
    }

    // アクセス制御（本人または管理者のみ）
    if (req.user.role !== 'admin' && batchLog.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'このバッチにアクセスする権限がありません。'
        }
      });
    }

    res.json({
      success: true,
      data: {
        batchId: batchId,
        status: 'completed',
        details: batchLog.details,
        createdAt: batchLog.createdAt,
        uploadedBy: {
          id: batchLog.userId,
          // セキュリティのためメールアドレスは管理者のみ
          email: req.user.role === 'admin' ? batchLog.details.uploadedBy : undefined
        }
      }
    });

  } catch (error) {
    console.error('バッチ状態取得エラー:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BATCH_STATUS_ERROR',
        message: 'バッチ状態の取得中にエラーが発生しました。'
      }
    });
  }
});

module.exports = router;