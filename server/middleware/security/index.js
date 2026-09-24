/**
 * Security Middleware Index
 * Consolidated security middleware for SafeVideo
 */

const { csrfProtection, csrfToken, csrfErrorHandler, generateCSRFToken, verifyCSRFToken } = require('./csrf');
const { forceHTTPS, securityHeaders, secureCORS, cookieConfig } = require('../security');

// Enhanced CSRF configuration for Firebase integration
const csrfConfig = {
  excludedPaths: [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/firebase/register', // Firebase registration
    '/api/health',
    '/health',
    '/api/csrf-token', // Token endpoint itself
  ],
  protectedMethods: ['POST', 'PUT', 'DELETE', 'PATCH'],
  cookieName: 'csrf-token',
  headerName: 'X-CSRF-Token'
};

// Enhanced CSRF protection with Firebase coordination
const enhancedCSRFProtection = csrfProtection(csrfConfig);

// CSRF token refresh middleware for long sessions
const csrfTokenRefresh = (req, res, next) => {
  const currentToken = req.cookies['csrf-token'];
  
  // Refresh CSRF token if it's older than 30 minutes
  if (currentToken && req.session && req.session.csrfTokenCreated) {
    const tokenAge = Date.now() - req.session.csrfTokenCreated;
    const thirtyMinutes = 30 * 60 * 1000;
    
    if (tokenAge > thirtyMinutes) {
      const newToken = generateCSRFToken();
      res.cookie('csrf-token', newToken, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 3600000 // 1 hour
      });
      
      if (req.session) {
        req.session.csrfTokenCreated = Date.now();
      }
      
      res.locals.csrfToken = newToken;
    }
  }
  
  next();
};

module.exports = {
  // Core security
  forceHTTPS,
  securityHeaders,
  secureCORS,
  cookieConfig,
  
  // CSRF protection
  csrfProtection: enhancedCSRFProtection,
  csrfToken,
  csrfErrorHandler,
  csrfTokenRefresh,
  generateCSRFToken,
  verifyCSRFToken,
  
  // Configuration
  csrfConfig
};