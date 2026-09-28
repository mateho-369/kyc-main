const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const { check, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/hybrid-auth');
const requireReviewer = require('../middleware/requireReviewer');
const review = require('../services/performerReview');
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
const resolveExternalOwner = async (scope) => {
  if (!scope) return null;
  const byFirebaseUid = await User.findOne({ where: { firebaseUid: scope }, attributes: ['id'] });
  if (byFirebaseUid) return byFirebaseUid;
  return User.findOne({ where: { sharegramUserId: scope }, attributes: ['id'] });
};
const canAccessPerformer = async (req, performer) => {
  if (req.user?.role === 'user') return sameId(performer.userId, req.user.id);
  // API-key callers must carry an external owner scope; never equate an external
  // account ID with an internal KYC primary key (they are separate ID namespaces).
  if (!req.user?.id || req.sharegramAuth) {
    const scope = req.query?.firebase_uid || req.query?.user_id || req.get?.('x-sharegram-user-id');
    if (!scope) return false;
    if (String(scope) === String(performer.sharegramUserId)) return true;
    const owner = await resolveExternalOwner(scope);
    return sameId(owner?.id, performer.userId);
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
    const { status, sort, expiring, search, external_ids, user_id, firebase_uid } = req.query;
    // firebase_uid is an explicit Firebase-UID alias; user_id supports either
    // Firebase UID or Sharegram account ID (UID lookup takes precedence).
    const ownerId = firebase_uid || user_id;
    const sharedCaller = Boolean(req.sharegramAuth) || !req.user?.id;
    if (sharedCaller && !ownerId) {
      return res.status(400).json({ success: false, message: 'owner scope required: user_id / firebase_uid' });
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

    // Explicit firebase_uid only resolves Firebase UIDs. For user_id, try Firebase UID
    // first and then treat an unknown value as a Sharegram account ID.
    if (firebase_uid) {
      const userByFirebase = await User.findOne({ where: { firebaseUid: firebase_uid }, attributes: ['id'] });
      if (!userByFirebase) return res.json({ success: true, data: [] });
      whereClause.userId = userByFirebase.id;
    } else if (user_id) {
      const owner = await resolveExternalOwner(user_id);
      if (owner) whereClause.userId = owner.id;
      else whereClause.sharegramUserId = user_id;
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
    if (!(await canAccessPerformer(req, performer))) {
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
    const performer = await Performer.sequelize.transaction(async transaction => {
      const row = await Performer.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) review.fail(404, 'PERFORMER_NOT_FOUND');
      if (!(await canAccessPerformer(req, row))) review.fail(403, 'OWNER_REQUIRED');
      if (!review.reviewable(row)) review.fail(409, 'FINAL_REVIEW_RECORD_IMMUTABLE');
      let identityChanged = false;
      for (const field of ['lastName', 'firstName', 'lastNameRoman', 'firstNameRoman']) {
        if (typeof req.body[field] === 'string' && req.body[field].trim()) {
          identityChanged = identityChanged || row[field] !== req.body[field].trim();
          row[field] = req.body[field].trim();
        }
      }
      const documents = { ...review.object(row.documents) };
      if (identityChanged) for (const type of Object.keys(documents)) {
        if (documents[type]) documents[type] = { ...documents[type], verified: false, verifiedAt: null, verifiedBy: null };
      }
      for (const type of ['agreementFile', 'idFront', 'idBack', 'selfie', 'selfieWithId']) {
        const file = req.files?.[type]?.[0];
        if (file) {
          // Do not delete the old file inside a transaction: a rollback cannot
          // restore it. Retention/cleanup of superseded files is a separate job.
          documents[type] = { path: file.path, originalName: file.originalname, mimeType: file.mimetype, verified: false };
        }
      }
      row.documents = documents;
      row.changed('documents', true);
      await row.save({ transaction });
      if (req.user?.id) await AuditLog.create({ userId: req.user.id, action: 'update', resourceType: 'performer', resourceId: row.id,
        details: { updatedFields: Object.keys(req.body), updatedDocuments: Object.keys(req.files || {}) },
        ipAddress: req.ip, userAgent: req.get('user-agent') || '' }, { transaction });
      return row;
    });
    notifySharegram('performer.updated', performer, { updatedDocuments: Object.keys(req.files || {}) });
    return res.json({ success: true, data: { performer } });
  } catch (error) {
    // Multer has already written newly submitted files; remove only those on failure.
    for (const files of Object.values(req.files || {})) for (const file of files) {
      try { fs.unlinkSync(file.path); } catch (_) { /* independent cleanup */ }
    }
    return res.status(error.status || 500).json({ code: error.code || 'UPDATE_FAILED' });
  }
});

// Multer writes files to disk, so reject service/API-key callers before upload unless
// a real KYC user has been authenticated as the performer owner.
const requirePerformerOwner = (req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      code: 'PERFORMER_USER_REQUIRED',
      message: 'An authenticated KYC user is required to create a performer.'
    });
  }
  return next();
};

// @route   POST api/performers
// @desc    Create a performer
// @access  Private
router.post('/', auth, requirePerformerOwner, uploadFields, async (req, res) => {
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
    
    // The authenticated KYC user is the authoritative owner, matching the original
    // flow. A Sharegram account ID is optional metadata; never infer it from email,
    // Firebase UID, or request-body fields. Shared/API-key callers cannot create
    // ownerless performers.
    const ownerId = req.user?.id || null;
    if (!ownerId) {
      return res.status(401).json({
        success: false,
        code: 'PERFORMER_USER_REQUIRED',
        message: 'Unable to resolve the authenticated KYC user; performer was not created.'
      });
    }
    const owner = await User.findByPk(ownerId);
    if (!owner) {
      return res.status(401).json({
        success: false,
        code: 'PERFORMER_USER_REQUIRED',
        message: 'Authenticated KYC user no longer exists; performer was not created.'
      });
    }
    const sharegramOwnerId = req.user?.sharegramUserId || owner.sharegramUserId || null;

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
    if (!(await canAccessPerformer(req, performer))) {
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
    if (!(await canAccessPerformer(req, performer))) {
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
          status: doc.verified ? 'verified' : doc.rejectedAt ? 'rejected' : 'pending',
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
    if (!(await canAccessPerformer(req, performer))) {
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
for (const documentAction of ['verify', 'reject']) {
router.put(`/:id/documents/:type/${documentAction}`, auth, requireReviewer, async (req, res) => {
  try {
    if (documentAction === 'reject' && (typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.trim().length > 2000)) {
      return res.status(400).json({ code: 'REASON_REQUIRED_MAX_2000' });
    }
    const result = await Performer.sequelize.transaction(async (transaction) => {
      const performer = await Performer.findByPk(req.params.id, {
        transaction, lock: transaction.LOCK.UPDATE
      });
      if (!performer) return { status: 404, message: 'Performer not found' };
      if (!review.reviewable(performer) || review.object(performer.kycMetadata).reviewState === 'correction_required') {
        return { status: 409, message: 'Performer is not submitted for review' };
      }
      const docType = normalizeDocumentType(req.params.type);
      const documents = { ...toDocumentsObject(performer.documents) };
      if (!['agreementFile', 'idFront', 'idBack', 'selfie', 'selfieWithId'].includes(docType) || !documents[docType]) {
        return { status: 404, message: 'Document not found' };
      }
      documents[docType] = {
        ...documents[docType], verified: documentAction === 'verify',
        verifiedAt: documentAction === 'verify' ? new Date() : null, verifiedBy: documentAction === 'verify' ? req.user.id : null,
        rejectedAt: documentAction === 'reject' ? new Date() : null, rejectedBy: documentAction === 'reject' ? req.user.id : null,
        rejectionReason: documentAction === 'reject' ? req.body.reason.trim() : null
      };
      performer.documents = documents;
      performer.changed('documents', true);
      await performer.save({ transaction });
      await AuditLog.create({
        userId: req.user.id,
        action: documentAction, resourceType: 'document', resourceId: performer.id,
        details: { documentType: docType, ...(documentAction === 'reject' ? { reason: req.body.reason.trim() } : {}) },
        ipAddress: req.ip, userAgent: req.get('user-agent') || ''
      }, { transaction });
      // Document readiness is neither a final decision nor KYC verification.
      const allVerified = ['agreementFile', 'idFront', 'selfie']
        .every(type => documents[type]?.verified === true);
      return { performer, docType, allVerified };
    });
    if (result.status) return res.status(result.status).json({ message: result.message });
    if (documentAction === 'verify') notifySharegram('document.verified', result.performer, { document: { type: result.docType } });
    return res.json({ message: documentAction === 'verify' ? 'Document verified' : 'Document rejected', verified: documentAction === 'verify', allVerified: result.allVerified });
  } catch (err) {
    console.error('Document verification transaction failed');
    return res.status(500).json({ message: 'Document verification failed' });
  }
});

}

// @route   POST api/performers/sync
// @desc    Sync performers from external system (Enhanced for Sharegram)
// @access  Private (Admin only)
router.post('/sync', auth, (req, res) => res.status(409).json({ code: 'SYNC_REVIEW_CONTRACT_REQUIRED' }));

// @route   POST api/performers/:id/approve
// @desc    Approve a performer registration
// @access  Private (Admin only)
for (const [path, action] of [['approve', 'approve'], ['reject', 'reject'], ['request-correction', 'request_correction']]) {
  router.post(`/:id/${path}`, auth, requireReviewer, async (req, res) => {
    try {
      const result = await review.decide({ models: require('../models'), performerId: req.params.id,
        actor: req.user, action, reason: req.body.reason, reasonCode: req.body.reasonCode,
        ip: req.ip, userAgent: req.get('user-agent') });
      return res.json({ message: 'Decision recorded', ...result });
    } catch (error) {
      return res.status(error.status || 500).json({ code: error.code || 'DECISION_FAILED' });
    }
  });
}

router.post('/:id/resubmit', auth, async (req, res) => {
  try {
    const result = await Performer.sequelize.transaction(async transaction => {
      const performer = await Performer.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!performer) review.fail(404, 'PERFORMER_NOT_FOUND');
      if (req.sharegramAuth || !req.user?.id || !(await canAccessPerformer(req, performer))) review.fail(403, 'OWNER_REQUIRED');
      const metadata = review.object(performer.kycMetadata);
      if (!review.reviewable(performer) || metadata.reviewState !== 'correction_required') review.fail(409, 'INVALID_RESUBMISSION');
      if (!review.REQUIRED_DOCUMENTS.every(type => review.object(performer.documents)[type])) review.fail(409, 'REQUIRED_DOCUMENTS_MISSING');
      performer.kycMetadata = { ...metadata, reviewState: 'submitted', resubmittedAt: new Date().toISOString() };
      performer.kycStatus = 'in_progress';
      await performer.save({ transaction });
      await AuditLog.create({ userId: req.user.id, action: 'resubmit', resourceType: 'performer', resourceId: performer.id,
        details: { previousDecisionId: metadata.lastDecisionId }, ipAddress: req.ip, userAgent: req.get('user-agent') || '' }, { transaction });
      return performer;
    });
    return res.json({ performer: result });
  } catch (error) { return res.status(error.status || 500).json({ code: error.code || 'RESUBMISSION_FAILED' }); }
});

// Review history / delivery status contain internal review data: local admins only.
router.get('/:id/review-history', auth, requireReviewer, async (req, res) => {
  const { PerformerDecision, DecisionOutbox } = require('../models');
  await AuditLog.create({ userId: req.user.id, action: 'read_review_history', resourceType: 'performer',
    resourceId: req.params.id, details: {}, ipAddress: req.ip, userAgent: req.get('user-agent') || '' });
  const decisions = await PerformerDecision.findAll({ where: { performerId: req.params.id }, order: [['createdAt', 'DESC']], limit: 100 });
  const notifications = await DecisionOutbox.findAll({ where: { performerId: req.params.id },
    attributes: ['id', 'eventType', 'status', 'attempts', 'nextAttemptAt', 'lastError', 'sentAt'], order: [['createdAt', 'DESC']], limit: 100 });
  return res.json({ decisions, notifications });
});

// @route   POST api/performers/registration-complete
// @desc    Mark performer registration as complete
// @access  Private
router.post('/registration-complete', auth, async (req, res) => {
  try {
    const performer = await Performer.sequelize.transaction(async transaction => {
      const row = await Performer.findByPk(req.body.performerId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) review.fail(404, 'PERFORMER_NOT_FOUND');
      if (req.sharegramAuth || !req.user?.id || !(await canAccessPerformer(req, row))) review.fail(403, 'OWNER_REQUIRED');
      if (!review.reviewable(row) || review.object(row.kycMetadata).reviewState === 'correction_required') review.fail(409, 'INVALID_SUBMISSION');
      if (!review.REQUIRED_DOCUMENTS.every(type => review.object(row.documents)[type])) review.fail(409, 'REQUIRED_DOCUMENTS_MISSING');
      row.kycStatus = 'in_progress';
      row.kycMetadata = { ...review.object(row.kycMetadata), reviewState: 'submitted', registrationCompletedAt: new Date().toISOString() };
      await row.save({ transaction });
      await AuditLog.create({ userId: req.user.id, action: 'complete_registration', resourceType: 'performer', resourceId: row.id,
        details: {}, ipAddress: req.ip, userAgent: req.get('user-agent') || '' }, { transaction });
      return row;
    });
    return res.json({ performer });
  } catch (error) { return res.status(error.status || 500).json({ code: error.code || 'SUBMISSION_FAILED' }); }
});

// @route   POST api/performers/kyc-approved
// @desc    Handle KYC approval webhook
// @access  Public (with signature verification)
router.post('/kyc-approved', (req, res) => res.status(409).json({ code: 'EXTERNAL_KYC_REVIEW_CONTRACT_REQUIRED' }));

// @route   DELETE api/performers/:id
// @desc    Delete a performer
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const performer = await Performer.sequelize.transaction(async transaction => {
      const row = await Performer.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) review.fail(404, 'PERFORMER_NOT_FOUND');
      if (!(await canAccessPerformer(req, row))) review.fail(403, 'OWNER_REQUIRED');
      if (!review.reviewable(row)) review.fail(409, 'FINAL_REVIEW_RECORD_IMMUTABLE');
      if (req.user?.id) await AuditLog.create({ userId: req.user.id, action: 'delete', resourceType: 'performer', resourceId: row.id,
        details: {}, ipAddress: req.ip, userAgent: req.get('user-agent') || '' }, { transaction });
      await Performer.destroy({ where: { id: row.id }, transaction });
      return row;
    });
    // No file deletion in the transaction. Retained documents require an
    // explicit retention/erasure policy rather than losing evidence on rollback.
    notifySharegram('performer.deleted', performer);
    return res.json({ message: 'Performer deleted' });
  } catch (error) { return res.status(error.status || 500).json({ code: error.code || 'DELETE_FAILED' }); }
});

module.exports = router;