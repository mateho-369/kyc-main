const axios = require('axios');
const crypto = require('crypto');
const { Webhook, SharegramIntegration } = require('../models');
const { Op } = require('sequelize');

/**
 * Webhook通知サービス
 * 外部システムへのイベント通知を管理
 */
class WebhookService {
  /**
   * Webhookをトリガー
   * @param {string} eventType - イベントタイプ (例: 'performer.approved')
   * @param {object} data - 送信するデータ
   */
  async triggerWebhook(eventType, data) {
    try {
      // アクティブなWebhook統合を取得
      const integrations = await SharegramIntegration.findAll({
        where: {
          integrationType: 'webhook',
          isActive: true,
          [Op.or]: [
            { 'configuration.events': { [Op.contains]: [eventType] } },
            { 'configuration.events': { [Op.contains]: ['*'] } }
          ]
        },
        order: [['priority', 'DESC']]
      });

      const results = [];

      for (const integration of integrations) {
        try {
          const result = await this.sendWebhook(integration, eventType, data);
          results.push(result);
        } catch (error) {
          console.error(`Webhook送信エラー (Integration ID: ${integration.id}):`, error);
          await integration.updateSyncStatus('failed', error);
        }
      }

      return results;
    } catch (error) {
      console.error('Webhookトリガーエラー:', error);
      throw error;
    }
  }

  /**
   * 個別のWebhookを送信
   * @param {object} integration - SharegramIntegrationインスタンス
   * @param {string} eventType - イベントタイプ
   * @param {object} data - 送信データ
   */
  async sendWebhook(integration, eventType, data) {
    const config = integration.configuration;
    const webhookUrl = config.url;
    const webhookSecret = integration.webhookSecret;

    // ペイロードの作成
    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data: data,
      integrationId: integration.id
    };

    // 署名の生成（秘密鍵が設定されている場合）
    let signature = null;
    if (webhookSecret) {
      signature = this.generateSignature(payload, webhookSecret);
    }

    // リクエストヘッダーの設定
    const headers = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': eventType,
      'X-Webhook-Timestamp': payload.timestamp
    };

    if (signature) {
      headers['X-Webhook-Signature'] = signature;
    }

    // カスタムヘッダーの追加
    if (config.headers) {
      Object.assign(headers, config.headers);
    }

    // レート制限チェック
    const isRateLimited = await integration.isRateLimited();
    if (isRateLimited) {
      throw new Error('Rate limit exceeded');
    }

    // リトライ設定
    const retryConfig = integration.retryConfig || {};
    let lastError = null;
    
    for (let attempt = 1; attempt <= (retryConfig.maxRetries || 3); attempt++) {
      try {
        // Webhook送信
        const response = await axios.post(webhookUrl, payload, {
          headers,
          timeout: config.timeout || 30000,
          validateStatus: (status) => status < 500 // 5xxエラーのみリトライ
        });

        // 成功時の処理
        await integration.updateSyncStatus('success');

        // 成功統計の更新（Webhookモデルは別途存在するため、ここでは統合モデルのみ更新）

        return {
          integrationId: integration.id,
          success: true,
          response: response.data,
          attempt
        };

      } catch (error) {
        lastError = error;
        console.error(`Webhook送信失敗 (試行 ${attempt}/${retryConfig.maxRetries || 3}):`, error.message);

        // 最後の試行でない場合は待機
        if (attempt < (retryConfig.maxRetries || 3)) {
          const delay = integration.getRetryDelay(attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // 全試行失敗時の処理
    await integration.updateSyncStatus('failed', lastError);

    // 失敗統計の更新（統合モデルで管理）

    throw lastError;
  }

  /**
   * Webhook署名を生成
   * @param {object} payload - ペイロード
   * @param {string} secret - 秘密鍵
   * @returns {string} 署名
   */
  generateSignature(payload, secret) {
    const message = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(message);
    return `sha256=${hmac.digest('hex')}`;
  }

  /**
   * Webhook署名を検証
   * @param {string} signature - 受信した署名
   * @param {object} payload - ペイロード
   * @param {string} secret - 秘密鍵
   * @returns {boolean} 検証結果
   */
  verifySignature(signature, payload, secret) {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * 特定のイベントタイプに対するWebhook設定を取得
   * @param {string} eventType - イベントタイプ
   * @returns {Array} Webhook統合のリスト
   */
  async getWebhooksForEvent(eventType) {
    return await SharegramIntegration.findAll({
      where: {
        integrationType: 'webhook',
        isActive: true,
        [Op.or]: [
          { 'configuration.events': { [Op.contains]: [eventType] } },
          { 'configuration.events': { [Op.contains]: ['*'] } }
        ]
      }
    });
  }

  /**
   * Webhookのヘルスチェック
   * @param {number} integrationId - 統合ID
   * @returns {object} ヘルスチェック結果
   */
  async healthCheck(integrationId) {
    const integration = await SharegramIntegration.findByPk(integrationId);
    if (!integration || integration.integrationType !== 'webhook') {
      throw new Error('Webhook integration not found');
    }

    const config = integration.configuration;
    const healthCheckUrl = config.healthCheckUrl || config.url;

    try {
      const response = await axios.get(healthCheckUrl, {
        timeout: 10000,
        headers: config.headers || {}
      });

      return {
        healthy: response.status === 200,
        status: response.status,
        responseTime: response.headers['x-response-time'] || null
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        status: error.response?.status || null
      };
    }
  }
}

// シングルトンインスタンスをエクスポート
const webhookService = new WebhookService();

module.exports = {
  triggerWebhook: webhookService.triggerWebhook.bind(webhookService),
  sendWebhook: webhookService.sendWebhook.bind(webhookService),
  verifySignature: webhookService.verifySignature.bind(webhookService),
  verifyWebhookSignature: webhookService.verifySignature.bind(webhookService), // エイリアス
  getWebhooksForEvent: webhookService.getWebhooksForEvent.bind(webhookService),
  healthCheck: webhookService.healthCheck.bind(webhookService)
};