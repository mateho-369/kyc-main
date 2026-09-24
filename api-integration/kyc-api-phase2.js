#!/usr/bin/env node
/**
 * Sharegram統合API Phase 2実装
 * Phase 1の機能に加えて、検証ステータス連携、KYC承認処理、Webhook機能を追加
 */

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const crypto = require('crypto');
const admin = require('firebase-admin');
const axios = require('axios');
const sharegramConfig = require('./sharegram-config');

const app = express();
const PORT = process.env.PORT || 5001;

// データファイルのパス
const performersFile = "/root/performers.json";
const uploadsDir = "/root/uploads";
const webhookLogFile = "/root/webhook-log.json";

// バージョン情報
const API_VERSION = {
  LEGACY: 'legacy',
  V1: 'v1'
};

// Firebase Admin SDK初期化（本番環境用）
let firebaseInitialized = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseInitialized = true;
    console.log('Firebase Admin SDK initialized');
  }
} catch (error) {
  console.error('Firebase Admin SDK initialization failed:', error);
}

// ミドルウェア設定
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Client', 'X-API-Version', 'X-Admin-Session', 'X-Webhook-Signature']
}));

app.use(express.json());
app.use(express.raw({ type: 'application/json', limit: '10mb' })); // Webhook署名検証用

// マルチパート設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsDir, req.body.performerId || 'temp');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${Date.now()}${ext}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ========================================
// ヘルパー関数（Phase 1から継承）
// ========================================

// Performersデータの読み込み
function loadPerformers() {
  try {
    if (fs.existsSync(performersFile)) {
      const data = fs.readFileSync(performersFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading performers:", error);
  }
  return [];
}

// Performersデータの保存
function savePerformers(performers) {
  try {
    fs.writeFileSync(performersFile, JSON.stringify(performers, null, 2));
    return true;
  } catch (error) {
    console.error("Error saving performers:", error);
    return false;
  }
}

// Webhookログの保存
function logWebhook(type, data, response, error = null) {
  try {
    const logs = fs.existsSync(webhookLogFile) ? 
      JSON.parse(fs.readFileSync(webhookLogFile, 'utf8')) : [];
    
    logs.push({
      timestamp: new Date().toISOString(),
      type,
      data,
      response,
      error: error ? error.message : null
    });
    
    // 最新100件のみ保持
    if (logs.length > 100) {
      logs.splice(0, logs.length - 100);
    }
    
    fs.writeFileSync(webhookLogFile, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error('Failed to log webhook:', err);
  }
}

// レスポンスフォーマット
function formatResponse(data, success = true, version = API_VERSION.LEGACY) {
  if (version === API_VERSION.V1) {
    // v1形式（統合API仕様準拠）
    return {
      success,
      data: success ? data : null,
      error: success ? null : data
    };
  }
  // レガシー形式（既存形式）
  if (success) {
    return { success, ...data };
  }
  return { success, error: data };
}

// APIバージョン取得
function getApiVersion(req) {
  return req.headers['x-api-version'] || 
         req.query.api_version || 
         (req.path.startsWith('/api/v1/') ? API_VERSION.V1 : API_VERSION.LEGACY);
}

// システムAPI認証
function validateSystemApiKey(apiKey) {
  const validApiKeys = process.env.SYSTEM_API_KEYS ? 
    process.env.SYSTEM_API_KEYS.split(',') : 
    ['sharegram-kyc-system-key-2025', ...sharegramConfig.SYSTEM_API.INCOMING_KEYS];
  return validApiKeys.includes(apiKey);
}

// 認証ミドルウェア（拡張版）
async function authenticateRequest(req, res, next) {
  const version = getApiVersion(req);
  
  // システムAPI認証（v1のみ）
  if (version === API_VERSION.V1 && req.headers['x-api-client']) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(formatResponse({
        code: 'AUTH_MISSING_TOKEN',
        message: 'Authorization header required'
      }, false, version));
    }
    
    const apiKey = authHeader.substring(7);
    if (!validateSystemApiKey(apiKey)) {
      return res.status(401).json(formatResponse({
        code: 'AUTH_INVALID_TOKEN',
        message: 'Invalid API key'
      }, false, version));
    }
    
    req.authType = 'system';
    return next();
  }
  
  // Firebase認証（既存とv1両方）
  if (firebaseInitialized && req.headers.authorization) {
    try {
      const token = req.headers.authorization.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.user = decodedToken;
      req.authType = 'firebase';
      return next();
    } catch (error) {
      return res.status(401).json(formatResponse({
        code: 'FIREBASE_AUTH_ERROR',
        message: 'Invalid Firebase token'
      }, false, version));
    }
  }
  
  // 認証なし（レガシーAPIは許可）
  if (version === API_VERSION.LEGACY) {
    return next();
  }
  
  // v1は認証必須
  return res.status(401).json(formatResponse({
    code: 'AUTH_REQUIRED',
    message: 'Authentication required'
  }, false, version));
}

// Webhook署名検証
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  if (!signature) {
    return res.status(401).json({
      success: false,
      error: { code: 'MISSING_SIGNATURE', message: 'Webhook signature required' }
    });
  }
  
  const payload = req.rawBody || JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', sharegramConfig.WEBHOOK.SECRET)
    .update(payload)
    .digest('hex');
  
  if (signature !== expectedSignature) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' }
    });
  }
  
  next();
}

// ========================================
// Phase 2: Webhook送信機能
// ========================================

async function sendWebhookToSharegram(endpoint, data, retryCount = 0) {
  const url = `${sharegramConfig.SHAREGRAM_API.BASE_URL}${endpoint}`;
  const payload = JSON.stringify(data);
  
  // 署名生成
  const signature = crypto
    .createHmac('sha256', sharegramConfig.WEBHOOK.SECRET)
    .update(payload)
    .digest('hex');
  
  try {
    const response = await axios({
      method: 'POST',
      url,
      data: payload,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sharegramConfig.SYSTEM_API.OUTGOING_KEY}`,
        'X-Webhook-Signature': signature,
        ...sharegramConfig.WEBHOOK.HEADERS
      },
      timeout: sharegramConfig.SHAREGRAM_API.TIMEOUT
    });
    
    logWebhook(endpoint, data, response.data);
    return response.data;
    
  } catch (error) {
    console.error(`Webhook failed to ${endpoint}:`, error.message);
    
    // リトライロジック
    if (retryCount < sharegramConfig.SHAREGRAM_API.RETRY.MAX_ATTEMPTS) {
      const delay = sharegramConfig.SHAREGRAM_API.RETRY.DELAY * 
        Math.pow(sharegramConfig.SHAREGRAM_API.RETRY.BACKOFF_MULTIPLIER, retryCount);
      
      console.log(`Retrying webhook in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return sendWebhookToSharegram(endpoint, data, retryCount + 1);
    }
    
    logWebhook(endpoint, data, null, error);
    throw error;
  }
}

// ========================================
// 既存のAPIエンドポイント（Phase 1から継承）
// ========================================

// [Phase 1のエンドポイントは省略 - 前回と同じ]

// ========================================
// Phase 2: 新規APIエンドポイント
// ========================================

// 検証ステータス更新
app.put("/api/v1/performers/:performer_id/documents/:document_type/verify", authenticateRequest, async (req, res) => {
  const version = API_VERSION.V1;
  const { performer_id, document_type } = req.params;
  const { verified, verified_by, notes } = req.body;
  
  // 管理者権限チェック
  if (req.authType !== 'firebase' || req.user.role !== 'admin') {
    return res.status(403).json(formatResponse({
      code: 'AUTH_INSUFFICIENT_PRIVILEGES',
      message: 'Admin privileges required'
    }, false, version));
  }
  
  try {
    const performers = loadPerformers();
    const performerIndex = performers.findIndex(p => p.id === performer_id);
    
    if (performerIndex === -1) {
      return res.status(404).json(formatResponse({
        code: 'PERFORMER_NOT_FOUND',
        message: 'Performer not found'
      }, false, version));
    }
    
    const performer = performers[performerIndex];
    
    if (!performer.documents || !performer.documents[document_type]) {
      return res.status(404).json(formatResponse({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document not found'
      }, false, version));
    }
    
    // 検証ステータス更新
    performer.documents[document_type].verified = verified;
    performer.documents[document_type].verified_at = verified ? new Date().toISOString() : null;
    performer.documents[document_type].verified_by = verified ? verified_by : null;
    performer.documents[document_type].verification_notes = notes || null;
    
    // 全書類が検証済みかチェック
    const allVerified = Object.values(performer.documents).every(doc => doc.verified === true);
    
    performers[performerIndex] = performer;
    savePerformers(performers);
    
    res.json(formatResponse({
      document: {
        type: document_type,
        verified: performer.documents[document_type].verified,
        verified_at: performer.documents[document_type].verified_at,
        verified_by: performer.documents[document_type].verified_by
      },
      all_verified: allVerified
    }, true, version));
    
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json(formatResponse({
      code: 'SERVER_ERROR',
      message: error.message
    }, false, version));
  }
});

// コンテンツ承認通知Webhook受信
app.post("/api/v1/webhooks/content-approved", verifyWebhookSignature, async (req, res) => {
  const version = API_VERSION.V1;
  
  try {
    const { content_id, content_title, performer_ids, approved_at, approved_by } = req.body;
    
    if (!performer_ids || !Array.isArray(performer_ids)) {
      return res.status(400).json(formatResponse({
        code: 'VALIDATION_ERROR',
        message: 'performer_ids array is required'
      }, false, version));
    }
    
    const performers = loadPerformers();
    const updatedPerformers = [];
    
    // 各出演者の書類を自動検証
    for (const external_id of performer_ids) {
      const performerIndex = performers.findIndex(p => p.external_id === external_id);
      
      if (performerIndex !== -1) {
        const performer = performers[performerIndex];
        
        // 全書類を検証済みに更新
        if (performer.documents) {
          Object.keys(performer.documents).forEach(docType => {
            performer.documents[docType].verified = true;
            performer.documents[docType].verified_at = approved_at;
            performer.documents[docType].verified_by = approved_by;
            performer.documents[docType].verification_notes = `コンテンツ承認により自動検証: ${content_title} (${content_id})`;
          });
        }
        
        performer.status = 'active';
        performer.approved_at = approved_at;
        performer.approved_by = approved_by;
        
        performers[performerIndex] = performer;
        
        updatedPerformers.push({
          external_id: performer.external_id,
          status: performer.status,
          documents: Object.entries(performer.documents || {}).map(([type, doc]) => ({
            type,
            verified: doc.verified
          }))
        });
      }
    }
    
    savePerformers(performers);
    
    res.json(formatResponse({
      updated_performers: updatedPerformers
    }, true, version));
    
  } catch (error) {
    console.error('Content approved webhook error:', error);
    res.status(500).json(formatResponse({
      code: 'SERVER_ERROR',
      message: error.message
    }, false, version));
  }
});

// KYC承認処理
app.post("/api/v1/performers/:performer_id/approve", authenticateRequest, async (req, res) => {
  const version = API_VERSION.V1;
  const { performer_id } = req.params;
  const { admin_user_id, admin_session_id, approval_action, approval_level, notes, notify_sharegram } = req.body;
  
  // システムAPI認証 + 管理者セッション確認
  if (req.authType !== 'system' || !req.headers['x-admin-session']) {
    return res.status(403).json(formatResponse({
      code: 'AUTH_INSUFFICIENT_PRIVILEGES',
      message: 'System API and admin session required'
    }, false, version));
  }
  
  try {
    const performers = loadPerformers();
    const performerIndex = performers.findIndex(p => p.id === performer_id);
    
    if (performerIndex === -1) {
      return res.status(404).json(formatResponse({
        code: 'PERFORMER_NOT_FOUND',
        message: 'Performer not found'
      }, false, version));
    }
    
    const performer = performers[performerIndex];
    
    // 承認処理
    if (approval_action === 'approve') {
      performer.status = 'approved';
      performer.approved_at = new Date().toISOString();
      performer.approved_by = admin_user_id;
      performer.approval_level = approval_level;
      performer.approval_notes = notes;
      
      performers[performerIndex] = performer;
      savePerformers(performers);
      
      // Sharegramへの通知
      let notificationResult = null;
      if (notify_sharegram && performer.external_id) {
        try {
          notificationResult = await sendWebhookToSharegram(
            sharegramConfig.SHAREGRAM_API.ENDPOINTS.KYC_APPROVED,
            {
              performer_id: performer.id,
              external_id: performer.external_id,
              status: 'approved',
              approval_action,
              approval_level,
              approved_at: performer.approved_at,
              approved_by: performer.approved_by,
              admin_session_id,
              notes
            }
          );
        } catch (webhookError) {
          console.error('Failed to notify Sharegram:', webhookError);
          notificationResult = {
            status: 'failed',
            message: webhookError.message
          };
        }
      }
      
      res.json(formatResponse({
        performer: {
          id: performer.id,
          external_id: performer.external_id,
          status: performer.status,
          approved_at: performer.approved_at,
          approved_by: performer.approved_by
        },
        sharegram_notification: notificationResult || {
          status: 'not_sent',
          message: 'Notification not requested'
        }
      }, true, version));
      
    } else {
      return res.status(400).json(formatResponse({
        code: 'INVALID_ACTION',
        message: 'Only approve action is supported'
      }, false, version));
    }
    
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json(formatResponse({
      code: 'SERVER_ERROR',
      message: error.message
    }, false, version));
  }
});

// 出演者登録完了時の自動通知（内部使用）
async function notifyPerformerRegistrationComplete(performer) {
  if (!performer.external_id) {
    return null;
  }
  
  try {
    const result = await sendWebhookToSharegram(
      sharegramConfig.SHAREGRAM_API.ENDPOINTS.REGISTRATION_COMPLETE,
      {
        performer_id: performer.id,
        external_id: performer.external_id,
        status: 'pending',
        documents: Object.entries(performer.documents || {}).map(([type, doc]) => ({
          type,
          verified: doc.verified || false
        }))
      }
    );
    
    return result;
  } catch (error) {
    console.error('Failed to notify registration complete:', error);
    return null;
  }
}

// 既存の出演者作成エンドポイントを拡張（通知機能追加）
const originalCreatePerformer = app._router.stack.find(r => 
  r.route && r.route.path === '/api/performers' && r.route.methods.post
);

if (originalCreatePerformer) {
  const originalHandler = originalCreatePerformer.route.stack[0].handle;
  originalCreatePerformer.route.stack[0].handle = async (req, res) => {
    // 元の処理を実行
    const originalJson = res.json;
    let createdPerformer = null;
    
    res.json = function(data) {
      if (data.success && data.data) {
        createdPerformer = data.data;
      }
      return originalJson.call(this, data);
    };
    
    await originalHandler(req, res);
    
    // 登録完了通知
    if (createdPerformer) {
      notifyPerformerRegistrationComplete(createdPerformer);
    }
  };
}

// Webhookログ確認（デバッグ用）
app.get("/api/v1/webhooks/logs", authenticateRequest, (req, res) => {
  const version = API_VERSION.V1;
  
  if (req.authType !== 'system') {
    return res.status(403).json(formatResponse({
      code: 'AUTH_INSUFFICIENT_PRIVILEGES',
      message: 'System API authentication required'
    }, false, version));
  }
  
  try {
    const logs = fs.existsSync(webhookLogFile) ? 
      JSON.parse(fs.readFileSync(webhookLogFile, 'utf8')) : [];
    
    res.json(formatResponse({ logs }, true, version));
  } catch (error) {
    res.status(500).json(formatResponse({
      code: 'SERVER_ERROR',
      message: error.message
    }, false, version));
  }
});

// ========================================
// サーバー起動
// ========================================

app.listen(PORT, () => {
  console.log(`Integrated KYC API Server (Phase 2) running on port ${PORT}`);
  console.log(`Features enabled:`);
  console.log(`- Legacy API: /api/*`);
  console.log(`- Integrated API v1: /api/v1/*`);
  console.log(`- Firebase: ${firebaseInitialized ? 'Enabled' : 'Disabled'}`);
  console.log(`- Webhooks: Enabled`);
  console.log(`- Sharegram API: ${sharegramConfig.SHAREGRAM_API.BASE_URL}`);
});