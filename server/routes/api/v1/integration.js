// KYC×Sharegram 統合テスト用APIエンドポイント
const express = require('express');
const router = express.Router();

// ミドルウェア：APIキー認証
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const apiKey = authHeader?.replace('Bearer ', '');
  
  if (!apiKey || apiKey !== process.env.TEST_MODE_API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }
  
  next();
};

// Health Check (認証不要)
router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    }
  });
});

// Integration Status (認証必要)
router.get('/status', authenticate, (req, res) => {
  res.json({
    success: true,
    data: {
      integration: 'sharegram',
      status: 'active',
      apiKeyValid: true,
      webhookConfigured: !!process.env.SHAREGRAM_WEBHOOK_SECRET,
      baseUrl: process.env.SHAREGRAM_API_URL,
      timestamp: new Date().toISOString()
    }
  });
});

// Performer Sync
router.post('/performers/sync', authenticate, (req, res) => {
  const { performer } = req.body;
  
  if (!performer || !performer.external_id) {
    return res.status(400).json({
      success: false,
      error: 'Missing performer data'
    });
  }
  
  res.json({
    success: true,
    data: {
      id: performer.external_id,
      status: 'synced',
      lastName: performer.lastName,
      firstName: performer.firstName,
      email: performer.email,
      syncedAt: new Date().toISOString()
    }
  });
});

// Documents Metadata
router.get('/performers/:id/documents/metadata', authenticate, (req, res) => {
  const performerId = req.params.id;
  
  // モックデータ
  const mockDocuments = [
    {
      id: 'doc1',
      type: 'identity_front',
      status: 'approved',
      uploadedAt: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 'doc2', 
      type: 'identity_back',
      status: 'approved',
      uploadedAt: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 'doc3',
      type: 'selfie',
      status: 'pending',
      uploadedAt: new Date().toISOString()
    }
  ];
  
  res.json({
    success: true,
    data: {
      performerId,
      documents: mockDocuments,
      verificationStatus: 'in_progress',
      lastUpdated: new Date().toISOString()
    }
  });
});

module.exports = router;