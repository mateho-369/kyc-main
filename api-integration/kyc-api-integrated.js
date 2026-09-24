#!/usr/bin/env node
/**
 * Sharegram統合API実装
 * 既存のkyc-api-complete.jsを拡張し、新機能を追加
 * 既存のエンドポイントは変更せず、新規エンドポイントのみ追加
 */

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const crypto = require('crypto');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 5001;

// データファイルのパス
const performersFile = "/root/performers.json";
const uploadsDir = "/root/uploads";

// バージョン情報
const API_VERSION = {
  LEGACY: 'legacy',
  V1: 'v1'
};

// Firebase Admin SDK初期化（本番環境用）
let firebaseInitialized = false;
try {
  // 環境変数から個別のFirebase認証情報を使用
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    };
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    firebaseInitialized = true;
    console.log('Firebase Admin SDK initialized with individual env vars');
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    // 後方互換性のため、完全なJSON形式もサポート
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseInitialized = true;
    console.log('Firebase Admin SDK initialized with service account key');
  }
} catch (error) {
  console.error('Firebase Admin SDK initialization failed:', error);
}

// ミドルウェア設定
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Client', 'X-API-Version']
}));

app.use(express.json());

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
// ヘルパー関数
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
    ['sharegram-kyc-system-key-2025']; // デフォルトキー（本番では環境変数必須）
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

// ========================================
// 既存のAPIエンドポイント（変更なし）
// ========================================

// ヘルスチェック
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "legacy" });
});

// 既存の認証エンドポイント
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (email === "admin@example.com" && password === "admin123") {
    res.json({ 
      success: true, 
      user: { 
        id: "admin", 
        email: "admin@example.com", 
        role: "admin",
        idToken: "dummy-token-" + Date.now()
      }
    });
  } else {
    res.status(401).json({ success: false, error: "Invalid credentials" });
  }
});

app.post("/api/auth/session/init", (req, res) => {
  res.json({ 
    success: true, 
    csrfToken: "dummy-csrf-token",
    sessionId: "session-" + Date.now()
  });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ 
    id: "admin", 
    email: "admin@example.com", 
    role: "admin",
    name: "管理者"
  });
});

app.get("/api/auth/user/role", (req, res) => {
  res.json({ role: "admin" });
});

// 既存の出演者関連エンドポイント
app.post("/api/performers", 
  upload.fields([
    { name: 'agreementFile', maxCount: 1 },
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
    { name: 'selfieWithId', maxCount: 1 }
  ]),
  (req, res) => {
    try {
      const performers = loadPerformers();
      const performerId = 'perf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      
      const performer = {
        id: performerId,
        ...req.body,
        documents: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      if (req.files) {
        const performerDir = path.join(uploadsDir, performerId);
        if (!fs.existsSync(performerDir)) {
          fs.mkdirSync(performerDir, { recursive: true });
        }
        
        Object.keys(req.files).forEach(fieldName => {
          const file = req.files[fieldName][0];
          const newPath = path.join(performerDir, file.filename);
          fs.renameSync(file.path, newPath);
          
          performer.documents[fieldName] = {
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            uploadedAt: new Date().toISOString()
          };
        });
      }
      
      performers.push(performer);
      savePerformers(performers);
      
      res.json({ success: true, data: performer });
    } catch (error) {
      console.error('Error creating performer:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.get("/api/performers", (req, res) => {
  try {
    const performers = loadPerformers();
    res.json(performers);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/performers/:id", (req, res) => {
  try {
    const performers = loadPerformers();
    const performer = performers.find(p => p.id === req.params.id);
    
    if (!performer) {
      return res.status(404).json({ success: false, error: "Performer not found" });
    }
    
    res.json({ success: true, data: performer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/performers/:id/documents", (req, res) => {
  try {
    const performers = loadPerformers();
    const performer = performers.find(p => p.id === req.params.id);
    
    if (!performer) {
      return res.status(404).json({ success: false, error: "Performer not found" });
    }
    
    res.json({ success: true, data: performer.documents || {} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/performers/:id/documents/:type", (req, res) => {
  try {
    const performers = loadPerformers();
    const performer = performers.find(p => p.id === req.params.id);
    
    if (!performer || !performer.documents || !performer.documents[req.params.type]) {
      return res.status(404).json({ success: false, error: "Document not found" });
    }
    
    const doc = performer.documents[req.params.type];
    const filePath = path.join(uploadsDir, req.params.id, doc.filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: "File not found" });
    }
    
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.originalName}"`);
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/dashboard/stats", (req, res) => {
  try {
    const performers = loadPerformers();
    res.json({ 
      success: true,
      totalPerformers: performers.length,
      totalVideos: 0,
      totalRevenue: 0,
      totalUsers: 1
    });
  } catch (error) {
    res.json({ 
      success: true,
      totalPerformers: 0,
      totalVideos: 0,
      totalRevenue: 0,
      totalUsers: 0
    });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.json({ success: true, message: "Logged out successfully" });
});

// ========================================
// 新規統合APIエンドポイント（v1）
// ========================================

// Firebase SSO認証エンドポイント
app.post("/api/v1/auth/firebase-verify", async (req, res) => {
  const version = API_VERSION.V1;
  
  try {
    const { id_token, client_id } = req.body;
    
    if (!id_token) {
      return res.status(400).json(formatResponse({
        code: 'VALIDATION_ERROR',
        message: 'id_token is required'
      }, false, version));
    }
    
    if (!firebaseInitialized) {
      return res.status(500).json(formatResponse({
        code: 'FIREBASE_NOT_INITIALIZED',
        message: 'Firebase is not initialized on this server'
      }, false, version));
    }
    
    // Firebase ID Token検証
    const decodedToken = await admin.auth().verifyIdToken(id_token);
    
    // ユーザー情報取得
    const userRecord = await admin.auth().getUser(decodedToken.uid);
    
    // セッショントークン生成
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    res.json(formatResponse({
      user: {
        firebase_uid: decodedToken.uid,
        name: userRecord.displayName || '',
        email: userRecord.email || '',
        external_id: decodedToken.external_id || null
      },
      session_token: sessionToken
    }, true, version));
    
  } catch (error) {
    console.error('Firebase verify error:', error);
    res.status(401).json(formatResponse({
      code: 'FIREBASE_AUTH_ERROR',
      message: error.message
    }, false, version));
  }
});

// Firebase SSO開始
app.get("/api/v1/auth/firebase-sso", (req, res) => {
  const { id_token, redirect_url } = req.query;
  
  if (!id_token) {
    return res.status(400).send('id_token is required');
  }
  
  // 実際の実装では、ここでトークンを検証してセッションを作成
  // 今回は簡易実装として、リダイレクトのみ
  const redirectTo = redirect_url || '/';
  res.redirect(redirectTo);
});

// 出演者情報同期
app.post("/api/v1/performers/sync", authenticateRequest, (req, res) => {
  const version = API_VERSION.V1;
  
  if (req.authType !== 'system') {
    return res.status(403).json(formatResponse({
      code: 'AUTH_INSUFFICIENT_PRIVILEGES',
      message: 'System API authentication required'
    }, false, version));
  }
  
  try {
    const { performer } = req.body;
    
    if (!performer || !performer.external_id) {
      return res.status(400).json(formatResponse({
        code: 'VALIDATION_ERROR',
        message: 'performer.external_id is required'
      }, false, version));
    }
    
    const performers = loadPerformers();
    
    // external_idで既存チェック
    const existingIndex = performers.findIndex(p => p.external_id === performer.external_id);
    
    const performerData = {
      id: existingIndex >= 0 ? performers[existingIndex].id : 'skyc_performer_' + Date.now(),
      ...performer,
      status: performer.status || 'pending',
      updated_at: new Date().toISOString()
    };
    
    if (existingIndex >= 0) {
      // 更新
      performers[existingIndex] = { ...performers[existingIndex], ...performerData };
    } else {
      // 新規作成
      performerData.created_at = new Date().toISOString();
      performers.push(performerData);
    }
    
    savePerformers(performers);
    
    res.json(formatResponse({
      performer: performerData
    }, true, version));
    
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json(formatResponse({
      code: 'SERVER_ERROR',
      message: error.message
    }, false, version));
  }
});

// 書類メタデータ取得
app.get("/api/v1/performers/:performer_id/documents/metadata", authenticateRequest, (req, res) => {
  const version = API_VERSION.V1;
  const { external_id } = req.query;
  
  try {
    const performers = loadPerformers();
    const performer = external_id === 'true' ? 
      performers.find(p => p.external_id === req.params.performer_id) :
      performers.find(p => p.id === req.params.performer_id);
    
    if (!performer) {
      return res.status(404).json(formatResponse({
        code: 'PERFORMER_NOT_FOUND',
        message: 'Performer not found'
      }, false, version));
    }
    
    const documents = [];
    if (performer.documents) {
      Object.entries(performer.documents).forEach(([type, doc]) => {
        documents.push({
          type,
          name: doc.originalName || type,
          status: doc.verified ? 'verified' : 'pending',
          last_updated: doc.uploadedAt || performer.updated_at
        });
      });
    }
    
    res.json(formatResponse({ documents }, true, version));
    
  } catch (error) {
    res.status(500).json(formatResponse({
      code: 'SERVER_ERROR',
      message: error.message
    }, false, version));
  }
});

// 統合ヘルスチェック
app.get("/api/v1/integration/health", (req, res) => {
  const version = API_VERSION.V1;
  const startTime = Date.now();
  
  const checks = {
    database: fs.existsSync(performersFile) ? 'ok' : 'error',
    storage: fs.existsSync(uploadsDir) ? 'ok' : 'error',
    api: 'ok',
    firebase: firebaseInitialized ? 'ok' : 'not_configured'
  };
  
  const allOk = Object.values(checks).every(status => status === 'ok' || status === 'not_configured');
  
  res.json(formatResponse({
    status: allOk ? 'healthy' : 'degraded',
    response_time: Date.now() - startTime,
    service_checks: checks
  }, true, version));
});

// 統合ステータス
app.get("/api/v1/integration/status", authenticateRequest, (req, res) => {
  const version = API_VERSION.V1;
  
  res.json(formatResponse({
    status: 'active',
    last_sync: new Date().toISOString(),
    api_version: '1.0',
    features: {
      firebase_sso: firebaseInitialized,
      document_sharing: true,
      verification_sync: false, // Phase 2
      webhooks: false // Phase 2
    }
  }, true, version));
});

// ========================================
// サーバー起動
// ========================================

app.listen(PORT, () => {
  console.log(`Integrated KYC API Server running on port ${PORT}`);
  console.log(`Features enabled:`);
  console.log(`- Legacy API: /api/*`);
  console.log(`- Integrated API v1: /api/v1/*`);
  console.log(`- Firebase: ${firebaseInitialized ? 'Enabled' : 'Disabled'}`);
});