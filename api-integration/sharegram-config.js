/**
 * Sharegram テスト環境設定
 */

module.exports = {
  // Sharegram API設定
  SHAREGRAM_API: {
    BASE_URL: 'https://stg-kddi-api.share-gram.com/v2',
    USER_SITE: 'https://stg-kddi-user.share-gram.com',
    
    // エンドポイント
    ENDPOINTS: {
      // KYC承認通知（Sharegram側で実装）
      KYC_APPROVED: '/performers/kyc-approved',
      // 出演者登録完了通知（Sharegram側で実装）
      REGISTRATION_COMPLETE: '/performers/registration-complete'
    },
    
    // タイムアウト設定
    TIMEOUT: 30000,
    
    // リトライ設定
    RETRY: {
      MAX_ATTEMPTS: 3,
      DELAY: 1000,
      BACKOFF_MULTIPLIER: 2
    }
  },
  
  // Webhook設定
  WEBHOOK: {
    // Webhook署名検証用シークレット（環境変数で設定）
    SECRET: process.env.WEBHOOK_SECRET || 'test-webhook-secret-2025',
    
    // Webhook送信時のヘッダー
    HEADERS: {
      'X-Webhook-Source': 'sharegram-kyc-system',
      'X-Webhook-Version': '1.0'
    }
  },
  
  // システムAPI認証
  SYSTEM_API: {
    // SharegramからのAPI認証キー
    INCOMING_KEYS: process.env.SHAREGRAM_API_KEYS ? 
      process.env.SHAREGRAM_API_KEYS.split(',') : 
      ['sharegram-api-key-test-2025'],
    
    // SharegramへのAPI認証キー
    OUTGOING_KEY: process.env.KYC_TO_SHAREGRAM_KEY || 'kyc-to-sharegram-key-test-2025'
  }
};