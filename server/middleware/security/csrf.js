const crypto = require('crypto');

/**
 * CSRF Protection Middleware for SafeVideo
 * Implements Double Submit Cookie pattern
 */

const CSRF_HEADER_NAME = 'X-CSRF-Token';
const CSRF_COOKIE_NAME = 'csrf-token';
const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_OPTIONS = {
  httpOnly: false, // Must be readable by JavaScript
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 3600000 // 1 hour
};

// Methods that require CSRF protection
const PROTECTED_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];

// Excluded paths (e.g., login, public endpoints)
const EXCLUDED_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/health',
  '/health'
];

/**
 * Generate a cryptographically secure CSRF token
 */
function generateCSRFToken() {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * Verify CSRF token
 */
function verifyCSRFToken(req) {
  const headerToken = req.headers[CSRF_HEADER_NAME.toLowerCase()];
  const cookieToken = req.cookies[CSRF_COOKIE_NAME];

  if (!headerToken || !cookieToken) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(headerToken),
    Buffer.from(cookieToken)
  );
}

/**
 * CSRF Protection Middleware
 */
const csrfProtection = (options = {}) => {
  const excludedPaths = options.excludedPaths || EXCLUDED_PATHS;
  const protectedMethods = options.protectedMethods || PROTECTED_METHODS;

  return (req, res, next) => {
    // Skip CSRF check for excluded paths
    if (excludedPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Generate and set CSRF token for all requests
    if (!req.cookies[CSRF_COOKIE_NAME]) {
      const token = generateCSRFToken();
      res.cookie(CSRF_COOKIE_NAME, token, CSRF_COOKIE_OPTIONS);
      
      // Make token available in response for initial requests
      res.locals.csrfToken = token;
    }

    // Only verify token for protected methods
    if (protectedMethods.includes(req.method)) {
      if (!verifyCSRFToken(req)) {
        const error = new Error('Invalid CSRF token');
        error.status = 403;
        error.code = 'CSRF_VALIDATION_FAILED';
        return next(error);
      }
    }

    next();
  };
};

/**
 * CSRF Token endpoint middleware
 * Provides a way for clients to retrieve the current CSRF token
 */
const csrfToken = (req, res) => {
  let token = req.cookies[CSRF_COOKIE_NAME];
  
  if (!token) {
    token = generateCSRFToken();
    res.cookie(CSRF_COOKIE_NAME, token, CSRF_COOKIE_OPTIONS);
  }

  res.json({ 
    csrfToken: token,
    headerName: CSRF_HEADER_NAME 
  });
};

/**
 * CSRF Error Handler
 */
const csrfErrorHandler = (err, req, res, next) => {
  if (err.code === 'CSRF_VALIDATION_FAILED') {
    // Log the CSRF attempt
    console.error('CSRF validation failed:', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer'],
      method: req.method,
      path: req.path,
      timestamp: new Date().toISOString()
    });

    return res.status(403).json({
      error: 'CSRF validation failed',
      message: 'Your request could not be validated. Please refresh the page and try again.'
    });
  }

  next(err);
};

module.exports = {
  csrfProtection,
  csrfToken,
  csrfErrorHandler,
  generateCSRFToken,
  verifyCSRFToken
};