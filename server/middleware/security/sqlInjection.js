const validator = require('validator');

/**
 * SQL Injection Prevention Middleware for SafeVideo
 * Additional layer of protection beyond ORM
 */

// Dangerous SQL patterns
const SQL_INJECTION_PATTERNS = [
  // SQL keywords
  /(\b)(union|select|insert|update|delete|drop|create|alter|exec|execute|script|declare|cast|convert|table|from|where|join|having|order\s+by|group\s+by)(\b)/gi,
  
  // SQL operators and special characters
  /(\-\-|\/\*|\*\/|;|'|"|`|\\x00|\\n|\\r|\\x1a)/gi,
  
  // Common SQL injection attempts
  /(\b)(or|and)(\s+)(1\s*=\s*1|'1'\s*=\s*'1'|true|false)/gi,
  
  // Hex encoding attempts
  /0x[0-9a-f]+/gi,
  
  // Unicode encoding attempts
  /\\u[0-9a-f]{4}/gi,
  
  // Time-based injection patterns
  /(sleep|benchmark|waitfor\s+delay|pg_sleep)/gi,
  
  // Information schema queries
  /(information_schema|sysobjects|syscolumns|sys\.)/gi,
  
  // Stacked queries
  /;\s*(select|insert|update|delete|drop)/gi
];

// Fields that might legitimately contain SQL-like content
const ALLOWED_SQL_FIELDS = ['notes', 'description', 'comment'];

// Maximum parameter length to prevent DoS
const MAX_PARAM_LENGTH = 5000;

/**
 * Check if a value contains SQL injection patterns
 */
function containsSQLInjection(value, fieldName = '') {
  if (typeof value !== 'string') {
    return false;
  }
  
  // Skip fields that might legitimately contain SQL keywords
  if (ALLOWED_SQL_FIELDS.includes(fieldName.toLowerCase())) {
    // Still check for the most dangerous patterns
    const dangerousPatterns = [
      /(\-\-|\/\*|\*\/|;)/gi,
      /(\b)(drop|create|alter|exec|execute)(\b)/gi,
      /(sleep|benchmark|waitfor\s+delay)/gi
    ];
    
    return dangerousPatterns.some(pattern => pattern.test(value));
  }
  
  // Check against all patterns
  return SQL_INJECTION_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Sanitize value to prevent SQL injection
 */
function sanitizeSQLValue(value) {
  if (typeof value !== 'string') {
    return value;
  }
  
  // Escape single quotes (most common SQL injection vector)
  let sanitized = value.replace(/'/g, "''");
  
  // Remove SQL comments
  sanitized = sanitized.replace(/--.*$/gm, '');
  sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, '');
  
  // Remove null bytes
  sanitized = sanitized.replace(/\x00/g, '');
  
  // Limit length
  if (sanitized.length > MAX_PARAM_LENGTH) {
    sanitized = sanitized.substring(0, MAX_PARAM_LENGTH);
  }
  
  return sanitized;
}

/**
 * Validate and sanitize object recursively
 */
function validateObject(obj, path = '', errors = []) {
  if (!obj || typeof obj !== 'object') {
    return { isValid: true, errors };
  }
  
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    
    if (typeof value === 'string') {
      // Check for SQL injection
      if (containsSQLInjection(value, key)) {
        errors.push({
          field: currentPath,
          message: 'Potential SQL injection detected',
          value: value.substring(0, 50) + '...' // Truncate for logging
        });
      }
      
      // Additional validation for specific fields
      if (key.toLowerCase().includes('email') && value && !validator.isEmail(value)) {
        errors.push({
          field: currentPath,
          message: 'Invalid email format'
        });
      }
      
      if (key.toLowerCase().includes('url') && value && !validator.isURL(value)) {
        errors.push({
          field: currentPath,
          message: 'Invalid URL format'
        });
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object') {
          validateObject(item, `${currentPath}[${index}]`, errors);
        } else if (typeof item === 'string' && containsSQLInjection(item)) {
          errors.push({
            field: `${currentPath}[${index}]`,
            message: 'Potential SQL injection detected in array element'
          });
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      validateObject(value, currentPath, errors);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * SQL Injection Prevention Middleware
 */
const sqlInjectionProtection = (options = {}) => {
  const { 
    blockOnDetection = true,
    sanitize = false,
    logAttempts = true,
    customPatterns = []
  } = options;
  
  // Add custom patterns if provided
  if (customPatterns.length > 0) {
    SQL_INJECTION_PATTERNS.push(...customPatterns);
  }
  
  return (req, res, next) => {
    const validationErrors = [];
    
    // Validate request body
    if (req.body) {
      const bodyValidation = validateObject(req.body);
      validationErrors.push(...bodyValidation.errors);
      
      // Sanitize if requested
      if (sanitize && !bodyValidation.isValid) {
        req.body = sanitizeObject(req.body);
      }
    }
    
    // Validate query parameters
    if (req.query) {
      const queryValidation = validateObject(req.query, 'query');
      validationErrors.push(...queryValidation.errors);
      
      if (sanitize && !queryValidation.isValid) {
        req.query = sanitizeObject(req.query);
      }
    }
    
    // Validate URL parameters
    if (req.params) {
      const paramsValidation = validateObject(req.params, 'params');
      validationErrors.push(...paramsValidation.errors);
      
      if (sanitize && !paramsValidation.isValid) {
        req.params = sanitizeObject(req.params);
      }
    }
    
    // Handle detection
    if (validationErrors.length > 0) {
      if (logAttempts) {
        console.error('SQL Injection attempt detected:', {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          method: req.method,
          path: req.path,
          errors: validationErrors,
          timestamp: new Date().toISOString()
        });
      }
      
      if (blockOnDetection) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid input detected',
          code: 'INVALID_INPUT'
        });
      }
    }
    
    next();
  };
};

/**
 * Sanitize object recursively
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  const sanitized = Array.isArray(obj) ? [] : {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeSQLValue(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'object' ? sanitizeObject(item) : sanitizeSQLValue(item)
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Parameterized query helper
 */
const createParameterizedQuery = (query, params) => {
  let paramIndex = 1;
  const parameterized = query.replace(/\?/g, () => `$${paramIndex++}`);
  
  return {
    text: parameterized,
    values: params
  };
};

/**
 * Safe query builder for common operations
 */
class SafeQueryBuilder {
  constructor(table) {
    this.table = this.sanitizeIdentifier(table);
    this.conditions = [];
    this.values = [];
    this.paramCounter = 1;
  }
  
  sanitizeIdentifier(identifier) {
    // Only allow alphanumeric characters and underscores
    return identifier.replace(/[^a-zA-Z0-9_]/g, '');
  }
  
  where(column, operator, value) {
    const sanitizedColumn = this.sanitizeIdentifier(column);
    const allowedOperators = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'NOT IN'];
    
    if (!allowedOperators.includes(operator.toUpperCase())) {
      throw new Error(`Invalid operator: ${operator}`);
    }
    
    this.conditions.push(`${sanitizedColumn} ${operator} $${this.paramCounter++}`);
    this.values.push(value);
    
    return this;
  }
  
  select(columns = ['*']) {
    const sanitizedColumns = columns.map(col => 
      col === '*' ? '*' : this.sanitizeIdentifier(col)
    );
    
    const query = `SELECT ${sanitizedColumns.join(', ')} FROM ${this.table}`;
    
    if (this.conditions.length > 0) {
      return {
        text: `${query} WHERE ${this.conditions.join(' AND ')}`,
        values: this.values
      };
    }
    
    return { text: query, values: [] };
  }
  
  insert(data) {
    const columns = Object.keys(data).map(col => this.sanitizeIdentifier(col));
    const placeholders = columns.map(() => `$${this.paramCounter++}`);
    const values = Object.values(data);
    
    return {
      text: `INSERT INTO ${this.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values
    };
  }
  
  update(data) {
    const updates = Object.keys(data).map(col => {
      const sanitizedCol = this.sanitizeIdentifier(col);
      return `${sanitizedCol} = $${this.paramCounter++}`;
    });
    
    const values = [...Object.values(data), ...this.values];
    
    let query = `UPDATE ${this.table} SET ${updates.join(', ')}`;
    
    if (this.conditions.length > 0) {
      query += ` WHERE ${this.conditions.join(' AND ')}`;
    }
    
    return { text: query, values };
  }
  
  delete() {
    if (this.conditions.length === 0) {
      throw new Error('DELETE without WHERE clause is not allowed');
    }
    
    return {
      text: `DELETE FROM ${this.table} WHERE ${this.conditions.join(' AND ')}`,
      values: this.values
    };
  }
}

module.exports = {
  sqlInjectionProtection,
  containsSQLInjection,
  sanitizeSQLValue,
  sanitizeObject,
  createParameterizedQuery,
  SafeQueryBuilder
};