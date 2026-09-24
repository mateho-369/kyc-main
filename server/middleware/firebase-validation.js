/**
 * Firebase SSO Request Validation Middleware
 * Provides comprehensive input validation for Firebase authentication endpoints
 */

const { z } = require('zod');

/**
 * Zod v4 renamed ZodError.errors to ZodError.issues.
 * Accessing the removed property crashed validation with
 * "Cannot read properties of undefined (reading 'map')".
 * This accessor keeps both v3 and v4 working.
 */
const getIssues = (error) => error?.issues || error?.errors || [];

// Firebase ID Token validation schema
const FirebaseVerifySchema = z.object({
  id_token: z.string()
    .min(1, 'ID token is required')
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'Invalid JWT format'),
  client_id: z.string().optional(),
  aud: z.string().optional()
});

// Firebase SSO query parameters validation
const FirebaseSSOQuerySchema = z.object({
  id_token: z.string()
    .min(1, 'ID token is required')
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'Invalid JWT format'),
  redirect_url: z.string()
    .url('Invalid redirect URL format')
    .optional()
    .default('/performers/add')
});

// Custom claims validation schema
const FirebaseClaimsSchema = z.object({
  sharegramUserId: z.string()
    .min(1, 'Sharegram user ID is required')
    .max(255, 'Sharegram user ID too long'),
  kycPermissions: z.array(z.string())
    .optional()
    .default(['basic'])
});

/**
 * Validates Firebase verify request body
 */
const validateFirebaseVerify = (req, res, next) => {
  try {
    const validated = FirebaseVerifySchema.parse(req.body);
    req.validatedData = validated;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: getIssues(error).map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        }
      });
    }
    next(error);
  }
};

/**
 * Validates Firebase SSO query parameters
 */
const validateFirebaseSSOQuery = (req, res, next) => {
  try {
    const validated = FirebaseSSOQuerySchema.parse(req.query);
    req.validatedQuery = validated;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Firebase SSO validation error:', getIssues(error));
      return res.status(400).redirect('/login?error=INVALID_REQUEST');
    }
    next(error);
  }
};

/**
 * Validates Firebase custom claims request
 */
const validateFirebaseClaims = (req, res, next) => {
  try {
    const validated = FirebaseClaimsSchema.parse(req.body);
    req.validatedData = validated;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid claims data',
          details: getIssues(error).map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        }
      });
    }
    next(error);
  }
};

/**
 * Enhanced redirect URL validation
 */
const validateRedirectUrl = (url) => {
  if (!url) return '/performers/add';
  
  // Allow relative paths
  if (url.startsWith('/') && !url.startsWith('//')) {
    // Additional security: prevent path traversal
    if (url.includes('..') || url.includes('%2e%2e')) {
      return '/performers/add';
    }
    return url;
  }
  
  // Allowed domains whitelist
  const allowedDomains = [
    'https://stg.id-manager.com',
    'https://id-manager.com',
    process.env.FRONTEND_URL,
    process.env.CORS_ORIGIN
  ].filter(Boolean);
  
  try {
    const urlObj = new URL(url);
    const isAllowed = allowedDomains.some(domain => {
      const domainObj = new URL(domain);
      return urlObj.origin === domainObj.origin;
    });
    
    if (isAllowed) {
      return url;
    }
  } catch {
    // Invalid URL format
  }
  
  return '/performers/add';
};

/**
 * Rate limiting for authentication endpoints
 */
const authRateLimit = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
};

/**
 * Request sanitization middleware
 */
const sanitizeFirebaseRequest = (req, res, next) => {
  // Remove potential XSS vectors
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        // Basic XSS prevention
        req.body[key] = req.body[key]
          .replace(/<script[^>]*>.*?<\/script>/gi, '')
          .replace(/<[^>]*>/g, '')
          .trim();
      }
    });
  }
  
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = req.query[key]
          .replace(/<script[^>]*>.*?<\/script>/gi, '')
          .replace(/<[^>]*>/g, '')
          .trim();
      }
    });
  }
  
  next();
};

module.exports = {
  validateFirebaseVerify,
  validateFirebaseSSOQuery,
  validateFirebaseClaims,
  validateRedirectUrl,
  authRateLimit,
  sanitizeFirebaseRequest,
  // Export schemas for testing
  FirebaseVerifySchema,
  FirebaseSSOQuerySchema,
  FirebaseClaimsSchema
};