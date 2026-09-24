// API Configuration for KYC System
const ENV = process.env.NODE_ENV || 'development';

// 環境別の設定
const configs = {
  development: {
    API_BASE_URL: 'http://localhost:5002/api',
    WS_BASE_URL: 'ws://localhost:5002/ws',
    TIMEOUT: 30000,
    RETRY_ATTEMPTS: 3,
    ENABLE_LOGGING: true
  },
  staging: {
    API_BASE_URL: 'https://stg.id-manager.com/api',
    WS_BASE_URL: 'wss://stg.id-manager.com/ws',
    TIMEOUT: 30000,
    RETRY_ATTEMPTS: 3,
    ENABLE_LOGGING: true
  },
  production: {
    API_BASE_URL: 'https://id-manager.com/api',
    WS_BASE_URL: 'wss://id-manager.com/ws',
    TIMEOUT: 30000,
    RETRY_ATTEMPTS: 3,
    ENABLE_LOGGING: false
  }
};

// 現在の環境設定を取得
const currentConfig = configs[ENV] || configs.development;

// 環境変数で上書き可能
export const API_CONFIG = {
  API_BASE_URL: process.env.REACT_APP_API_URL || currentConfig.API_BASE_URL,
  WS_BASE_URL: process.env.REACT_APP_WS_URL || currentConfig.WS_BASE_URL,
  TIMEOUT: parseInt(process.env.REACT_APP_API_TIMEOUT) || currentConfig.TIMEOUT,
  RETRY_ATTEMPTS: parseInt(process.env.REACT_APP_API_RETRY_ATTEMPTS) || currentConfig.RETRY_ATTEMPTS,
  ENABLE_LOGGING: process.env.REACT_APP_ENABLE_DEBUG === 'true' || currentConfig.ENABLE_LOGGING
};

// APIエンドポイント定義
export const API_ENDPOINTS = {
  // 認証
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout',
    ME: '/auth/me',
    FIREBASE_VERIFY: '/auth/firebase/verify'
  },
  
  // KYC
  KYC: {
    REQUESTS: '/v1/kyc/requests',
    REQUEST_BY_ID: (id) => `/v1/kyc/requests/${id}`,
    SUBMIT: (id) => `/v1/kyc/requests/${id}/submit`,
    DOCUMENTS: (id) => `/v1/kyc/requests/${id}/documents`,
    APPROVE: (id) => `/v1/kyc/requests/${id}/approve`,
    REJECT: (id) => `/v1/kyc/requests/${id}/reject`,
    SHAREGRAM_VERIFY: '/v1/kyc/sharegram/verification-result'
  },
  
  // Performers
  PERFORMERS: {
    LIST: '/performers',
    ALL: '/performers/all',
    BY_ID: (id) => `/performers/${id}`,
    DOCUMENTS: (id) => `/performers/${id}/documents`,
    DOCUMENT_BY_TYPE: (id, type) => `/performers/${id}/documents/${type}`,
    VERIFY_DOCUMENT: (id, type) => `/performers/${id}/documents/${type}/verify`
  },
  
  // Dashboard
  DASHBOARD: {
    STATS: '/dashboard/stats',
    ACTIVITY: '/dashboard/activity',
    CHART: '/dashboard/chart'
  },
  
  // Audit
  AUDIT: {
    LOGS: '/audit-logs',
    BY_RESOURCE: (type, id) => `/audit-logs/${type}/${id}`,
    EXPORT: '/audit-logs/export'
  }
};

// CORS設定
export const CORS_CONFIG = {
  // 許可するオリジン
  ALLOWED_ORIGINS: [
    'https://stg.id-manager.com',
    'https://id-manager.com',
    'https://api.stg.id-manager.com',
    'https://api.id-manager.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  
  // 許可するメソッド
  ALLOWED_METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  
  // 許可するヘッダー
  ALLOWED_HEADERS: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-CSRF-Token',
    'Accept',
    'Accept-Language',
    'Content-Language'
  ],
  
  // 認証情報を含める
  CREDENTIALS: true,
  
  // プリフライトリクエストのキャッシュ時間（秒）
  MAX_AGE: 86400
};

// エラーメッセージ
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'ネットワークエラーが発生しました。接続を確認してください。',
  SERVER_ERROR: 'サーバーエラーが発生しました。しばらく待ってから再試行してください。',
  UNAUTHORIZED: '認証エラーが発生しました。再度ログインしてください。',
  FORBIDDEN: 'アクセス権限がありません。',
  NOT_FOUND: 'リクエストされたリソースが見つかりません。',
  VALIDATION_ERROR: '入力内容に誤りがあります。',
  TIMEOUT: 'リクエストがタイムアウトしました。',
  UNKNOWN: '予期しないエラーが発生しました。'
};

// HTTPステータスコードとメッセージのマッピング
export const HTTP_STATUS_MESSAGES = {
  400: ERROR_MESSAGES.VALIDATION_ERROR,
  401: ERROR_MESSAGES.UNAUTHORIZED,
  403: ERROR_MESSAGES.FORBIDDEN,
  404: ERROR_MESSAGES.NOT_FOUND,
  408: ERROR_MESSAGES.TIMEOUT,
  500: ERROR_MESSAGES.SERVER_ERROR,
  502: ERROR_MESSAGES.SERVER_ERROR,
  503: ERROR_MESSAGES.SERVER_ERROR,
  504: ERROR_MESSAGES.TIMEOUT
};

export default API_CONFIG;