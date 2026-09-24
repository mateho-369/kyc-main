const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authHybrid, requireAdmin } = require('../../../middleware/auth-hybrid');
const { sharegramAuth } = require('../../../middleware/sharegram-auth');
const KYCService = require('../../../services/kyc/kycService');
const { KYCRequest, KYCDocument, KYCVerificationStep, Performer } = require('../../../models');
const { body, param, query, validationResult } = require('express-validator');

// Multer設定（メモリストレージ）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and PDF are allowed.'));
    }
  }
});

/**
 * KYCリクエストの作成
 * POST /api/v1/kyc/requests
 */
router.post('/requests',
  authHybrid,
  [
    body('performerId').isInt().withMessage('Valid performer ID is required'),
    body('requestType').optional().isIn(['initial', 'update', 're-verification']),
    body('integrationId').optional().isInt(),
    body('metadata').optional().isObject()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const kycRequest = await KYCService.createKYCRequest(
        req.body.performerId,
        {
          requestType: req.body.requestType,
          integrationId: req.body.integrationId,
          metadata: req.body.metadata
        }
      );
      
      res.status(201).json({
        success: true,
        data: kycRequest
      });
    } catch (error) {
      console.error('KYC request creation error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * KYCドキュメントのアップロード
 * POST /api/v1/kyc/requests/:requestId/documents
 */
router.post('/requests/:requestId/documents',
  authHybrid,
  upload.single('document'),
  [
    param('requestId').isInt(),
    body('documentType').isIn([
      'id_front', 'id_back', 'passport', 'drivers_license',
      'selfie', 'selfie_with_id', 'address_proof',
      'bank_statement', 'utility_bill'
    ])
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }
      
      const fileData = {
        ...req.file,
        uploadIp: req.ip,
        userAgent: req.get('user-agent')
      };
      
      const document = await KYCService.uploadDocument(
        req.params.requestId,
        req.body.documentType,
        fileData
      );
      
      res.status(201).json({
        success: true,
        data: {
          id: document.id,
          documentType: document.documentType,
          fileName: document.fileName,
          verificationStatus: document.verificationStatus
        }
      });
    } catch (error) {
      console.error('Document upload error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * KYCリクエストの提出
 * POST /api/v1/kyc/requests/:requestId/submit
 */
router.post('/requests/:requestId/submit',
  authHybrid,
  [
    param('requestId').isInt()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const kycRequest = await KYCService.submitKYCRequest(req.params.requestId);
      
      res.json({
        success: true,
        data: kycRequest,
        message: 'KYC request submitted successfully'
      });
    } catch (error) {
      console.error('KYC submission error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * KYCリクエストの取得
 * GET /api/v1/kyc/requests/:requestId
 */
router.get('/requests/:requestId',
  authHybrid,
  [
    param('requestId').isInt()
  ],
  async (req, res) => {
    try {
      const kycRequest = await KYCRequest.findByPk(req.params.requestId, {
        include: [
          {
            model: KYCDocument,
            as: 'documents',
            attributes: ['id', 'documentType', 'verificationStatus', 'createdAt']
          },
          {
            model: KYCVerificationStep,
            as: 'verificationSteps',
            attributes: ['stepType', 'status', 'completedAt']
          },
          {
            model: Performer,
            as: 'performer',
            attributes: ['id', 'firstName', 'lastName', 'kycStatus']
          }
        ]
      });
      
      if (!kycRequest) {
        return res.status(404).json({
          success: false,
          error: 'KYC request not found'
        });
      }
      
      res.json({
        success: true,
        data: kycRequest
      });
    } catch (error) {
      console.error('KYC request fetch error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch KYC request'
      });
    }
  }
);

/**
 * KYCワークフローステータスの取得
 * GET /api/v1/kyc/requests/:requestId/workflow
 */
router.get('/requests/:requestId/workflow',
  authHybrid,
  async (req, res) => {
    try {
      const workflowStatus = await KYCVerificationStep.getWorkflowStatus(req.params.requestId);
      
      res.json({
        success: true,
        data: workflowStatus
      });
    } catch (error) {
      console.error('Workflow status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch workflow status'
      });
    }
  }
);

/**
 * ペンディングKYCリクエストのリスト（管理者用）
 * GET /api/v1/kyc/pending
 */
router.get('/pending',
  authHybrid,
  requireAdmin,
  async (req, res) => {
    try {
      const pendingRequests = await KYCRequest.findAll({
        where: { status: 'in_review' },
        include: [
          {
            model: Performer,
            as: 'performer',
            attributes: ['id', 'firstName', 'lastName', 'firstNameRoman', 'lastNameRoman']
          }
        ],
        order: [['submittedAt', 'ASC']]
      });
      
      res.json({
        success: true,
        data: pendingRequests
      });
    } catch (error) {
      console.error('Pending requests fetch error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch pending requests'
      });
    }
  }
);

/**
 * KYCリクエストの承認（管理者用）
 * POST /api/v1/kyc/requests/:requestId/approve
 */
router.post('/requests/:requestId/approve',
  authHybrid,
  requireAdmin,
  async (req, res) => {
    try {
      const kycRequest = await KYCService.approveKYCRequest(
        req.params.requestId,
        req.user.id
      );
      
      res.json({
        success: true,
        data: kycRequest,
        message: 'KYC request approved successfully'
      });
    } catch (error) {
      console.error('KYC approval error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * KYCリクエストの拒否（管理者用）
 * POST /api/v1/kyc/requests/:requestId/reject
 */
router.post('/requests/:requestId/reject',
  authHybrid,
  requireAdmin,
  [
    body('reason').notEmpty().withMessage('Rejection reason is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const kycRequest = await KYCService.rejectKYCRequest(
        req.params.requestId,
        req.user.id,
        req.body.reason
      );
      
      res.json({
        success: true,
        data: kycRequest,
        message: 'KYC request rejected'
      });
    } catch (error) {
      console.error('KYC rejection error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * Performer KYCステータスの取得
 * GET /api/v1/kyc/performers/:performerId/status
 */
router.get('/performers/:performerId/status',
  authHybrid,
  async (req, res) => {
    try {
      const performer = await Performer.findByPk(req.params.performerId, {
        attributes: [
          'id', 'firstName', 'lastName', 
          'kycStatus', 'kycVerifiedAt', 'kycExpiresAt', 'riskScore'
        ]
      });
      
      if (!performer) {
        return res.status(404).json({
          success: false,
          error: 'Performer not found'
        });
      }
      
      const activeRequest = await KYCRequest.getActiveRequestForPerformer(req.params.performerId);
      
      res.json({
        success: true,
        data: {
          performer,
          needsKYC: performer.needsKYC(),
          isKYCValid: performer.isKYCValid(),
          activeRequest: activeRequest ? {
            id: activeRequest.id,
            status: activeRequest.status,
            createdAt: activeRequest.createdAt
          } : null
        }
      });
    } catch (error) {
      console.error('Performer KYC status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch performer KYC status'
      });
    }
  }
);

/**
 * Sharegram API用エンドポイント - KYC検証結果の受信
 * POST /api/v1/kyc/sharegram/verification-result
 */
router.post('/sharegram/verification-result',
  sharegramAuth,
  async (req, res) => {
    try {
      const { verificationId, status, details } = req.body;
      
      // Sharegram検証ステップの更新
      const verificationStep = await KYCVerificationStep.findOne({
        where: {
          'sharegramData.verificationId': verificationId
        }
      });
      
      if (verificationStep) {
        await verificationStep.update({
          result: {
            ...verificationStep.result,
            sharegramStatus: status,
            sharegramDetails: details
          }
        });
      }
      
      res.json({
        success: true,
        message: 'Verification result received'
      });
    } catch (error) {
      console.error('Sharegram verification result error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process verification result'
      });
    }
  }
);

module.exports = router;