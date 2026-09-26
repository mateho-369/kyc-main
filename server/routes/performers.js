const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const { check, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/hybrid-auth');
const checkRole = require('../middleware/checkRole');
const { Performer, AuditLog, User } = require('../models');
const { Op } = require('sequelize');
const { notifySharegram } = require('../services/sharegram/sharegramWebhook');

// 画面/Sharegram は snake_case（agreement_file）、DB は camelCase（agreementFile）で
// 書類名を扱う。API の入口で揃えないと「存在する書類が 404」になる。
const DOCUMENT_TYPE_ALIASES = {
  agreement_file: 'agreementFile',
  id_front: 'idFront',
  id_back: 'idBack',
  selfie_with_id: 'selfieWithId'
};
const normalizeDocumentType = (type) => DOCUMENT_TYPE_ALIASES[type] || type;
const sameId = (a, b) => a != null && b != null && Number(a) === Number(b);
const canAccessPerformer = (req, performer) => {
  if (req.user?.role === 'user') return sameId(performer.userId, req.user.id);
  // API-key callers must carry a scope; JWT admins retain their administrative access.
  if (!req.user?.id || req.sharegramAuth) {
    const scope = req.query?.user_id || req.get?.('x-sharegram-user-id');
    return Boolean(scope) && (String(scope) === String(performer.sharegramUserId) || sameId(scope, performer.userId));
  }
  return req.user.role === 'admin';
};

// documents は JSON カラム。MySQL はオブジェクト、MariaDB などでは文字列で返るので両対応する。
const toDocumentsObject = (value) => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
};

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // アップロードディレクトリのパスを修正
    const uploadDir = path.join(__dirname, '..', 'uploads', 'performers');
    
    console.log('アップロードディレクトリ:', uploadDir);
    
    // ディレクトリが存在しない場合は作成
    if (!fs.existsSync(uploadDir)) {
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log('アップロードディレクトリを作成しました:', uploadDir);
      } catch (err) {
        console.error('ディレクトリ作成エラー:', err);
        return cb(err, null);
      }
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // ファイル名をユニークにするために現在時刻を追加
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// ファイルフィルター
const fileFilter = (req, file, cb) => {
  const allowedFileTypes = /jpeg|jpg|png|pdf/;
  const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedFileTypes.test(file.mimetype);
  
  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('許可されているファイル形式はJPEG、PNG、PDFのみです'));
  }
};

// アップロード制限
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

// アップロードフィールド
const uploadFields = upload.fields([
  { name: 'agreementFile', maxCount: 1 },
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
  { name: 'selfieWithId', maxCount: 1 }
]);

// @route   GET api/performers
// @desc    Get all performers
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    // データベース無効時のモックレスポンス
    if (process.env.DISABLE_DB === 'true') {
      const mockPerformers = [
        {
          id: 5558,
          external_id: '5558',
          lastName: 'テスト',
          firstName: '出演者',
          lastNameRoman: 'Test',
          firstNameRoman: 'Performer',
          status: 'active',
          kycStatus: 'verified',
          kycVerifiedAt: new Date('2024-01-01'),
          riskScore: 0.1,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01')
        }
      ];

      // 仕様書に準拠したレスポンス形式
      return res.json({
        success: true,
        data: mockPerformers
      });
    }

    // Shared API-key callers must always specify an owner scope. A Firebase UID takes
    // precedence; otherwise user_id is interpreted as a Sharegram account id.
    const { status, sort, expiring, search, external_ids, user_id } = req.query;
    const sharedCaller = Boolean(req.sharegramAuth) || !req.user?.id;
    if (sharedCaller && !user_id && !external_ids) {
      return res.status(400).json({ success: false, message: 'owner scope required: user_id / external_ids' });
    }
    
    // 検索条件の構築
    const whereClause = {};
    
    // ステータスによるフィルタリング
    // Sharegram APIリクエスト時はstatusフィルタを無視（pending含め全件返す）
    if (status && !req.sharegramAuth) {
      whereClause.status = status;
    }

    // external_idsによるフィルタリング
    if (external_ids) {
      const ids = external_ids.split(',').map(id => id.trim());
      whereClause.external_id = {
        [Op.in]: ids
      };
    }

    // user_id（Firebase UID）によるフィルタリング
    if (user_id) {
      // Identifier precedence: exact Firebase UID first, then Sharegram account id.
      const userByFirebase = await User.findOne({ where: { firebaseUid: user_id }, attributes: ['id'] });
      if (userByFirebase) {
        whereClause.userId = userByFirebase.id;
      } else {
        whereClause.sharegramUserId = user_id;
      }
    }

    // 期限切れ間近の書類フィルタリング
    if (expiring === 'true') {
      // 例として3ヶ月以上前に作成され、検証済みの書類を「期限切れ間近」とする
      whereClause.createdAt = {
        [Op.lte]: new Date(new Date().setMonth(new Date().getMonth() - 3))
      };
      whereClause[Op.and] = [
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
      ];
    }
    
    // 検索キーワードによるフィルタリング
    if (search) {
      whereClause[Op.or] = [
        { lastName: { [Op.like]: `%${search}%` } },
        { firstName: { [Op.like]: `%${search}%` } },
        { lastNameRoman: { [Op.like]: `%${search}%` } },
        { firstNameRoman: { [Op.like]: `%${search}%` } }
      ];
    }
    
    // ソート順の設定
    let order = [['createdAt', 'DESC']]; // デフォルトは作成日の降順
    
    if (sort === 'updatedAt') {
      order = [['updatedAt', 'DESC']]; // 更新日の降順
    } else if (sort === 'name') {
      order = [['lastName', 'ASC'], ['firstName', 'ASC']]; // 名前の昇順
    }
    
    // ユーザーロールの場合は自分が登録したデータのみ取得
    // Sharegram APIの場合はユーザー制限をスキップ
    if (req.user && req.user.role === 'user') {
      whereClause.userId = req.user?.id;
    }

    // ページネーション設定
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    // 総件数を取得
    const totalCount = await Performer.count({ where: whereClause });

    const performers = await Performer.findAll({
      where: whereClause,
      order,
      attributes: [
        'id',
        'external_id',
        'sharegramUserId',
        'lastName',
        'firstName',
        'lastNameRoman',
        'firstNameRoman',
        'status',
        'kycStatus',
        'kycVerifiedAt',
        'riskScore',
        'createdAt',
        'updatedAt',
        'userId'
      ],
      limit,
      offset
    });
    
    // 監査ログ記録（userIdがnullの場合はスキップ - テストAPIキー認証時）
    const auditUserId = req.user?.id || req.sharegramAuth?.userId || null;
    if (auditUserId) {
      await AuditLog.create({
        userId: auditUserId,
        action: req.sharegramAuth ? 'sharegram_read' : 'read',
        resourceType: 'performer',
        resourceId: 0, // 全体リスト
        details: {
          query: req.query,
          authType: req.sharegramAuth ? 'sharegram' : 'jwt',
          apiClient: req.sharegramAuth?.apiClient
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    }
    
    // 仕様書に準拠したレスポンス形式で返す
    // data は出演者の配列を直接返す
    res.json({
      success: true,
      data: performers
    });
  } catch (err) {
    console.error('出演者一覧取得エラー:', err.message, err.stack);
    res.status(500).json({ 
      success: false,
      message: '出演者情報の取得に失敗しました。', 
      error: err.message 
    });
  }
});

// @route   GET api/performers/:id
// @desc    Get performer by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ 
        success: false,
        message: '出演者情報が見つかりません。正しいIDで再度お試しください。' 
      });
    }
    
    // ユーザーロールの場合、自分が登録したデータのみアクセス可能
    if (!canAccessPerformer(req, performer)) {
      return res.status(403).json({ 
        success: false,
        message: 'このデータへのアクセス権限がありません。' 
      });
    }
    
    // 監査ログ記録（ユーザー認証時のみ）
    if (req.user && req.user.id) {
    await AuditLog.create({
      userId: req.user?.id || null,
      action: 'read',
      resourceType: 'performer',
      resourceId: performer.id,
      details: {},
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });
    
    }
    // 統一されたレスポンス形式で返す
    res.json({
      success: true,
      data: {
        performer: performer
      }
    });
  } catch (err) {
    console.error('出演者詳細取得エラー:', err.message, err.stack);
    res.status(500).json({ 
      success: false,
      message: '出演者情報の取得に失敗しました。', 
      error: err.message 
    });
  }
});

// @route   PUT api/performers/:id
// @desc    Update a performer
// @access  Private
router.put('/:id', auth, uploadFields, async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);

    if (!performer) {
      return res.status(404).json({
        success: false,
        message: '出演者情報が見つかりません。'
      });
    }

    // ユーザーロールの場合、自分が登録したデータのみ更新可能
    if (!canAccessPerformer(req, performer)) {
      return res.status(403).json({
        success: false,
        message: 'このデータの更新権限がありません。'
      });
    }

    const { lastName, firstName, lastNameRoman, firstNameRoman } = req.body;

    // テキストフィールドの更新
    if (lastName) performer.lastName = lastName;
    if (firstName) performer.firstName = firstName;
    if (lastNameRoman) performer.lastNameRoman = lastNameRoman;
    if (firstNameRoman) performer.firstNameRoman = firstNameRoman;

    // ドキュメントの更新（新しいファイルがアップロードされた場合のみ）
    if (req.files && Object.keys(req.files).length > 0) {
      const currentDocs = performer.documents || {};
      const docTypes = ['agreementFile', 'idFront', 'idBack', 'selfie', 'selfieWithId'];

      for (const docType of docTypes) {
        if (req.files[docType]) {
          // 古いファイルを削除
          if (currentDocs[docType] && currentDocs[docType].path) {
            try {
              fs.unlinkSync(currentDocs[docType].path);
            } catch (e) {
              console.error('旧ファイル削除エラー:', e.message);
            }
          }
          // 新しいファイル情報を設定
          currentDocs[docType] = {
            path: req.files[docType][0].path,
            originalName: req.files[docType][0].originalname,
            mimeType: req.files[docType][0].mimetype,
            verified: false
          };
        }
      }
      performer.documents = currentDocs;
      performer.changed('documents', true);
    }

    await performer.save();

    // 監査ログ記録
    if (req.user && req.user.id) {
      await AuditLog.create({
        userId: req.user.id,
        action: 'update',
        resourceType: 'performer',
        resourceId: performer.id,
        details: {
          updatedFields: Object.keys(req.body),
          updatedDocuments: req.files ? Object.keys(req.files) : []
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    }

    notifySharegram('performer.updated', performer, {
      updatedDocuments: req.files ? Object.keys(req.files) : []
    });

    res.json({
      success: true,
      data: { performer }
    });
  } catch (err) {
    console.error('出演者更新エラー:', err.message, err.stack);
    if (req.files) {
      Object.values(req.files).forEach(files => {
        files.forEach(file => {
          try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
        });
      });
    }
    res.status(500).json({
      success: false,
      message: '出演者情報の更新に失敗しました。',
      error: err.message
    });
  }
});

// @route   POST api/performers
// @desc    Create a performer
// @access  Private
router.post('/', auth, uploadFields, async (req, res) => {
  try {
    // 処理前にリクエストの内容をログに出力（デバッグ用）
    console.log('リクエスト受信:', {
      body: req.body,
      files: req.files ? Object.keys(req.files) : 'なし'
    });
    
    const { lastName, firstName, lastNameRoman, firstNameRoman } = req.body;
    const external_id = req.body.external_id || (req.user && req.user.sharegramUserId) || null;
    
    // 入力検証
    if (!lastName || !firstName || !lastNameRoman || !firstNameRoman) {
      // アップロードされたファイルを削除
      if (req.files) {
        Object.values(req.files).forEach(files => {
          files.forEach(file => {
            try {
              fs.unlinkSync(file.path);
            } catch (e) {
              console.error('ファイル削除エラー:', e);
            }
          });
        });
      }
      return res.status(400).json({ message: '氏名は必須です。すべての氏名フィールドを入力してください。' });
    }
    
    // 必須ファイルの確認
    if (!req.files || !req.files.agreementFile || !req.files.idFront || !req.files.selfie) {
      // アップロードされたファイルを削除
      if (req.files) {
        Object.values(req.files).forEach(files => {
          files.forEach(file => {
            try {
              fs.unlinkSync(file.path);
            } catch (e) {
              console.error('ファイル削除エラー:', e);
            }
          });
        });
      }
      return res.status(400).json({ message: '必須ファイル（許諾書、身分証明書表面、本人写真）がアップロードされていません。すべての必須書類をアップロードしてください。' });
    }
    
    // Ownership is mandatory for newly-created performers. Resolve the Sharegram id
    // from the persisted owner when the SSO token did not carry it.
    const owner = req.user?.id ? await User.findByPk(req.user.id) : null;
    const ownerId = req.user?.id || null;
    const sharegramOwnerId = req.user?.sharegramUserId || owner?.sharegramUserId;
    if (!ownerId || !sharegramOwnerId) {
      return res.status(409).json({ success: false, message: 'Unable to resolve performer owner; performer was not created.' });
    }

    // 出演者データの作成
    const performer = await Performer.create({
      userId: ownerId, // 作成者のユーザーID
      lastName,
      firstName,
      lastNameRoman,
      firstNameRoman,
      external_id: external_id,
      sharegramUserId: sharegramOwnerId,
      status: 'pending', // 初期ステータスは「保留中」
      documents: {
        agreementFile: req.files.agreementFile ? {
          path: req.files.agreementFile[0].path,
          originalName: req.files.agreementFile[0].originalname,
          mimeType: req.files.agreementFile[0].mimetype,
          verified: false
        } : null,
        idFront: req.files.idFront ? {
          path: req.files.idFront[0].path,
          originalName: req.files.idFront[0].originalname,
          mimeType: req.files.idFront[0].mimetype,
          verified: false
        } : null,
        idBack: req.files.idBack ? {
          path: req.files.idBack[0].path,
          originalName: req.files.idBack[0].originalname,
          mimeType: req.files.idBack[0].mimetype,
          verified: false
        } : null,
        selfie: req.files.selfie ? {
          path: req.files.selfie[0].path,
          originalName: req.files.selfie[0].originalname,
          mimeType: req.files.selfie[0].mimetype,
          verified: false
        } : null,
        selfieWithId: req.files.selfieWithId ? {
          path: req.files.selfieWithId[0].path,
          originalName: req.files.selfieWithId[0].originalname,
          mimeType: req.files.selfieWithId[0].mimetype,
          verified: false
        } : null
      }
    });
    
    console.log('出演者情報登録成功:', performer.id);
    
    // 監査ログ記録（ユーザー認証時のみ）
    if (req.user && req.user.id) {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'create',
        resourceType: 'performer',
        resourceId: performer.id,
        details: {
          lastName,
          firstName,
          lastNameRoman,
          firstNameRoman,
          documents: Object.keys(req.files).map(key => key)
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    }
    
    // Sharegram へ通知（KYC_WEBHOOK_URL 設定時のみ。レスポンスはブロックしない）
    notifySharegram('performer.created', performer);

    // 統一されたレスポンス形式で返す
    res.json({
      success: true,
      data: performer
    });
  } catch (err) {
    // より詳細なエラーログ
    console.error('出演者登録エラー詳細:', err.message, err.stack);
    
    // アップロードされたファイルを削除
    if (req.files) {
      Object.values(req.files).forEach(files => {
        files.forEach(file => {
          try {
            fs.unlinkSync(file.path);
          } catch (e) {
            console.error('ファイル削除エラー:', e);
          }
        });
      });
    }
    
    // クライアントへのエラー応答を改善
    res.status(500).json({
      message: '出演者情報の登録に失敗しました。',
      error: err.message
    });
  }
});

// @route   GET api/performers/:id/documents
// @desc    Get documents for a performer
// @access  Private
router.get('/:id/documents', auth, async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ 
        success: false,
        message: '出演者情報が見つかりません。正しいIDで再度お試しください。' 
      });
    }
    
    // ユーザーロールの場合、自分が登録したデータのみアクセス可能
    if (!canAccessPerformer(req, performer)) {
      return res.status(403).json({ 
        success: false,
        message: 'このデータへのアクセス権限がありません。' 
      });
    }
    
    // documents JSONから書類情報の配列を作成
    const documents = [];
    const docData = performer.documents || {};
    
    if (docData.agreementFile) {
      documents.push({
        id: 'agreementFile',
        type: 'agreementFile',
        name: '出演同意書',
        originalName: docData.agreementFile.originalName,
        mimeType: docData.agreementFile.mimeType,
        verified: docData.agreementFile.verified,
        updatedAt: performer.updatedAt
      });
    }
    
    if (docData.idFront) {
      documents.push({
        id: 'idFront',
        type: 'idFront',
        name: '身分証明書（表面）',
        originalName: docData.idFront.originalName,
        mimeType: docData.idFront.mimeType,
        verified: docData.idFront.verified,
        updatedAt: performer.updatedAt
      });
    }
    
    if (docData.idBack) {
      documents.push({
        id: 'idBack',
        type: 'idBack',
        name: '身分証明書（裏面）',
        originalName: docData.idBack.originalName,
        mimeType: docData.idBack.mimeType,
        verified: docData.idBack.verified,
        updatedAt: performer.updatedAt
      });
    }
    
    if (docData.selfie) {
      documents.push({
        id: 'selfie',
        type: 'selfie',
        name: '本人写真',
        originalName: docData.selfie.originalName,
        mimeType: docData.selfie.mimeType,
        verified: docData.selfie.verified,
        updatedAt: performer.updatedAt
      });
    }
    
    if (docData.selfieWithId) {
      documents.push({
        id: 'selfieWithId',
        type: 'selfieWithId',
        name: '本人と身分証明書の写真',
        originalName: docData.selfieWithId.originalName,
        mimeType: docData.selfieWithId.mimeType,
        verified: docData.selfieWithId.verified,
        updatedAt: performer.updatedAt
      });
    }
    
    // 監査ログ記録（ユーザー認証時のみ）
    if (req.user && req.user.id) {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'read',
        resourceType: 'document',
        resourceId: performer.id,
        details: { documentCount: documents.length },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    }
    
    res.json({
      success: true,
      data: {
        documents: documents
      }
    });
  } catch (err) {
    console.error('書類取得エラー:', err.message, err.stack);
    res.status(500).json({ 
      message: '書類情報の取得に失敗しました。', 
      error: err.message 
    });
  }
});

// NOTE: /:id/documents/metadata は /:id/documents/:type より前に定義すること。
// 後ろにあると Express が :type = "metadata" として先にマッチさせ、常に 404 になる。
// @route   GET api/performers/:id/documents/metadata
// @desc    Get document metadata (lightweight)
// @access  Private (CEOミッション緊急実装)
router.get('/:id/documents/metadata', auth, async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ 
        success: false,
        error: {
          code: 'PERFORMER_NOT_FOUND',
          message: '出演者情報が見つかりません。'
        }
      });
    }

    // アクセス制御：本人または管理者のみ
    if (!canAccessPerformer(req, performer)) {
      return res.status(403).json({ 
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'アクセス権限がありません。'
        }
      });
    }

    // 軽量メタデータを構築
    // （以前は JSON.parse(object) で常に例外 → 500 になっていた）
    const documents = toDocumentsObject(performer.documents);
    const documentMetadata = [];

    const documentTypes = [
      { type: 'agreementFile', name: '出演同意書' },
      { type: 'idFront', name: '身分証明書（表面）' },
      { type: 'idBack', name: '身分証明書（裏面）' },
      { type: 'selfie', name: 'セルフィー' },
      { type: 'selfieWithId', name: '身分証明書付きセルフィー' }
    ];

    documentTypes.forEach(({ type, name }) => {
      const doc = documents[type];
      if (doc) {
        documentMetadata.push({
          type,
          name,
          status: doc.verified ? 'verified' : 'pending',
          uploadedAt: doc.uploadedAt || performer.createdAt,
          verifiedAt: doc.verifiedAt || null,
          verifiedBy: doc.verifiedBy || null,
          fileSize: doc.size || null,
          mimeType: doc.mimeType || null
        });
      } else {
        documentMetadata.push({
          type,
          name,
          status: 'missing',
          uploadedAt: null,
          verifiedAt: null,
          verifiedBy: null,
          fileSize: null,
          mimeType: null
        });
      }
    });

    // 監査ログ記録（ユーザー認証時のみ）
    if (req.user && req.user.id) {
      // AuditLog の必須カラムは resourceType / resourceId（targetType/targetId は存在せず
      // notNull 違反で 500 になっていた）
      await AuditLog.create({
        userId: req.user.id,
        action: 'view',
        resourceType: 'document',
        resourceId: performer.id,
        details: {
          documentType: 'metadata',
          documentCount: documentMetadata.length
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    }

    res.json({
      success: true,
      data: {
        performerId: performer.id,
        documents: documentMetadata,
        totalDocuments: documentMetadata.length,
        verifiedDocuments: documentMetadata.filter(d => d.status === 'verified').length,
        pendingDocuments: documentMetadata.filter(d => d.status === 'pending').length,
        missingDocuments: documentMetadata.filter(d => d.status === 'missing').length,
        overallStatus: performer.status || 'pending'
      }
    });

  } catch (error) {
    console.error('Document metadata error:', error);
    res.status(500).json({ 
      success: false,
      error: {
        code: 'METADATA_ERROR',
        message: 'メタデータの取得中にエラーが発生しました。'
      }
    });
  }
});

// /:id/documents/:type エンドポイントを探して修正
router.get('/:id/documents/:type', auth, async (req, res) => {
  try {
    console.log('=== 直接ファイル送信方式: ファイル表示対応 ===');
    console.log('リクエスト:', req.params.id, req.params.type);
    
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ message: '出演者情報が見つかりません' });
    }
    
    // ユーザーロールの場合、自分が登録したデータのみアクセス可能
    if (!canAccessPerformer(req, performer)) {
      return res.status(403).json({ 
        success: false,
        message: 'このデータへのアクセス権限がありません。' 
      });
    }
    
    const docType = normalizeDocumentType(req.params.type);
    const docData = toDocumentsObject(performer.documents)[docType] || null;
    
    if (!docData || !docData.path) {
      return res.status(404).json({ message: '指定された書類が見つかりません' });
    }
    
    // ファイル存在チェック
    if (!fs.existsSync(docData.path)) {
      return res.status(404).json({ message: 'ファイルが存在しません' });
    }
    
    // 監査ログを記録
    await AuditLog.create({
      userId: req.user?.id || null,
      action: req.query.download === 'true' ? 'download' : 'view',
      resourceType: 'document',
      resourceId: performer.id,
      details: { documentType: docType },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });
    
    // ダウンロードモードかどうか確認
    if (req.query.download === 'true') {
      // ダウンロード用のファイル名を設定
      const extension = path.extname(docData.path).substring(1) || 'pdf';
      const filename = `${docType}_${performer.lastName}_${performer.firstName}.${extension}`;
      return res.download(docData.path, filename);
    }
    
    // 重要な変更: リダイレクトではなく、直接ファイルを送信
    console.log('ファイルを直接送信:', docData.path);
    res.setHeader('Content-Type', docData.mimeType || 'application/octet-stream');
    res.sendFile(path.resolve(docData.path));
    
  } catch (err) {
    console.error('書類取得エラー:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'サーバーエラー', error: err.message });
    }
  }
});

// @route   PUT api/performers/:id/documents/:type/verify
// @desc    Verify a document
// @access  Private
router.put('/:id/documents/:type/verify', auth, async (req, res) => {
  try {
    // 管理者のみ検証可能
    // Sharegram API auth: skip admin check
    if (!req.sharegramAuth && (!req.user || req.user.role !== 'admin')) {
      return res.status(403).json({ message: '書類の検証は管理者のみが実行できます。' });
    }
    
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ 
        success: false,
        message: '出演者情報が見つかりません。正しいIDで再度お試しください。' 
      });
    }
    
    // 画面は agreement_file、DB は agreementFile。入口で揃える（以前はここで 404 になっていた）
    const docType = normalizeDocumentType(req.params.type);
    const documents = { ...toDocumentsObject(performer.documents) };
    
    if (!documents[docType]) {
      return res.status(404).json({ message: '指定された書類が見つかりません。正しい書類タイプを指定してください。' });
    }
    
    // 書類の検証ステータスを更新
    documents[docType].verified = true;
    documents[docType].verifiedAt = new Date();
    documents[docType].verifiedBy = req.user?.id;
    
    // 出演者データを更新
    await Performer.update({ documents }, {
      where: { id: req.params.id }
    });
    
    // すべての必須書類が検証されたかチェック
    const allVerified = 
      documents.agreementFile?.verified && 
      documents.idFront?.verified && 
      documents.selfie?.verified;
    
    // すべて検証済みの場合はステータスを更新
    if (allVerified) {
      await Performer.update({ status: 'active' }, {
        where: { id: req.params.id }
      });
    }
    
    // 監査ログ記録（ユーザー認証時のみ）
    if (req.user && req.user.id) {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'verify',
        resourceType: 'document',
        resourceId: performer.id,
        details: { documentType: docType },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    }

    // 上の Performer.update はインスタンスを更新しないので、保存した値で通知する
    const verifiedPerformer = {
      ...performer.get({ plain: true }),
      documents,
      status: allVerified ? 'active' : performer.status
    };
    notifySharegram('document.verified', verifiedPerformer, { document: { type: docType } });
    if (allVerified) {
      notifySharegram('performer.approved', verifiedPerformer);
    }
    
    res.json({ 
      message: '書類が検証されました', 
      verified: true,
      allVerified
    });
  } catch (err) {
    console.error('書類検証エラー:', err.message, err.stack);
    res.status(500).json({ 
      message: '書類の検証に失敗しました。', 
      error: err.message 
    });
  }
});

// @route   POST api/performers/sync
// @desc    Sync performers from external system (Enhanced for Sharegram)
// @access  Private (Admin only)
router.post('/sync', auth, async (req, res) => {
  try {
    // Sharegram API auth: skip admin check for system integration
    if (!req.sharegramAuth && (!req.user || req.user.role !== 'admin')) {
      return res.status(403).json({ 
        success: false,
        message: '同期処理は管理者のみが実行できます。',
        code: 'INSUFFICIENT_PRIVILEGES'
      });
    }

    const { performer, performers, source = 'manual', options = {} } = req.body;

    // 入力データの検証 - 単一performer形式（仕様）または配列形式（後方互換）に対応
    let performersList;
    if (performer && typeof performer === 'object') {
      // 仕様に準拠した単一オブジェクト形式
      performersList = [performer];
    } else if (performers && Array.isArray(performers)) {
      // 後方互換性のための配列形式
      performersList = performers;
    } else {
      return res.status(400).json({
        success: false,
        message: '同期データが不正です。performer オブジェクトを送信してください。',
        code: 'INVALID_INPUT_FORMAT'
      });
    }

    if (performersList.length === 0) {
      return res.status(400).json({
        success: false,
        message: '同期するperformerが指定されていません。',
        code: 'EMPTY_PERFORMER_DATA'
      });
    }

    // Use performersList for subsequent processing (reassign to performers for compatibility)
    
    // 入力データの検証
    if (!performers || !Array.isArray(performers)) {
      return res.status(400).json({ 
        success: false,
        message: '同期データが不正です。performers配列を送信してください。',
        code: 'INVALID_INPUT_FORMAT'
      });
    }

    if (performers.length === 0) {
      return res.status(400).json({
        success: false,
        message: '同期するperformersが指定されていません。',
        code: 'EMPTY_PERFORMERS_ARRAY'
      });
    }

    // Sharegramソース固有の検証
    if (source === 'sharegram') {
      const { createSharegramClient } = require('../services/sharegram/sharegramClient');
      try {
        // Sharegram APIクライアントの初期化
        const sharegramClient = await createSharegramClient(1); // デフォルトの統合ID
        req.sharegramClient = sharegramClient;
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: 'Sharegram API接続に失敗しました。',
          code: 'SHAREGRAM_CONNECTION_FAILED',
          error: error.message
        });
      }
    }

    // 同期結果の初期化
    const startTime = Date.now();
    const results = {
      total: performers.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      source,
      syncId: require('crypto').randomUUID(),
      startTime: new Date().toISOString(),
      endTime: null,
      processingTimeMs: 0,
      sharegramValidations: 0,
      kycUpdates: 0
    };

    // 100件ずつバッチ処理
    const batchSize = 100;
    for (let i = 0; i < performers.length; i += batchSize) {
      const batch = performers.slice(i, i + batchSize);
      
      // バッチ処理
      await Promise.all(batch.map(async (performerData) => {
        try {
          // 必須フィールドの検証
          const validationErrors = [];
          
          if (!performerData.external_id) {
            validationErrors.push('external_idが必須です');
          }
          
          if (source === 'sharegram') {
            if (!performerData.sharegramUserId) {
              validationErrors.push('sharegramソースの場合、sharegramUserIdが必須です');
            }
            if (!performerData.lastName || !performerData.firstName) {
              validationErrors.push('姓名が必須です');
            }
          }
          
          if (validationErrors.length > 0) {
            results.errors.push({
              external_id: performerData.external_id || 'unknown',
              errors: validationErrors
            });
            results.skipped++;
            return;
          }

          // external_idで既存レコードを検索
          let performer = await Performer.findOne({
            where: { external_id: performerData.external_id }
          });

          if (performer) {
            // 既存レコードの更新
            const updateData = {
              lastName: performerData.lastName || performer.lastName,
              firstName: performerData.firstName || performer.firstName,
              lastNameRoman: performerData.lastNameRoman || performer.lastNameRoman,
              firstNameRoman: performerData.firstNameRoman || performer.firstNameRoman,
              status: performerData.status || performer.status,
              // documentsは既存のものとマージ
              documents: {
                ...performer.documents,
                ...(performerData.documents || {})
              },
              lastSyncTime: new Date(),
              syncSource: source
            };
            
            // Sharegram固有フィールドの更新
            if (source === 'sharegram') {
              updateData.sharegramUserId = performerData.sharegramUserId || performer.sharegramUserId;
              updateData.kycMetadata = {
                ...performer.kycMetadata,
                ...(performerData.kycMetadata || {}),
                lastSharegramSync: new Date().toISOString()
              };
              
              // KYCステータスの更新
              if (performerData.kycStatus) {
                updateData.kycStatus = performerData.kycStatus;
                if (performerData.kycStatus === 'verified') {
                  updateData.kycVerifiedAt = new Date();
                }
                results.kycUpdates++;
              }
              
              // リスクスコアの更新
              if (performerData.riskScore !== undefined) {
                updateData.riskScore = performerData.riskScore;
              }
            }
            
            await performer.update(updateData);
            results.updated++;
          } else {
            // 新規作成
            const createData = {
              external_id: performerData.external_id,
              userId: req.user?.id || null, // 同期実行者をuserIdとして設定
              lastName: performerData.lastName,
              firstName: performerData.firstName,
              lastNameRoman: performerData.lastNameRoman,
              firstNameRoman: performerData.firstNameRoman,
              status: performerData.status || 'pending',
              documents: performerData.documents || {},
              createdAt: new Date(),
              lastSyncTime: new Date(),
              syncSource: source
            };
            
            // Sharegram固有フィールドの設定
            if (source === 'sharegram') {
              createData.sharegramUserId = performerData.sharegramUserId;
              createData.kycStatus = performerData.kycStatus || 'pending';
              createData.kycMetadata = {
                ...(performerData.kycMetadata || {}),
                firstSharegramSync: new Date().toISOString(),
                lastSharegramSync: new Date().toISOString()
              };
              
              if (performerData.riskScore !== undefined) {
                createData.riskScore = performerData.riskScore;
              }
              
              if (performerData.kycStatus === 'verified') {
                createData.kycVerifiedAt = new Date();
                results.kycUpdates++;
              }
            }
            
            performer = await Performer.create(createData);
            results.created++;
          }
        } catch (error) {
          console.error(`Performer sync error for ${performerData.external_id}:`, error);
          results.errors.push({
            external_id: performerData.external_id || 'unknown',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            timestamp: new Date().toISOString()
          });
          results.skipped++;
        }
      }));
    }

    // 結果のファイナライズ
    results.endTime = new Date().toISOString();
    results.processingTimeMs = Date.now() - startTime;
    
    // Sharegram APIのヘルスチェック（ソースがsharegramの場合）
    if (source === 'sharegram' && req.sharegramClient) {
      try {
        const healthCheck = await req.sharegramClient.checkHealth();
        results.sharegramHealthCheck = healthCheck;
      } catch (error) {
        console.warn('Sharegram health check failed:', error.message);
        results.sharegramHealthCheck = { success: false, error: error.message };
      }
    }
    
    // 監査ログ記録（ユーザー認証時のみ）
    if (req.user && req.user.id) {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'sync',
        resourceType: 'performer',
        resourceId: 0,
        details: {
          results,
          source,
          options,
          syncDuration: results.processingTimeMs,
          timestamp: results.endTime
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    }

    // 成功レスポンスの返却
    res.json({
      success: true,
      message: `同期が完了しました。${results.created}件作成、${results.updated}件更新、${results.skipped}件スキップしました。`,
      data: {
        sync: results,
        summary: {
          totalProcessed: results.total,
          successCount: results.created + results.updated,
          errorCount: results.errors.length,
          processingTime: `${results.processingTimeMs}ms`,
          source: results.source
        }
      }
    });
  } catch (error) {
    console.error('出演者同期エラー:', error);
    
    // エラー監査ログ記録
    try {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'sync_failed',
        resourceType: 'performer',
        resourceId: 0,
        details: {
          error: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          source: req.body.source || 'unknown',
          timestamp: new Date().toISOString()
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    } catch (auditError) {
      console.error('監査ログ記録エラー:', auditError);
    }
    
    res.status(500).json({ 
      success: false,
      message: '同期処理中にエラーが発生しました。',
      code: 'SYNC_PROCESSING_ERROR',
      error: process.env.NODE_ENV === 'development' ? error.message : '内部エラーが発生しました'
    });
  }
});

// @route   POST api/performers/:id/approve
// @desc    Approve a performer registration
// @access  Private (Admin only)
router.post('/:id/approve', [auth, checkRole(['admin'])], async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ message: '出演者情報が見つかりません' });
    }
    
    // ステータスを承認済みに更新
    performer.status = 'active';
    await performer.save();
    
    // 監査ログ記録（ユーザー認証時のみ）
    if (req.user && req.user.id) {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'approve',
        resourceType: 'performer',
        resourceId: performer.id,
        details: {
          previousStatus: performer.status,
          newStatus: 'active',
          performerName: `${performer.lastName} ${performer.firstName}`
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    }
    
    notifySharegram('performer.approved', performer);

    // Webhook通知をトリガー（別途実装）
    const { triggerWebhook } = require('../services/webhookService');
    await triggerWebhook('performer.approved', {
      performerId: performer.id,
      externalId: performer.external_id,
      name: `${performer.lastName} ${performer.firstName}`,
      approvedAt: new Date(),
      approvedBy: req.user?.id
    });
    
    res.json({
      message: '出演者が承認されました',
      performer: performer
    });
  } catch (err) {
    console.error('出演者承認エラー:', err);
    res.status(500).json({ 
      message: '出演者の承認に失敗しました', 
      error: err.message 
    });
  }
});

// @route   POST api/performers/registration-complete
// @desc    Mark performer registration as complete
// @access  Private
router.post('/registration-complete', auth, async (req, res) => {
  try {
    // IDをリクエストボディから取得
    const { performerId } = req.body;
    
    if (!performerId) {
      return res.status(400).json({ message: '出演者IDが指定されていません' });
    }
    
    const performer = await Performer.findByPk(performerId);
    
    if (!performer) {
      return res.status(404).json({ message: '出演者情報が見つかりません' });
    }
    
    // ユーザーロールの場合、自分が登録したデータのみアクセス可能
    if (!canAccessPerformer(req, performer)) {
      return res.status(403).json({ message: 'このデータへのアクセス権限がありません' });
    }
    
    // 必須ドキュメントの確認
    const documents = performer.documents || {};
    const requiredDocs = ['agreementFile', 'idFront', 'selfie'];
    const missingDocs = requiredDocs.filter(doc => !documents[doc]);
    
    if (missingDocs.length > 0) {
      return res.status(400).json({ 
        message: '必須書類が不足しています',
        missingDocuments: missingDocs 
      });
    }
    
    // KYCステータスを更新
    if (performer.kycStatus === 'not_started') {
      performer.kycStatus = 'in_progress';
    }
    
    // メタデータに登録完了時刻を記録
    performer.kycMetadata = {
      ...performer.kycMetadata,
      registrationCompletedAt: new Date(),
      registrationCompletedBy: req.user?.id
    };
    
    await performer.save();
    
    // 監査ログ記録（ユーザー認証時のみ）
    if (req.user && req.user.id) {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'complete_registration',
        resourceType: 'performer',
        resourceId: performer.id,
        details: {
          performerName: `${performer.lastName} ${performer.firstName}`,
          kycStatus: performer.kycStatus
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    }
    
    // Webhook通知をトリガー
    const { triggerWebhook } = require('../services/webhookService');
    await triggerWebhook('performer.registration_completed', {
      performerId: performer.id,
      externalId: performer.external_id,
      name: `${performer.lastName} ${performer.firstName}`,
      completedAt: new Date(),
      userId: req.user?.id
    });
    
    res.json({
      message: '登録が完了しました',
      performer: performer
    });
  } catch (err) {
    console.error('登録完了エラー:', err);
    res.status(500).json({ 
      message: '登録完了処理に失敗しました', 
      error: err.message 
    });
  }
});

// @route   POST api/performers/kyc-approved
// @desc    Handle KYC approval webhook
// @access  Public (with signature verification)
router.post('/kyc-approved', async (req, res) => {
  try {
    const crypto = require('crypto');

    // Webhook signature verification (HMAC-SHA256)
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const eventType = req.headers['x-webhook-event'] || 'kyc.approved';

    if (!signature || !timestamp) {
      return res.status(401).json({
        error: 'Missing signature or timestamp headers'
      });
    }

    // Timestamp freshness check (5 minutes)
    const requestTime = new Date(timestamp);
    const now = new Date();
    const timeDiff = Math.abs(now - requestTime);

    if (isNaN(requestTime.getTime()) || timeDiff > 5 * 60 * 1000) {
      return res.status(401).json({
        error: 'Request timestamp invalid or too old'
      });
    }

    // HMAC-SHA256 signature verification
    const webhookSecret = process.env.SHAREGRAM_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('SHAREGRAM_WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Webhook verification not configured' });
    }

    const payload = timestamp + '.' + JSON.stringify(req.body);
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
      );
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    } catch (sigError) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    
    // ペイロードの取得
    const {
      performerId,
      externalId,
      kycStatus,
      verificationLevel,
      verifiedAt,
      expiresAt,
      riskScore,
      documents = [],
      verificationDetails = {},
      metadata = {}
    } = req.body;
    
    // 必須フィールドの検証
    if (!performerId || !kycStatus) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['performerId', 'kycStatus']
      });
    }
    
    // Performerの検索と更新
    const performer = await Performer.findOne({
      where: externalId ? { external_id: externalId } : { id: performerId }
    });
    
    if (!performer) {
      return res.status(404).json({
        error: 'Performer not found',
        performerId,
        externalId
      });
    }
    
    // KYCステータスの更新
    const previousKycStatus = performer.kycStatus;
    performer.kycStatus = kycStatus === 'approved' ? 'verified' : kycStatus;
    
    if (kycStatus === 'approved' || kycStatus === 'verified') {
      performer.kycVerifiedAt = verifiedAt || new Date();
      performer.kycExpiresAt = expiresAt || new Date(new Date().setFullYear(new Date().getFullYear() + 1));
    }
    
    if (riskScore !== undefined) {
      performer.riskScore = riskScore;
    }
    
    // KYCメタデータの更新
    performer.kycMetadata = {
      ...performer.kycMetadata,
      verificationLevel,
      verificationDetails,
      documentsVerified: documents,
      webhookMetadata: metadata,
      lastKycUpdate: new Date(),
      kycProvider: metadata.provider || 'external'
    };
    
    await performer.save();
    
    // 監査ログ記録
    await AuditLog.create({
      action: 'kyc_approved',
      resourceType: 'Performer',
      resourceId: performer.id,
      userId: null, // システムアクション
      userEmail: 'webhook@system',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      metadata: {
        performerId: performer.id,
        externalId: performer.external_id,
        previousKycStatus,
        newKycStatus: performer.kycStatus,
        verificationLevel,
        riskScore,
        webhookEvent: eventType
      }
    });
    
    // Webhook通知をトリガー（イベント配信）
    try {
      const { triggerWebhook } = require('../services/webhookService');
      await triggerWebhook('kyc.approved', {
        performer,
        previousKycStatus,
        kycStatus: performer.kycStatus,
        verificationLevel,
        verifiedAt: performer.kycVerifiedAt,
        expiresAt: performer.kycExpiresAt,
        riskScore,
        documents,
        verificationDetails
      });
    } catch (webhookError) {
      console.error('Webhook trigger error:', webhookError);
      // Webhookエラーは処理を止めない
    }
    
    res.json({
      success: true,
      message: 'KYC approval received',
      performerId: performer.id,
      kycStatus: performer.kycStatus,
      verifiedAt: performer.kycVerifiedAt
    });
    
  } catch (error) {
    console.error('KYC approval webhook error:', error);
    res.status(500).json({
      error: 'Failed to process KYC approval',
      message: error.message
    });
  }
});

// @route   DELETE api/performers/:id
// @desc    Delete a performer
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ 
        success: false,
        message: '出演者情報が見つかりません。正しいIDで再度お試しください。' 
      });
    }
    
    // ユーザーロールの場合、自分が登録したデータのみ削除可能
    if (!canAccessPerformer(req, performer)) {
      return res.status(403).json({ message: 'このデータを削除する権限がありません。' });
    }
    
    // 関連するファイルを削除
    const docData = performer.documents || {};
    Object.values(docData).forEach(doc => {
      if (doc && doc.path) {
        try {
          fs.unlinkSync(doc.path);
        } catch (e) {
          console.error(`ファイル削除エラー: ${e.message}`);
        }
      }
    });
    
    // 監査ログ記録（ユーザー認証時のみ）（出演者削除前に記録）
    if (req.user && req.user.id) {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'delete',
        resourceType: 'performer',
        resourceId: performer.id,
        details: {
          lastName: performer.lastName,
          firstName: performer.firstName
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
    }
    
    // 出演者データを削除
    await Performer.destroy({
      where: { id: req.params.id }
    });

    // インスタンスには削除前の値が残っているので、それで通知する
    notifySharegram('performer.deleted', performer);
    
    res.json({ message: '出演者情報が削除されました' });
  } catch (err) {
    console.error('出演者削除エラー:', err.message, err.stack);
    res.status(500).json({ 
      message: '出演者情報の削除に失敗しました。', 
      error: err.message 
    });
  }
});

module.exports = router;