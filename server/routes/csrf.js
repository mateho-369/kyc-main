/**
 * CSRF Token Management Routes
 * Provides CSRF token endpoints for frontend integration
 */

const express = require('express');
const wrapRouter = require("../utils/wrapRouter");
// Express 4 は async ハンドラの reject を捕捉しないため、ルーター単位で自動ラップする
const router = wrapRouter(express.Router());
// Simple CSRF token implementation for emergency fix
const generateCSRFToken = () => {
  return require('crypto').randomBytes(32).toString('hex');
};

const csrfToken = (req, res) => {
  const token = generateCSRFToken();
  
  res.cookie('csrf-token', token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 3600000,
    path: '/'
  });

  res.json({
    csrfToken: token,
    headerName: 'X-CSRF-Token',
    message: 'CSRF token generated successfully'
  });
};

/**
 * @route   GET /api/csrf-token
 * @desc    Get current CSRF token or generate a new one
 * @access  Public
 */
router.get('/csrf-token', csrfToken);

/**
 * @route   POST /api/csrf-token/refresh
 * @desc    Force refresh CSRF token
 * @access  Public
 */
router.post('/csrf-token/refresh', (req, res) => {
  const newToken = generateCSRFToken();
  
  res.cookie('csrf-token', newToken, {
    httpOnly: false, // JavaScript must be able to read this
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 3600000, // 1 hour
    path: '/'
  });

  res.json({
    csrfToken: newToken,
    headerName: 'X-CSRF-Token',
    message: 'CSRF token refreshed successfully'
  });
});

/**
 * @route   GET /api/csrf-token/validate
 * @desc    Validate current CSRF token without performing protected action
 * @access  Public
 */
router.get('/csrf-token/validate', (req, res) => {
  const headerToken = req.headers['x-csrf-token'];
  const cookieToken = req.cookies['csrf-token'];

  if (!headerToken || !cookieToken) {
    return res.status(400).json({
      valid: false,
      error: 'CSRF token missing',
      message: 'Both header and cookie tokens are required'
    });
  }

  const isValid = headerToken === cookieToken;

  res.json({
    valid: isValid,
    message: isValid ? 'CSRF token is valid' : 'CSRF token mismatch'
  });
});

/**
 * @route   GET /api/csrf-config
 * @desc    Get CSRF configuration for frontend setup
 * @access  Public
 */
router.get('/csrf-config', (req, res) => {
  res.json({
    headerName: 'X-CSRF-Token',
    cookieName: 'csrf-token',
    protectedMethods: ['POST', 'PUT', 'DELETE', 'PATCH'],
    excludedPaths: [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/firebase/register',
      '/api/health',
      '/health',
      '/api/csrf-token'
    ],
    instructions: {
      setup: 'Include CSRF token in X-CSRF-Token header for protected requests',
      tokenSource: 'Get token from /api/csrf-token endpoint or csrf-token cookie',
      interceptor: 'Use axios interceptor to automatically include token in requests'
    }
  });
});

module.exports = router;