const { SharegramIntegration, Webhook } = require('../models');
const { triggerWebhook } = require('./webhookService');
const { Op } = require('sequelize');
const EventEmitter = require('events');

/**
 * イベント配信サービス
 * システム内のイベントを適切な統合に配信する中央ハブ
 */
class EventDeliveryService extends EventEmitter {
  constructor() {
    super();
    this.eventHandlers = new Map();
    this.eventQueue = [];
    this.processing = false;
    
    // デフォルトのイベントハンドラーを登録
    this.registerDefaultHandlers();
  }

  /**
   * イベントをディスパッチ
   * @param {string} eventType - イベントタイプ
   * @param {object} data - イベントデータ
   * @param {object} options - オプション設定
   */
  async dispatch(eventType, data, options = {}) {
    try {
      // イベントをキューに追加
      this.eventQueue.push({
        eventType,
        data,
        options,
        timestamp: new Date(),
        id: this.generateEventId()
      });

      // 内部イベントを発行
      this.emit(eventType, data);

      // 非同期でイベントを処理
      if (!this.processing) {
        this.processEventQueue();
      }

      return {
        success: true,
        eventType,
        queued: true
      };
    } catch (error) {
      console.error('Event dispatch error:', error);
      throw error;
    }
  }

  /**
   * イベントキューを処理
   */
  async processEventQueue() {
    if (this.processing || this.eventQueue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift();
      
      try {
        await this.processEvent(event);
      } catch (error) {
        console.error(`Failed to process event ${event.eventType}:`, error);
        // 失敗したイベントの再試行ロジックをここに実装可能
      }
    }

    this.processing = false;
  }

  /**
   * 個別のイベントを処理
   * @param {object} event - イベントオブジェクト
   */
  async processEvent(event) {
    const { eventType, data, options } = event;

    // 1. Webhook統合への配信
    const webhookResults = await this.deliverToWebhooks(eventType, data, options);

    // 2. SharegramIntegration（APIタイプ）への配信
    const apiResults = await this.deliverToAPIs(eventType, data, options);

    // 3. バッチ統合への記録（後でバッチ処理される）
    const batchResults = await this.recordForBatch(eventType, data, options);

    // 4. カスタムハンドラーの実行
    const customResults = await this.executeCustomHandlers(eventType, data, options);

    return {
      webhooks: webhookResults,
      apis: apiResults,
      batch: batchResults,
      custom: customResults
    };
  }

  /**
   * Webhook統合に配信
   */
  async deliverToWebhooks(eventType, data, options = {}) {
    try {
      // triggerWebhookサービスを使用
      const results = await triggerWebhook(eventType, data);
      return results;
    } catch (error) {
      console.error('Webhook delivery error:', error);
      return { error: error.message };
    }
  }

  /**
   * API統合に配信
   */
  async deliverToAPIs(eventType, data, options = {}) {
    try {
      // API統合を取得
      const apiIntegrations = await SharegramIntegration.findAll({
        where: {
          integrationType: 'api',
          isActive: true,
          [Op.or]: [
            { 'configuration.events': { [Op.contains]: [eventType] } },
            { 'configuration.events': { [Op.contains]: ['*'] } }
          ]
        }
      });

      const results = [];

      for (const integration of apiIntegrations) {
        try {
          const result = await this.sendToAPI(integration, eventType, data);
          results.push(result);
        } catch (error) {
          console.error(`API delivery error (Integration ${integration.id}):`, error);
          results.push({ 
            integrationId: integration.id, 
            error: error.message 
          });
        }
      }

      return results;
    } catch (error) {
      console.error('API delivery error:', error);
      return { error: error.message };
    }
  }

  /**
   * API統合に送信
   */
  async sendToAPI(integration, eventType, data) {
    const axios = require('axios');
    const config = integration.configuration;

    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data: data
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      ...config.headers
    };

    const response = await axios.post(config.endpoint, payload, {
      headers,
      timeout: 30000
    });

    await integration.updateSyncStatus('success');

    return {
      integrationId: integration.id,
      success: true,
      response: response.data
    };
  }

  /**
   * バッチ処理用に記録
   */
  async recordForBatch(eventType, data, options = {}) {
    try {
      const batchIntegrations = await SharegramIntegration.findAll({
        where: {
          integrationType: 'batch',
          isActive: true,
          [Op.or]: [
            { 'configuration.events': { [Op.contains]: [eventType] } },
            { 'configuration.events': { [Op.contains]: ['*'] } }
          ]
        }
      });

      const results = [];

      for (const integration of batchIntegrations) {
        // バッチキューに追加（実装は別途必要）
        const batchItem = {
          integrationId: integration.id,
          eventType,
          data,
          timestamp: new Date(),
          status: 'pending'
        };

        // TODO: バッチキューテーブルに保存
        results.push({
          integrationId: integration.id,
          queued: true,
          batchItem
        });
      }

      return results;
    } catch (error) {
      console.error('Batch recording error:', error);
      return { error: error.message };
    }
  }

  /**
   * カスタムハンドラーを実行
   */
  async executeCustomHandlers(eventType, data, options = {}) {
    const handlers = this.eventHandlers.get(eventType) || [];
    const results = [];

    for (const handler of handlers) {
      try {
        const result = await handler(data, options);
        results.push({ handler: handler.name, result });
      } catch (error) {
        console.error(`Custom handler error:`, error);
        results.push({ 
          handler: handler.name, 
          error: error.message 
        });
      }
    }

    return results;
  }

  /**
   * カスタムイベントハンドラーを登録
   */
  registerHandler(eventType, handler) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType).push(handler);
  }

  /**
   * デフォルトのイベントハンドラーを登録
   */
  registerDefaultHandlers() {
    // 出演者承認時の追加処理
    this.registerHandler('performer.approved', async (data) => {
      console.log(`Performer ${data.performerId} approved`);
      // 追加のビジネスロジックをここに実装
    });

    // KYC承認時の追加処理
    this.registerHandler('kyc.approved', async (data) => {
      console.log(`KYC approved for performer ${data.performer.id}`);
      // 追加のビジネスロジックをここに実装
    });

    // コンテンツ承認時の追加処理
    this.registerHandler('content.approved', async (data) => {
      console.log(`Content ${data.contentId} approved`);
      // 追加のビジネスロジックをここに実装
    });
  }

  /**
   * イベントIDを生成
   */
  generateEventId() {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * イベント統計を取得
   */
  async getEventStats(timeRange = '24h') {
    // TODO: イベント統計の実装
    return {
      totalEvents: this.eventQueue.length,
      processing: this.processing,
      handlers: Array.from(this.eventHandlers.keys())
    };
  }

  /**
   * 特定のイベントタイプのサブスクライバーを取得
   */
  async getSubscribers(eventType) {
    const webhooks = await Webhook.findAll({
      where: {
        events: { [Op.contains]: [eventType] },
        isActive: true
      }
    });

    const integrations = await SharegramIntegration.findAll({
      where: {
        [Op.or]: [
          { 'configuration.events': { [Op.contains]: [eventType] } },
          { 'configuration.events': { [Op.contains]: ['*'] } }
        ],
        isActive: true
      }
    });

    return {
      webhooks: webhooks.length,
      integrations: integrations.length,
      customHandlers: (this.eventHandlers.get(eventType) || []).length
    };
  }
}

// シングルトンインスタンスを作成
const eventDeliveryService = new EventDeliveryService();

// エクスポート
module.exports = {
  EventDeliveryService: eventDeliveryService,
  dispatch: eventDeliveryService.dispatch.bind(eventDeliveryService),
  registerHandler: eventDeliveryService.registerHandler.bind(eventDeliveryService),
  getEventStats: eventDeliveryService.getEventStats.bind(eventDeliveryService),
  getSubscribers: eventDeliveryService.getSubscribers.bind(eventDeliveryService)
};