const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { Performer, AuditLog } = require('../models');
const { Op } = require('sequelize');

// 監査ログ記録のヘルパー関数
const logAudit = async (userId, action, resourceType, resourceId, details, req) => {
  try {
    if (!AuditLog) {
      console.warn('AuditLog モデルが見つかりません');
      return;
    }
    
    await AuditLog.create({
      userId,
      action,
      resourceType,
      resourceId,
      details,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });
  } catch (err) {
    // エラーをログに記録するが、メイン処理は続行させる
    console.error('監査ログ記録エラー:', err.message, err.stack);
  }
};

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // プロジェクトルートからの絶対パスを使用
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'performers');
    
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
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
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
// @desc    Get performers (filtered by user for non-admins)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    // クエリパラメータの取得
    const { status, sort, expiring, search } = req.query;
    
    // 検索条件の構築
    const whereClause = {};
    
    // 一般ユーザーは自分のデータのみアクセス可能
    if (req.user.role !== 'admin') {
      whereClause.userId = req.user.id;
    }
    
    // ステータスによるフィルタリング
    if (status) {
      whereClause.status = status;
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
    
    const performers = await Performer.findAll({
      where: whereClause,
      order,
      attributes: { 
        exclude: ['documents'] // documents JSONは除外（一覧表示では不要）
      }
    });
    
    // 監査ログ記録
    await logAudit(
      req.user.id,
      'read',
      'performer',
      0, // 全体リスト
      { query: req.query },
      req
    );
    
    res.json(performers);
  } catch (err) {
    console.error('出演者一覧取得エラー:', err.message, err.stack);
    res.status(500).json({ 
      message: '出演者情報の取得に失敗しました。', 
      error: err.message 
    });
  }
});

// @route   GET api/performers/all
// @desc    Get ALL performers regardless of ownership (admin only)
// @access  Admin
router.get('/all', auth, checkRole(['admin']), async (req, res) => {
  try {
    // クエリパラメータの取得
    const { status, sort, expiring, search } = req.query;
    
    // 検索条件の構築 (ユーザーIDの制限なし - すべての出演者を取得)
    const whereClause = {};
    
    // ステータスによるフィルタリング
    if (status) {
      whereClause.status = status;
    }
    
    // 期限切れ間近の書類フィルタリング
    if (expiring === 'true') {
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
    let order = [['createdAt', 'DESC']]; 
    
    if (sort === 'updatedAt') {
      order = [['updatedAt', 'DESC']]; 
    } else if (sort === 'name') {
      order = [['lastName', 'ASC'], ['firstName', 'ASC']]; 
    }
    
    const performers = await Performer.findAll({
      where: whereClause,
      order,
      attributes: { 
        exclude: ['documents']
      },
      include: [
        {
          model: User,
          attributes: ['id', 'name', 'email']
        }
      ]
    });
    
    // 監査ログ記録
    await logAudit(
      req.user.id,
      'read',
      'performer',
      0,
      { query: req.query, adminAccess: true },
      req
    );
    
    res.json(performers);
  } catch (err) {
    console.error('全出演者一覧取得エラー (管理者):', err.message, err.stack);
    res.status(500).json({ 
      message: '出演者情報の取得に失敗しました。', 
      error: err.message 
    });
  }
});

// @route   GET api/performers/:id
// @desc    Get performer by ID
// @access  Private (owner or admin)
router.get('/:id', auth, async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ message: '出演者情報が見つかりません。正しいIDで再度お試しください。' });
    }
    
    // 権限チェック: 管理者または所有者のみアクセス可能
    if (req.user.role !== 'admin' && performer.userId !== req.user.id) {
      return res.status(403).json({ message: 'この出演者情報へのアクセス権限がありません。' });
    }
    
    // 監査ログ記録
    await logAudit(
      req.user.id,
      'read',
      'performer',
      performer.id,
      {},
      req
    );
    
    res.json(performer);
  } catch (err) {
    console.error('出演者詳細取得エラー:', err.message, err.stack);
    res.status(500).json({ 
      message: '出演者情報の取得に失敗しました。', 
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
    
    // 出演者データの作成
    const performer = await Performer.create({
      userId: req.user.id, // 作成者のユーザーID
      lastName,
      firstName,
      lastNameRoman,
      firstNameRoman,
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
    
    // 監査ログ記録
    await logAudit(
      req.user.id,
      'create',
      'performer',
      performer.id,
      {
        lastName,
        firstName,
        lastNameRoman,
        firstNameRoman,
        documents: Object.keys(req.files).map(key => key)
      },
      req
    );
    
    res.json(performer);
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

// @route   PUT api/performers/:id
// @desc    Update performer information
// @access  Private (owner or admin)
router.put('/:id', auth, async (req, res) => {
  try {
    const { lastName, firstName, lastNameRoman, firstNameRoman, status, notes } = req.body;
    
    // 出演者情報の取得
    let performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ message: '出演者情報が見つかりません。正しいIDで再度お試しください。' });
    }
    
    // 権限チェック: 管理者または所有者のみ更新可能
    if (req.user.role !== 'admin' && performer.userId !== req.user.id) {
      return res.status(403).json({ message: 'この出演者情報の更新権限がありません。' });
    }
    
    // 更新フィールドの構築
    const updateFields = {};
    if (lastName) updateFields.lastName = lastName;
    if (firstName) updateFields.firstName = firstName;
    if (lastNameRoman) updateFields.lastNameRoman = lastNameRoman;
    if (firstNameRoman) updateFields.firstNameRoman = firstNameRoman;
    
    // ステータス更新は管理者のみ可能
    if (status && req.user.role === 'admin') {
      updateFields.status = status;
    }
    
    if (notes !== undefined) updateFields.notes = notes;
    
    // 出演者情報を更新
    await Performer.update(updateFields, {
      where: { id: req.params.id }
    });
    
    // 更新後の出演者情報を取得
    performer = await Performer.findByPk(req.params.id);
    
    // 監査ログ記録
    await logAudit(
      req.user.id,
      'update',
      'performer',
      performer.id,
      updateFields,
      req
    );
    
    res.json(performer);
  } catch (err) {
    console.error('出演者更新エラー:', err.message, err.stack);
    res.status(500).json({ 
      message: '出演者情報の更新に失敗しました。', 
      error: err.message 
    });
  }
});

// @route   GET api/performers/:id/documents
// @desc    Get documents for a performer
// @access  Private (owner or admin)
router.get('/:id/documents', auth, async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ message: '出演者情報が見つかりません。正しいIDで再度お試しください。' });
    }
    
    // 権限チェック: 管理者または所有者のみアクセス可能
    if (req.user.role !== 'admin' && performer.userId !== req.user.id) {
      return res.status(403).json({ message: 'この出演者の書類へのアクセス権限がありません。' });
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
    
    // 監査ログ記録
    await logAudit(
      req.user.id,
      'read',
      'document',
      performer.id,
      { documentCount: documents.length },
      req
    );
    
    res.json(documents);
  } catch (err) {
    console.error('書類取得エラー:', err.message, err.stack);
    res.status(500).json({ 
      message: '書類情報の取得に失敗しました。', 
      error: err.message 
    });
  }
});

// @route   GET api/performers/:id/documents/:type
// @desc    View or download a document
// @access  Private (owner or admin)
router.get('/:id/documents/:type', auth, async (req, res) => {
  try {
    console.log('Document request:', req.params.id, req.params.type);
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      console.log('Performer not found');
      return res.status(404).json({ message: '出演者情報が見つかりません。正しいIDで再度お試しください。' });
    }
    
    // 権限チェック: 管理者または所有者のみアクセス可能
    if (req.user.role !== 'admin' && performer.userId !== req.user.id) {
      return res.status(403).json({ message: 'この出演者の書類をダウンロードする権限がありません。' });
    }
    
    const docType = req.params.type;
    const docData = performer.documents ? performer.documents[docType] : null;
    console.log('Document data:', JSON.stringify(docData));
    
    if (!docData) {
      console.log('Document not found');
      return res.status(404).json({ message: '指定された書類が見つかりません。正しい書類タイプを指定してください。' });
    }
    
    // ファイルが存在するか確認
    console.log('Checking file path:', docData.path);
    if (!fs.existsSync(docData.path)) {
      console.log('File not found at path:', docData.path);
      return res.status(404).json({ message: 'ファイルが見つかりません。システム管理者にお問い合わせください。' });
    }
    
    // ダウンロード用の名前を作成
    const downloadName = `${docType}_${performer.lastName}_${performer.firstName}${path.extname(docData.originalName)}`;
    console.log('Download name:', downloadName);
    
    // MIMEタイプの確認と修正
    let mimeType = docData.mimeType || 'application/octet-stream';
    // PDFの場合は明示的にMIMEタイプを設定
    if (path.extname(docData.path).toLowerCase() === '.pdf') {
      mimeType = 'application/pdf';
    } else if (path.extname(docData.path).toLowerCase() === '.png') {
      mimeType = 'image/png';
    } else if (path.extname(docData.path).toLowerCase() === '.jpg' || path.extname(docData.path).toLowerCase() === '.jpeg') {
      mimeType = 'image/jpeg';
    }
    console.log('MIME type:', mimeType);
    
    // 表示モードを設定（クエリパラメータでダウンロードを指定可能）
    const isDownload = req.query.download === 'true';
    const disposition = isDownload ? 'attachment' : 'inline';
    
    // 監査ログ記録（非同期で行い、レスポンスを遅らせない）
    logAudit(
      req.user.id,
      isDownload ? 'download' : 'view',
      'document',
      performer.id,
      { documentType: docType },
      req
    ).catch(err => {
      console.error('Audit log error:', err);
    });
    
    // ファイルを直接提供
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(downloadName)}"`);
    
    // ファイルを直接読み込んで送信
    fs.readFile(docData.path, (err, data) => {
      if (err) {
        console.error('File read error:', err);
        return res.status(500).json({ message: 'ファイル読み込みエラー' });
      }
      res.send(data);
    });
  } catch (err) {
    console.error('Document view/download error:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'サーバーエラーが発生しました' });
    }
  }
});

// @route   PUT api/performers/:id/documents/:type/verify
// @desc    Verify a document
// @access  Admin only
router.put('/:id/documents/:type/verify', auth, checkRole(['admin']), async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ message: '出演者情報が見つかりません。正しいIDで再度お試しください。' });
    }
    
    const docType = req.params.type;
    const documents = { ...(performer.documents || {}) };
    
    if (!documents[docType]) {
      return res.status(404).json({ message: '指定された書類が見つかりません。正しい書類タイプを指定してください。' });
    }
    
    // 書類の検証ステータスを更新
    documents[docType].verified = true;
    documents[docType].verifiedAt = new Date();
    documents[docType].verifiedBy = req.user.id;
    
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
    
    // 監査ログ記録
    await logAudit(
      req.user.id,
      'verify',
      'document',
      performer.id,
      { documentType: docType },
      req
    );
    
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

// @route   DELETE api/performers/:id
// @desc    Delete a performer
// @access  Private (owner or admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    const performer = await Performer.findByPk(req.params.id);
    
    if (!performer) {
      return res.status(404).json({ message: '出演者情報が見つかりません。正しいIDで再度お試しください。' });
    }
    
    // 権限チェック: 管理者または所有者のみ削除可能
    if (req.user.role !== 'admin' && performer.userId !== req.user.id) {
      return res.status(403).json({ message: 'この出演者情報を削除する権限がありません。' });
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
    
    // 監査ログ記録（出演者削除前に記録）
    await logAudit(
      req.user.id,
      'delete',
      'performer',
      performer.id,
      {
        lastName: performer.lastName,
        firstName: performer.firstName
      },
      req
    );
    
    // 出演者データを削除
    await Performer.destroy({
      where: { id: req.params.id }
    });
    
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