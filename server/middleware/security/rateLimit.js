const redis = require('redis');
const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');

/**
 * Advanced Rate Limiting Middleware for SafeVideo
 * Implements multiple rate limiting strategies
 */

// Rate limiter configurations
const RATE_LIMITS = {
  // Global rate limit
  global: {
    points: 100, // Number of requests
    duration: 60, // Per 60 seconds
    blockDuration: 60 // Block for 60 seconds
  },
  
  // Authentication endpoints
  auth: {
    points: 5,
    duration: 900, // 15 minutes
    blockDuration: 900 // Block for 15 minutes
  },
  
  // API endpoints
  api: {
    points: 60,
    duration: 60,
    blockDuration: 60
  },
  
  // File upload endpoints
  upload: {
    points: 10,
    duration: 3600, // 1 hour
    blockDuration: 3600
  },
  
  // Sensitive operations (admin, audit logs)
  sensitive: {
    points: 20,
    duration: 300, // 5 minutes
    blockDuration: 600 // Block for 10 minutes
  }
};

// Initialize Redis client
let redisClient;
if (process.env.REDIS_HOST) {
  redisClient = redis.createClient({
    socket: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT || 6379
    },
    password: process.env.REDIS_PASSWORD
  });
  
  redisClient.connect().catch(err => {
    console.error('Redis connection error for rate limiting:', err);
    redisClient = null;
  });
}

// Create rate limiters
const rateLimiters = {};

// Initialize rate limiters for each configuration
Object.entries(RATE_LIMITS).forEach(([name, config]) => {
  if (redisClient) {
    // Use Redis for distributed rate limiting
    rateLimiters[name] = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: `rl_${name}_`,
      points: config.points,
      duration: config.duration,
      blockDuration: config.blockDuration,
      execEvenly: true
    });
  } else {
    // Fallback to memory-based rate limiting
    console.warn(`Using memory-based rate limiting for ${name} (Redis not available)`);
    rateLimiters[name] = new RateLimiterMemory({
      points: config.points,
      duration: config.duration,
      blockDuration: config.blockDuration,
      execEvenly: true
    });
  }
});

/**
 * Get client identifier for rate limiting
 */
function getClientId(req) {
  // Priority: authenticated user > IP + User-Agent > IP
  if (req.user && req.user.id) {
    return `user_${req.user.id}`;
  }
  
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  // Combine IP and User-Agent for better accuracy
  return `ip_${ip}_${Buffer.from(userAgent).toString('base64').substring(0, 20)}`;
}

/**
 * Determine rate limit type based on request
 */
function getRateLimitType(req) {
  const path = req.path;
  
  // Authentication endpoints
  if (path.match(/\/api\/auth\/(login|register)/)) {
    return 'auth';
  }
  
  // Upload endpoints
  if (path.match(/\/api\/.*\/upload|\/api\/performers/)) {
    return 'upload';
  }
  
  // Sensitive endpoints
  if (path.match(/\/api\/(admin|audit-logs|users\/\d+\/role)/)) {
    return 'sensitive';
  }
  
  // General API endpoints
  if (path.startsWith('/api/')) {
    return 'api';
  }
  
  // Default to global
  return 'global';
}

/**
 * Rate limiting middleware
 */
const createRateLimiter = (type = 'global') => {
  return async (req, res, next) => {
    const clientId = getClientId(req);
    const limiterType = type === 'auto' ? getRateLimitType(req) : type;
    const rateLimiter = rateLimiters[limiterType] || rateLimiters.global;
    
    try {
      const rateLimiterRes = await rateLimiter.consume(clientId);
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', rateLimiter.points);
      res.setHeader('X-RateLimit-Remaining', rateLimiterRes.remainingPoints);
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString());
      
      next();
    } catch (rateLimiterRes) {
      // Rate limit exceeded
      res.setHeader('X-RateLimit-Limit', rateLimiter.points);
      res.setHeader('X-RateLimit-Remaining', rateLimiterRes.remainingPoints || 0);
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString());
      res.setHeader('Retry-After', Math.round(rateLimiterRes.msBeforeNext / 1000) || 60);
      
      // Log rate limit violation
      console.warn('Rate limit exceeded:', {
        clientId,
        limiterType,
        ip: req.ip,
        path: req.path,
        method: req.method,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.round(rateLimiterRes.msBeforeNext / 1000) || 60
      });
    }
  };
};

/**
 * Sliding window rate limiter for more complex scenarios
 */
class SlidingWindowRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000; // 1 minute
    this.max = options.max || 100;
    this.storage = new Map();
  }
  
  async consume(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Get or create request history
    let requests = this.storage.get(key) || [];
    
    // Remove old requests outside the window
    requests = requests.filter(timestamp => timestamp > windowStart);
    
    // Check if limit exceeded
    if (requests.length >= this.max) {
      const oldestRequest = Math.min(...requests);
      const resetTime = oldestRequest + this.windowMs;
      const waitTime = resetTime - now;
      
      throw {
        remainingPoints: 0,
        msBeforeNext: waitTime
      };
    }
    
    // Add current request
    requests.push(now);
    this.storage.set(key, requests);
    
    // Clean up old entries periodically
    if (Math.random() < 0.01) {
      this.cleanup();
    }
    
    return {
      remainingPoints: this.max - requests.length,
      msBeforeNext: this.windowMs
    };
  }
  
  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    for (const [key, requests] of this.storage.entries()) {
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      if (validRequests.length === 0) {
        this.storage.delete(key);
      } else {
        this.storage.set(key, validRequests);
      }
    }
  }
}

/**
 * Progressive rate limiting (increases limit for good behavior)
 */
class ProgressiveRateLimiter {
  constructor(options = {}) {
    this.baseLimit = options.baseLimit || 60;
    this.maxLimit = options.maxLimit || 200;
    this.incrementFactor = options.incrementFactor || 1.1;
    this.resetPeriod = options.resetPeriod || 86400000; // 24 hours
    this.clients = new Map();
  }
  
  async getLimit(clientId) {
    const clientData = this.clients.get(clientId) || {
      limit: this.baseLimit,
      lastViolation: 0,
      lastReset: Date.now()
    };
    
    const now = Date.now();
    
    // Reset if period elapsed
    if (now - clientData.lastReset > this.resetPeriod) {
      clientData.limit = this.baseLimit;
      clientData.lastReset = now;
    }
    
    // Increase limit if no violations
    if (now - clientData.lastViolation > this.resetPeriod / 4) {
      clientData.limit = Math.min(
        Math.floor(clientData.limit * this.incrementFactor),
        this.maxLimit
      );
    }
    
    this.clients.set(clientId, clientData);
    return clientData.limit;
  }
  
  recordViolation(clientId) {
    const clientData = this.clients.get(clientId) || {
      limit: this.baseLimit,
      lastViolation: Date.now(),
      lastReset: Date.now()
    };
    
    clientData.lastViolation = Date.now();
    clientData.limit = Math.max(
      Math.floor(clientData.limit / this.incrementFactor),
      this.baseLimit
    );
    
    this.clients.set(clientId, clientData);
  }
}

// Initialize progressive rate limiter
const progressiveRateLimiter = new ProgressiveRateLimiter({
  baseLimit: 60,
  maxLimit: 200,
  incrementFactor: 1.1
});

/**
 * Combined rate limiting middleware with multiple strategies
 */
const advancedRateLimit = async (req, res, next) => {
  const clientId = getClientId(req);
  const limiterType = getRateLimitType(req);
  
  try {
    // Apply standard rate limiting
    const rateLimiter = rateLimiters[limiterType] || rateLimiters.global;
    
    // Get progressive limit
    const progressiveLimit = await progressiveRateLimiter.getLimit(clientId);
    const effectiveLimit = Math.min(rateLimiter.points, progressiveLimit);
    
    // Create a custom rate limiter with the effective limit
    const customRateLimiter = redisClient 
      ? new RateLimiterRedis({
          storeClient: redisClient,
          keyPrefix: `rl_progressive_${limiterType}_`,
          points: effectiveLimit,
          duration: rateLimiter.duration,
          blockDuration: rateLimiter.blockDuration
        })
      : new RateLimiterMemory({
          points: effectiveLimit,
          duration: rateLimiter.duration,
          blockDuration: rateLimiter.blockDuration
        });
    
    const rateLimiterRes = await customRateLimiter.consume(clientId);
    
    // Set headers
    res.setHeader('X-RateLimit-Limit', effectiveLimit);
    res.setHeader('X-RateLimit-Remaining', rateLimiterRes.remainingPoints);
    res.setHeader('X-RateLimit-Reset', new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString());
    
    next();
  } catch (rateLimiterRes) {
    // Record violation for progressive limiting
    progressiveRateLimiter.recordViolation(clientId);
    
    // Set headers
    res.setHeader('X-RateLimit-Limit', rateLimiterRes.totalPoints || 0);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString());
    res.setHeader('Retry-After', Math.round(rateLimiterRes.msBeforeNext / 1000) || 60);
    
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.round(rateLimiterRes.msBeforeNext / 1000) || 60
    });
  }
};

module.exports = {
  createRateLimiter,
  advancedRateLimit,
  SlidingWindowRateLimiter,
  ProgressiveRateLimiter,
  getClientId,
  getRateLimitType
};