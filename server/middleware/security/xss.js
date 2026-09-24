const createDOMPurify = require('isomorphic-dompurify');
const validator = require('validator');

/**
 * XSS Protection Middleware for SafeVideo
 * Sanitizes user input and sets security headers
 */

// Initialize DOMPurify
const DOMPurify = createDOMPurify();

// XSS Protection Headers
const XSS_HEADERS = {
  'X-XSS-Protection': '1; mode=block',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://trusted.cdn.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.safevideo.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
};

// Fields to skip sanitization (e.g., passwords, tokens)
const SKIP_FIELDS = ['password', 'token', 'jwt', 'secret', 'key', 'hash'];

// Maximum string length to prevent DoS
const MAX_STRING_LENGTH = 10000;

/**
 * Sanitize a value based on its type
 */
function sanitizeValue(value, options = {}) {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle arrays recursively
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, options));
  }

  // Handle objects recursively
  if (typeof value === 'object') {
    const sanitized = {};
    for (const [key, val] of Object.entries(value)) {
      // Skip sensitive fields
      if (SKIP_FIELDS.includes(key.toLowerCase())) {
        sanitized[key] = val;
      } else {
        sanitized[key] = sanitizeValue(val, options);
      }
    }
    return sanitized;
  }

  // Sanitize strings
  if (typeof value === 'string') {
    // Prevent DoS with extremely long strings
    if (value.length > MAX_STRING_LENGTH) {
      value = value.substring(0, MAX_STRING_LENGTH);
    }

    // Basic sanitization
    let sanitized = value;

    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '');

    // Escape HTML if not explicitly allowed
    if (!options.allowHtml) {
      sanitized = validator.escape(sanitized);
    } else {
      // Use DOMPurify for HTML content
      sanitized = DOMPurify.sanitize(sanitized, {
        ALLOWED_TAGS: options.allowedTags || ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
        ALLOWED_ATTR: options.allowedAttributes || ['href', 'title'],
        ALLOW_DATA_ATTR: false
      });
    }

    // Additional context-specific sanitization
    if (options.context === 'url') {
      // Validate and sanitize URLs
      if (!validator.isURL(sanitized, { require_protocol: true })) {
        return '';
      }
    } else if (options.context === 'email') {
      // Validate and normalize email
      if (!validator.isEmail(sanitized)) {
        return '';
      }
      sanitized = validator.normalizeEmail(sanitized);
    } else if (options.context === 'filename') {
      // Sanitize filenames
      sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    return sanitized;
  }

  // Return other types as-is
  return value;
}

/**
 * XSS Protection Middleware
 */
const xssProtection = (options = {}) => {
  return (req, res, next) => {
    // Set security headers
    Object.entries(XSS_HEADERS).forEach(([header, value]) => {
      res.setHeader(header, value);
    });

    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeValue(req.body, options);
    }

    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeValue(req.query, options);
    }

    // Sanitize URL parameters
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeValue(req.params, options);
    }

    // Override res.json to automatically escape output
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      // Set additional security headers for JSON responses
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      
      // Sanitize output data
      const sanitizedData = sanitizeValue(data, { 
        ...options, 
        allowHtml: false 
      });
      
      return originalJson(sanitizedData);
    };

    next();
  };
};

/**
 * Content Security Policy Middleware
 */
const contentSecurityPolicy = (customPolicy = {}) => {
  const defaultPolicy = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'upgrade-insecure-requests': []
  };

  const policy = { ...defaultPolicy, ...customPolicy };

  return (req, res, next) => {
    const policyString = Object.entries(policy)
      .map(([directive, sources]) => {
        if (sources.length === 0) {
          return directive;
        }
        return `${directive} ${sources.join(' ')}`;
      })
      .join('; ');

    res.setHeader('Content-Security-Policy', policyString);
    next();
  };
};

/**
 * Sanitize HTML content (for rich text editors)
 */
const sanitizeHtml = (html, options = {}) => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: options.allowedTags || [
      'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li',
      'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
    ],
    ALLOWED_ATTR: options.allowedAttributes || ['href', 'title', 'target'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
  });
};

module.exports = {
  xssProtection,
  contentSecurityPolicy,
  sanitizeValue,
  sanitizeHtml
};