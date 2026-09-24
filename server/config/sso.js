/**
 * SSO Configuration Module
 * Centralizes all SSO-related environment variables and configuration
 */

// Load environment variables
require('dotenv').config();

// Sharegram SSO Configuration
const sharegramConfig = {
  // JWKS URI for JWT token verification
  jwksUri: process.env.SHAREGRAM_JWKS_URI || 'https://api.sharegram.com/.well-known/jwks.json',
  
  // JWT Configuration
  issuer: process.env.SHAREGRAM_ISSUER || 'https://api.sharegram.com',
  audience: process.env.SHAREGRAM_AUDIENCE || process.env.APP_CLIENT_ID,
  
  // API Configuration
  apiUrl: process.env.SHAREGRAM_API_URL || 'https://api.sharegram.com/v2',
  apiKey: process.env.SHAREGRAM_API_KEY,
  
  // Webhook Configuration
  webhookSecret: process.env.SHAREGRAM_WEBHOOK_SECRET,
  
  // Legacy support
  secret: process.env.SHAREGRAM_SECRET
};

// Firebase SSO Configuration
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
  // .env では改行がリテラルの "\n" で入るため、実改行に変換する
  // （他モジュールと同じ扱い。これをしないと秘密鍵がパースできない）
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  clientId: process.env.FIREBASE_CLIENT_ID,
  authUri: process.env.FIREBASE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
  tokenUri: process.env.FIREBASE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
  authProviderX509CertUrl: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL || 'https://www.googleapis.com/oauth2/v1/certs',
  clientX509CertUrl: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

// Redis Configuration for SSO Sessions
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  ssoDb: process.env.REDIS_SSO_DB || 2,
  authDb: process.env.REDIS_AUTH_DB || 1,
  tokenDb: process.env.REDIS_TOKEN_DB || 3
};

// JWT Configuration
const jwtConfig = {
  secret: process.env.JWT_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  issuer: process.env.JWT_ISSUER || 'safevideo-kyc',
  audience: process.env.JWT_AUDIENCE || 'safevideo-app',
  expiresIn: '1h',
  refreshExpiresIn: '7d'
};

// Application Configuration
const appConfig = {
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development'
};

// Security Settings
const securityConfig = {
  enableRateLimiting: process.env.ENABLE_RATE_LIMITING === 'true',
  enableSlowDown: process.env.ENABLE_SLOW_DOWN === 'true',
  enableAuditLogging: process.env.ENABLE_AUDIT_LOGGING === 'true',
  enableSessionManagement: process.env.ENABLE_SESSION_MANAGEMENT === 'true'
};

// Validation function to check required SSO configuration
const validateSSOConfig = () => {
  const errors = [];
  
  // Check Sharegram SSO configuration
  if (!sharegramConfig.jwksUri) {
    errors.push('SHAREGRAM_JWKS_URI is not configured');
  }
  if (!sharegramConfig.apiKey && appConfig.isProduction) {
    errors.push('SHAREGRAM_API_KEY is required in production');
  }
  
  // Check Firebase configuration
  if (!firebaseConfig.projectId && appConfig.isProduction) {
    errors.push('FIREBASE_PROJECT_ID is required in production');
  }
  
  // Check JWT configuration
  if (!jwtConfig.secret) {
    errors.push('JWT_SECRET is required');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Configuration status helper
const getConfigStatus = () => {
  return {
    sharegram: {
      configured: !!sharegramConfig.jwksUri && !!sharegramConfig.apiKey,
      jwksUri: sharegramConfig.jwksUri,
      issuer: sharegramConfig.issuer,
      audience: sharegramConfig.audience
    },
    firebase: {
      configured: !!firebaseConfig.projectId,
      projectId: firebaseConfig.projectId
    },
    redis: {
      configured: true,
      host: redisConfig.host,
      port: redisConfig.port
    },
    environment: appConfig.nodeEnv
  };
};

module.exports = {
  sharegramConfig,
  firebaseConfig,
  redisConfig,
  jwtConfig,
  appConfig,
  securityConfig,
  validateSSOConfig,
  getConfigStatus
};