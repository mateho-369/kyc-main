/**
 * ドキュメントコントローラー
 * KYCドキュメントの管理、共有、検証を処理
 */

const { KYCDocument, Performer, User } = require('../models');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { clearCache } = require('../middleware/cache');

/**
 * 全ドキュメント一覧を取得
 */
const getAllDocuments = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const offset = (page - 1) * limit;
    
    const whereClause = {};
    if (status) whereClause.status = status;
    if (type) whereClause.documentType = type;

    const { count, rows } = await KYCDocument.findAndCountAll({
      where: whereClause,
      include: [{
        model: Performer,
        attributes: ['id', 'name', 'email']
      }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 特定のドキュメントを取得
 */
const getDocumentById = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    
    const document = await KYCDocument.findOne({
      where: { id: documentId },
      include: [{
        model: Performer,
        attributes: ['id', 'name', 'email']
      }]
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // アクセス権限チェック
    if (req.user.role !== 'admin' && document.performerId !== req.user.performerId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: document
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 特定のパフォーマーのドキュメント一覧を取得
 */
const getDocumentsByPerformerId = async (req, res, next) => {
  try {
    const { performerId } = req.params;
    const { type, status } = req.query;

    // アクセス権限チェック
    if (req.user.role !== 'admin' && performerId !== req.user.performerId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const whereClause = { performerId };
    if (type) whereClause.documentType = type;
    if (status) whereClause.status = status;

    const documents = await KYCDocument.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: documents
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 新しいドキュメントをアップロード
 */
const uploadDocument = async (req, res, next) => {
  try {
    const { performerId, documentType, description } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    // ファイルハッシュを生成（重複チェック用）
    const fileBuffer = await fs.readFile(file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 重複チェック
    const existingDocument = await KYCDocument.findOne({
      where: { fileHash }
    });

    if (existingDocument) {
      // アップロードされたファイルを削除
      await fs.unlink(file.path);
      
      return res.status(400).json({
        success: false,
        error: 'This document has already been uploaded'
      });
    }

    // ドキュメントレコードを作成
    const document = await KYCDocument.create({
      performerId,
      documentType,
      fileName: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      filePath: file.path,
      fileHash,
      description,
      status: 'pending',
      uploadedBy: req.user.id
    });

    // キャッシュをクリア
    clearCache(`performer:${performerId}`);

    res.status(201).json({
      success: true,
      data: document
    });
  } catch (error) {
    // エラー時はアップロードされたファイルを削除
    if (req.file && req.file.path) {
      await fs.unlink(req.file.path).catch(console.error);
    }
    next(error);
  }
};

/**
 * ドキュメント情報を更新
 */
const updateDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { description, status } = req.body;

    const document = await KYCDocument.findByPk(documentId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // 更新可能なフィールドのみ更新
    if (description !== undefined) document.description = description;
    if (status !== undefined && req.user.role === 'admin') {
      document.status = status;
      document.verifiedBy = req.user.id;
      document.verifiedAt = new Date();
    }

    await document.save();

    // キャッシュをクリア
    clearCache(`document:${documentId}`);
    clearCache(`performer:${document.performerId}`);

    res.json({
      success: true,
      data: document
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ドキュメントを削除
 */
const deleteDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;

    const document = await KYCDocument.findByPk(documentId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // ファイルを削除
    try {
      await fs.unlink(document.filePath);
    } catch (error) {
      console.error('Failed to delete file:', error);
    }

    // レコードを削除
    await document.destroy();

    // キャッシュをクリア
    clearCache(`document:${documentId}`);
    clearCache(`performer:${document.performerId}`);

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ドキュメントを共有（共有リンクを生成）
 */
const shareDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { expiresIn = 24 } = req.body; // デフォルト24時間

    const document = await KYCDocument.findByPk(documentId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // 共有トークンを生成
    const shareToken = uuidv4();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresIn);

    // 共有情報を保存
    document.shareToken = shareToken;
    document.shareExpiresAt = expiresAt;
    await document.save();

    const shareUrl = `${req.protocol}://${req.get('host')}/api/documents/shared/${shareToken}`;

    res.json({
      success: true,
      data: {
        shareUrl,
        shareToken,
        expiresAt
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 共有トークンを使ってドキュメントにアクセス
 */
const getSharedDocument = async (req, res, next) => {
  try {
    const { shareToken } = req.params;

    const document = await KYCDocument.findOne({
      where: { shareToken },
      include: [{
        model: Performer,
        attributes: ['name']
      }]
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Invalid share link'
      });
    }

    // 有効期限チェック
    if (document.shareExpiresAt && new Date() > document.shareExpiresAt) {
      return res.status(410).json({
        success: false,
        error: 'Share link has expired'
      });
    }

    // センシティブ情報を除外
    const safeDocument = {
      id: document.id,
      documentType: document.documentType,
      fileName: document.originalName,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      description: document.description,
      performerName: document.Performer.name,
      createdAt: document.createdAt
    };

    res.json({
      success: true,
      data: safeDocument
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ドキュメントの検証ステータスを更新
 */
const verifyDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { status, notes } = req.body;

    const document = await KYCDocument.findByPk(documentId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    document.status = status;
    document.verificationNotes = notes;
    document.verifiedBy = req.user.id;
    document.verifiedAt = new Date();

    await document.save();

    // キャッシュをクリア
    clearCache(`document:${documentId}`);
    clearCache(`performer:${document.performerId}`);

    res.json({
      success: true,
      data: document
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ドキュメントをダウンロード
 */
const downloadDocument = async (req, res, next) => {
  try {
    const { documentId } = req.params;

    const document = await KYCDocument.findByPk(documentId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // アクセス権限チェック
    if (req.user.role !== 'admin' && document.performerId !== req.user.performerId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // ファイルが存在するか確認
    try {
      await fs.access(document.filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    res.download(document.filePath, document.originalName);
  } catch (error) {
    next(error);
  }
};

/**
 * 複数のドキュメントを一括アップロード
 */
const batchUploadDocuments = async (req, res, next) => {
  const uploadedFiles = [];
  
  try {
    const { performerId } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    const documents = [];

    for (const file of files) {
      uploadedFiles.push(file.path);
      
      // ファイルハッシュを生成
      const fileBuffer = await fs.readFile(file.path);
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // 重複チェック
      const existingDocument = await KYCDocument.findOne({
        where: { fileHash }
      });

      if (!existingDocument) {
        const document = await KYCDocument.create({
          performerId,
          documentType: req.body[`documentType_${file.fieldname}`] || 'other',
          fileName: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          filePath: file.path,
          fileHash,
          status: 'pending',
          uploadedBy: req.user.id
        });

        documents.push(document);
      }
    }

    // キャッシュをクリア
    clearCache(`performer:${performerId}`);

    res.status(201).json({
      success: true,
      data: documents,
      summary: {
        uploaded: documents.length,
        skipped: files.length - documents.length
      }
    });
  } catch (error) {
    // エラー時はアップロードされたファイルを削除
    for (const filePath of uploadedFiles) {
      await fs.unlink(filePath).catch(console.error);
    }
    next(error);
  }
};

/**
 * ドキュメント統計情報を取得
 */
const getDocumentStats = async (req, res, next) => {
  try {
    const stats = await KYCDocument.findAll({
      attributes: [
        'status',
        [KYCDocument.sequelize.fn('COUNT', KYCDocument.sequelize.col('id')), 'count']
      ],
      group: ['status']
    });

    const typeStats = await KYCDocument.findAll({
      attributes: [
        'documentType',
        [KYCDocument.sequelize.fn('COUNT', KYCDocument.sequelize.col('id')), 'count']
      ],
      group: ['documentType']
    });

    const totalSize = await KYCDocument.sum('fileSize');
    const totalDocuments = await KYCDocument.count();

    res.json({
      success: true,
      data: {
        statusBreakdown: stats,
        typeBreakdown: typeStats,
        totalDocuments,
        totalSize,
        averageSize: totalDocuments > 0 ? totalSize / totalDocuments : 0
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllDocuments,
  getDocumentById,
  getDocumentsByPerformerId,
  uploadDocument,
  updateDocument,
  deleteDocument,
  shareDocument,
  getSharedDocument,
  verifyDocument,
  downloadDocument,
  batchUploadDocuments,
  getDocumentStats
};