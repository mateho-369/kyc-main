/**
 * ドキュメント共有APIルート
 * KYCドキュメントの取得、共有、管理を行うエンドポイント
 */

const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const { authenticateToken } = require('../middleware/auth');
const { cacheMiddleware } = require('../middleware/cache');
const { checkRole } = require('../middleware/checkRole');
const multer = require('multer');
const path = require('path');

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/documents'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG and PDF files are allowed.'));
    }
  }
});

/**
 * @route   GET /api/documents
 * @desc    全ドキュメント一覧を取得
 * @access  Private (Admin only)
 */
router.get('/', 
  authenticateToken, 
  checkRole(['admin']), 
  cacheMiddleware(300),
  documentController.getAllDocuments
);

/**
 * @route   GET /api/documents/:documentId
 * @desc    特定のドキュメントを取得
 * @access  Private
 */
router.get('/:documentId', 
  authenticateToken,
  cacheMiddleware(600),
  documentController.getDocumentById
);

/**
 * @route   GET /api/documents/performer/:performerId
 * @desc    特定のパフォーマーのドキュメント一覧を取得
 * @access  Private
 */
router.get('/performer/:performerId', 
  authenticateToken,
  cacheMiddleware(300),
  documentController.getDocumentsByPerformerId
);

/**
 * @route   POST /api/documents/upload
 * @desc    新しいドキュメントをアップロード
 * @access  Private
 */
router.post('/upload', 
  authenticateToken,
  upload.single('document'),
  documentController.uploadDocument
);

/**
 * @route   PUT /api/documents/:documentId
 * @desc    ドキュメント情報を更新
 * @access  Private
 */
router.put('/:documentId', 
  authenticateToken,
  documentController.updateDocument
);

/**
 * @route   DELETE /api/documents/:documentId
 * @desc    ドキュメントを削除
 * @access  Private (Admin only)
 */
router.delete('/:documentId', 
  authenticateToken,
  checkRole(['admin']),
  documentController.deleteDocument
);

/**
 * @route   POST /api/documents/:documentId/share
 * @desc    ドキュメントを共有（共有リンクを生成）
 * @access  Private
 */
router.post('/:documentId/share', 
  authenticateToken,
  documentController.shareDocument
);

/**
 * @route   GET /api/documents/shared/:shareToken
 * @desc    共有トークンを使ってドキュメントにアクセス
 * @access  Public (with valid token)
 */
router.get('/shared/:shareToken', 
  cacheMiddleware(3600), // 1時間キャッシュ
  documentController.getSharedDocument
);

/**
 * @route   POST /api/documents/:documentId/verify
 * @desc    ドキュメントの検証ステータスを更新
 * @access  Private (Admin only)
 */
router.post('/:documentId/verify', 
  authenticateToken,
  checkRole(['admin']),
  documentController.verifyDocument
);

/**
 * @route   GET /api/documents/:documentId/download
 * @desc    ドキュメントをダウンロード
 * @access  Private
 */
router.get('/:documentId/download', 
  authenticateToken,
  documentController.downloadDocument
);

/**
 * @route   POST /api/documents/batch-upload
 * @desc    複数のドキュメントを一括アップロード
 * @access  Private
 */
router.post('/batch-upload', 
  authenticateToken,
  upload.array('documents', 10),
  documentController.batchUploadDocuments
);

/**
 * @route   GET /api/documents/stats/summary
 * @desc    ドキュメント統計情報を取得
 * @access  Private (Admin only)
 */
router.get('/stats/summary', 
  authenticateToken,
  checkRole(['admin']),
  cacheMiddleware(900), // 15分キャッシュ
  documentController.getDocumentStats
);

module.exports = router;