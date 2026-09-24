const express = require('express');
const wrapRouter = require("../../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
const auth = require('../../middleware/auth');
const { sharegramAuth } = require('../../middleware/sharegram-auth');
const { Performer, AuditLog } = require('../../models');
const redis = require('redis');
const { promisify } = require('util');

// Redis client setup
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('Redis Client Connected');
});

// Promisify Redis commands
const getAsync = promisify(redisClient.get).bind(redisClient);
const setAsync = promisify(redisClient.set).bind(redisClient);
const delAsync = promisify(redisClient.del).bind(redisClient);

// Cache TTL (5 minutes)
const CACHE_TTL = 300;

/**
 * @route   GET /api/documents/by-external-id/:external_id
 * @desc    Get performer documents by external ID
 * @access  Private (Sharegram API auth required)
 */
router.get('/by-external-id/:external_id', sharegramAuth, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { external_id } = req.params;
    
    // Input validation
    if (!external_id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'External ID is required'
      });
    }
    
    // Check cache first
    const cacheKey = `documents:external_id:${external_id}`;
    const cachedData = await getAsync(cacheKey);
    
    if (cachedData) {
      console.log(`Cache hit for external_id: ${external_id}`);
      
      // Log API access (cached response)
      await AuditLog.create({
        userId: req.sharegramAuth.userId,
        action: 'read',
        resourceType: 'document',
        resourceId: external_id,
        details: {
          source: 'cache',
          apiClient: req.sharegramAuth.apiClient,
          responseTime: Date.now() - startTime
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
      
      return res.json(JSON.parse(cachedData));
    }
    
    // Find performer by external_id
    const performer = await Performer.findOne({
      where: { external_id },
      attributes: [
        'id',
        'external_id',
        'lastName',
        'firstName',
        'lastNameRoman',
        'firstNameRoman',
        'status',
        'kycStatus',
        'documents',
        'createdAt',
        'updatedAt'
      ]
    });
    
    if (!performer) {
      // Log API access (not found)
      await AuditLog.create({
        userId: req.sharegramAuth.userId,
        action: 'read',
        resourceType: 'document',
        resourceId: external_id,
        details: {
          result: 'not_found',
          apiClient: req.sharegramAuth.apiClient,
          responseTime: Date.now() - startTime
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
      
      return res.status(404).json({
        error: 'Not Found',
        message: 'Performer not found with the specified external ID'
      });
    }
    
    // Access permission check
    // Check if the API client has permission to access this performer's documents
    const hasAccess = await checkDocumentAccess(req.sharegramAuth, performer);
    
    if (!hasAccess) {
      // Log unauthorized access attempt
      await AuditLog.create({
        userId: req.sharegramAuth.userId,
        action: 'unauthorized_access',
        resourceType: 'document',
        resourceId: performer.id,
        details: {
          external_id,
          apiClient: req.sharegramAuth.apiClient,
          reason: 'insufficient_permissions'
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || ''
      });
      
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to access this performer\'s documents'
      });
    }
    
    // Format document response
    const documents = performer.documents || {};
    const response = {
      performer: {
        id: performer.id,
        external_id: performer.external_id,
        name: {
          lastName: performer.lastName,
          firstName: performer.firstName,
          lastNameRoman: performer.lastNameRoman,
          firstNameRoman: performer.firstNameRoman
        },
        status: performer.status,
        kycStatus: performer.kycStatus
      },
      documents: [],
      metadata: {
        totalDocuments: 0,
        verifiedDocuments: 0,
        pendingDocuments: 0,
        lastUpdated: performer.updatedAt
      }
    };
    
    // Process documents
    const documentTypes = ['agreementFile', 'idFront', 'idBack', 'selfie', 'selfieWithId'];
    
    documentTypes.forEach(docType => {
      if (documents[docType]) {
        const doc = documents[docType];
        response.documents.push({
          type: docType,
          originalName: doc.originalName,
          mimeType: doc.mimeType,
          verified: doc.verified || false,
          verifiedAt: doc.verifiedAt || null,
          uploadedAt: performer.createdAt,
          downloadUrl: `/api/performers/${performer.id}/documents/${docType}`
        });
        
        response.metadata.totalDocuments++;
        if (doc.verified) {
          response.metadata.verifiedDocuments++;
        } else {
          response.metadata.pendingDocuments++;
        }
      }
    });
    
    // Cache the response
    await setAsync(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);
    
    // Log successful API access
    await AuditLog.create({
      userId: req.sharegramAuth.userId,
      action: 'read',
      resourceType: 'document',
      resourceId: performer.id,
      details: {
        external_id,
        apiClient: req.sharegramAuth.apiClient,
        documentCount: response.metadata.totalDocuments,
        responseTime: Date.now() - startTime
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || ''
    });
    
    res.json(response);
  } catch (error) {
    console.error('Document API Error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An error occurred while retrieving documents'
    });
  }
});

/**
 * Clear cache when documents are updated
 */
router.post('/clear-cache/:external_id', auth, async (req, res) => {
  try {
    // Admin only
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only administrators can clear cache'
      });
    }
    
    const { external_id } = req.params;
    const cacheKey = `documents:external_id:${external_id}`;
    
    await delAsync(cacheKey);
    
    res.json({
      message: 'Cache cleared successfully',
      external_id
    });
  } catch (error) {
    console.error('Cache Clear Error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to clear cache'
    });
  }
});

/**
 * Check document access permissions
 */
async function checkDocumentAccess(authInfo, performer) {
  // Admin API clients have full access
  if (authInfo.apiClient === 'sharegram-admin') {
    return true;
  }
  
  // Check if the performer is active and verified
  if (performer.status !== 'active' || performer.kycStatus !== 'verified') {
    // Only admin clients can access unverified performers
    return false;
  }
  
  // Additional permission checks can be added here
  // For example, checking if the API client has specific permissions
  // or if there's a relationship between the client and the performer
  
  return true;
}

module.exports = router;