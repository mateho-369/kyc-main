const axios = require('axios');
const crypto = require('crypto');
const { SharegramIntegration, ApiLog } = require('../../models');

class SharegramClient {
  constructor(integration) {
    this.integration = integration;
    this.baseURL = integration.configuration.endpoint || process.env.SHAREGRAM_API_URL || 'https://api.sharegram.com/v1';
    this.apiKey = integration.configuration.apiKey;
    this.secretKey = integration.configuration.secretKey;
    this.timeout = integration.configuration.timeout || 30000;
    
    // Axios インスタンスの作成
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Sharegram-API-Key': this.apiKey,
        'X-Sharegram-Integration-ID': this.integration.id.toString()
      }
    });
    
    // リクエストインターセプター
    this.client.interceptors.request.use(
      (config) => this.addAuthHeaders(config),
      (error) => Promise.reject(error)
    );
    
    // レスポンスインターセプター
    this.client.interceptors.response.use(
      (response) => this.handleResponse(response),
      (error) => this.handleError(error)
    );
  }
  
  /**
   * 認証ヘッダーを追加
   */
  addAuthHeaders(config) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = this.constructSignaturePayload(config, timestamp);
    const signature = this.generateSignature(payload);
    
    config.headers['X-Sharegram-Timestamp'] = timestamp;
    config.headers['X-Sharegram-Signature'] = signature;
    
    return config;
  }
  
  /**
   * 署名ペイロードの構築
   */
  constructSignaturePayload(config, timestamp) {
    const method = config.method.toUpperCase();
    const path = config.url;
    const body = config.data ? JSON.stringify(config.data) : '';
    
    return `${method}\n${path}\n${timestamp}\n${body}`;
  }
  
  /**
   * HMAC-SHA256署名の生成
   */
  generateSignature(payload) {
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('hex');
  }
  
  /**
   * レスポンスの処理
   */
  async handleResponse(response) {
    // APIログの記録
    await this.logApiCall(
      response.config.method,
      response.config.url,
      response.config.data,
      response.status,
      response.data,
      response.config.headers['X-Request-ID']
    );
    
    return response.data;
  }
  
  /**
   * エラーの処理
   */
  async handleError(error) {
    const errorData = {
      message: error.message,
      code: error.code,
      response: error.response?.data
    };
    
    // APIログの記録
    await this.logApiCall(
      error.config?.method,
      error.config?.url,
      error.config?.data,
      error.response?.status || 0,
      errorData,
      error.config?.headers?.['X-Request-ID'],
      errorData.message
    );
    
    throw new SharegramApiError(
      error.response?.data?.message || error.message,
      error.response?.status,
      error.response?.data
    );
  }
  
  /**
   * APIコールのログ記録
   */
  async logApiCall(method, path, requestBody, status, responseBody, requestId, errorMessage = null) {
    try {
      await ApiLog.create({
        method,
        path,
        requestBody: requestBody || {},
        responseStatus: status,
        responseBody: responseBody || {},
        responseTime: Date.now() - (this.requestStartTime || Date.now()),
        errorMessage,
        metadata: {
          service: 'sharegram',
          integrationId: this.integration.id,
          requestId
        }
      });
    } catch (error) {
      console.error('Failed to log Sharegram API call:', error);
    }
  }
  
  /**
   * KYC検証リクエストの送信
   */
  async submitKYCVerification(kycData) {
    this.requestStartTime = Date.now();
    
    const requestData = {
      requestId: crypto.randomUUID(),
      performerId: kycData.performerId,
      documents: {
        idFront: kycData.documents.idFront,
        idBack: kycData.documents.idBack,
        selfie: kycData.documents.selfie,
        addressProof: kycData.documents.addressProof
      },
      personalInfo: {
        firstName: kycData.firstName,
        lastName: kycData.lastName,
        birthDate: kycData.birthDate,
        nationality: kycData.nationality,
        address: kycData.address
      },
      metadata: kycData.metadata || {}
    };
    
    return await this.client.post('/kyc/verify', requestData);
  }
  
  /**
   * KYC検証ステータスの確認
   */
  async getKYCStatus(verificationId) {
    this.requestStartTime = Date.now();
    return await this.client.get(`/kyc/verify/${verificationId}`);
  }
  
  /**
   * KYCドキュメントのアップロード
   */
  async uploadDocument(documentData, documentType) {
    this.requestStartTime = Date.now();
    
    const formData = new FormData();
    formData.append('document', documentData.file);
    formData.append('type', documentType);
    formData.append('metadata', JSON.stringify(documentData.metadata || {}));
    
    return await this.client.post('/kyc/documents', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
  }
  
  /**
   * 顔照合の実行
   */
  async performFaceMatch(selfieUrl, idDocumentUrl) {
    this.requestStartTime = Date.now();
    
    return await this.client.post('/kyc/face-match', {
      selfieUrl,
      idDocumentUrl,
      options: {
        threshold: 0.8,
        enhancedSecurity: true
      }
    });
  }
  
  /**
   * リスクスコアの取得
   */
  async getRiskScore(performerId) {
    this.requestStartTime = Date.now();
    return await this.client.get(`/kyc/risk-score/${performerId}`);
  }
  
  /**
   * Webhookエンドポイントの登録
   */
  async registerWebhook(webhookUrl, events) {
    this.requestStartTime = Date.now();
    
    return await this.client.post('/webhooks', {
      url: webhookUrl,
      events: events || ['kyc.verification.completed', 'kyc.verification.failed'],
      secret: crypto.randomBytes(32).toString('hex')
    });
  }
  
  /**
   * 統合のヘルスチェック
   */
  async healthCheck() {
    this.requestStartTime = Date.now();
    
    try {
      const response = await this.client.get('/health');
      await this.integration.updateSyncStatus('success');
      return response;
    } catch (error) {
      await this.integration.updateSyncStatus('failed', error);
      throw error;
    }
  }
  
  /**
   * API接続の簡易ヘルスチェック（integration.js用）
   */
  async checkHealth() {
    const startTime = Date.now();
    
    try {
      const response = await this.client.get('/health', {
        timeout: 5000 // 5秒のタイムアウト
      });
      
      return {
        success: true,
        message: 'Sharegram API is reachable',
        responseTime: Date.now() - startTime,
        data: response
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        responseTime: Date.now() - startTime,
        error: error.response?.data || error.message
      };
    }
  }
}

/**
 * Sharegram APIエラークラス
 */
class SharegramApiError extends Error {
  constructor(message, statusCode, data) {
    super(message);
    this.name = 'SharegramApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

/**
 * ファクトリー関数
 */
async function createSharegramClient(integrationId) {
  const integration = await SharegramIntegration.findOne({
    where: {
      id: integrationId,
      integrationType: 'api',
      isActive: true
    }
  });
  
  if (!integration) {
    throw new Error('Active Sharegram API integration not found');
  }
  
  if (!integration.isConfigValid()) {
    throw new Error('Invalid Sharegram API configuration');
  }
  
  return new SharegramClient(integration);
}

module.exports = {
  SharegramClient,
  SharegramApiError,
  createSharegramClient
};