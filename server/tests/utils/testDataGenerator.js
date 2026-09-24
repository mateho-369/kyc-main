const { faker } = require('@faker-js/faker');
const { User, Performer, BatchJob, Webhook, ApiLog } = require('../../models');

/**
 * テストデータ生成ユーティリティ
 */
class TestDataGenerator {
  constructor() {
    this.createdRecords = {
      users: [],
      performers: [],
      batchJobs: [],
      webhooks: [],
      apiLogs: []
    };
  }

  /**
   * ユーザーデータ生成
   */
  generateUserData(overrides = {}) {
    return {
      email: faker.internet.email(),
      password: 'TestPassword123!',
      name: faker.person.fullName(),
      role: faker.helpers.arrayElement(['user', 'admin', 'moderator']),
      status: faker.helpers.arrayElement(['active', 'inactive', 'suspended']),
      emailVerified: faker.datatype.boolean(),
      lastLoginAt: faker.date.recent(),
      ...overrides
    };
  }

  /**
   * パフォーマーデータ生成
   */
  generatePerformerData(overrides = {}) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    
    return {
      lastName,
      firstName,
      lastNameRoman: this.toRoman(lastName),
      firstNameRoman: this.toRoman(firstName),
      email: faker.internet.email(),
      phone: faker.phone.number(),
      birthDate: faker.date.birthdate({ min: 18, max: 65, mode: 'age' }),
      nationality: faker.location.country(),
      address: faker.location.streetAddress(),
      status: faker.helpers.arrayElement(['pending', 'active', 'inactive', 'rejected']),
      verificationStatus: faker.helpers.arrayElement(['pending', 'verified', 'failed']),
      notes: faker.lorem.paragraph(),
      metadata: {
        source: faker.helpers.arrayElement(['web', 'api', 'bulk_import']),
        tags: faker.helpers.arrayElements(['vip', 'new', 'verified', 'priority'], { min: 0, max: 3 })
      },
      ...overrides
    };
  }

  /**
   * バッチジョブデータ生成
   */
  generateBatchJobData(overrides = {}) {
    const totalItems = faker.number.int({ min: 10, max: 1000 });
    const processedItems = faker.number.int({ min: 0, max: totalItems });
    const successItems = faker.number.int({ min: 0, max: processedItems });
    const failedItems = processedItems - successItems;

    return {
      userId: 1, // デフォルトユーザー
      jobType: faker.helpers.arrayElement(['performer_import', 'user_export', 'data_migration']),
      status: faker.helpers.arrayElement(['pending', 'processing', 'completed', 'failed', 'cancelled']),
      totalItems,
      processedItems,
      successItems,
      failedItems,
      progress: Math.round((processedItems / totalItems) * 100),
      errorMessage: faker.datatype.boolean(0.3) ? faker.lorem.sentence() : null,
      result: {
        summary: `Processed ${processedItems}/${totalItems} items`,
        details: faker.lorem.paragraphs(2)
      },
      ...overrides
    };
  }

  /**
   * Webhookデータ生成
   */
  generateWebhookData(overrides = {}) {
    return {
      userId: 1,
      name: faker.lorem.words(3),
      url: faker.internet.url(),
      events: faker.helpers.arrayElements(
        ['user.created', 'performer.approved', 'batch.completed'],
        { min: 1, max: 3 }
      ),
      secret: faker.string.alphanumeric(32),
      active: faker.datatype.boolean(0.8),
      headers: {
        'User-Agent': 'SafeVideo-Webhook/1.0',
        'X-Custom-Header': faker.lorem.word()
      },
      retryCount: faker.number.int({ min: 0, max: 5 }),
      timeout: faker.number.int({ min: 1000, max: 30000 }),
      status: faker.helpers.arrayElement(['active', 'inactive', 'error']),
      lastTriggered: faker.date.recent(),
      ...overrides
    };
  }

  /**
   * APIログデータ生成
   */
  generateApiLogData(overrides = {}) {
    const statusCode = faker.helpers.arrayElement([200, 201, 400, 401, 403, 404, 500]);
    const methods = ['GET', 'POST', 'PUT', 'DELETE'];
    const endpoints = [
      '/api/v1/users',
      '/api/v1/performers',
      '/api/v1/batch/performers',
      '/api/v1/search/advanced'
    ];

    return {
      userId: faker.datatype.boolean(0.7) ? faker.number.int({ min: 1, max: 100 }) : null,
      apiKey: faker.datatype.boolean(0.3) ? faker.string.alphanumeric(32) : null,
      method: faker.helpers.arrayElement(methods),
      endpoint: faker.helpers.arrayElement(endpoints),
      requestHeaders: {
        'user-agent': faker.internet.userAgent(),
        'content-type': 'application/json'
      },
      requestBody: faker.datatype.boolean(0.6) ? { data: faker.lorem.words(5) } : null,
      responseStatus: statusCode,
      responseBody: statusCode >= 400 ? { error: faker.lorem.sentence() } : null,
      responseTime: faker.number.int({ min: 10, max: 5000 }),
      ipAddress: faker.internet.ip(),
      userAgent: faker.internet.userAgent(),
      errorMessage: statusCode >= 400 ? faker.lorem.sentence() : null,
      apiVersion: 'v1',
      rateLimitRemaining: faker.number.int({ min: 0, max: 100 }),
      ...overrides
    };
  }

  /**
   * 複数ユーザー作成
   */
  async createUsers(count = 10, overrides = {}) {
    const users = [];
    for (let i = 0; i < count; i++) {
      const userData = this.generateUserData({
        email: `testuser${i + 1}@example.com`,
        ...overrides
      });
      const user = await User.create(userData);
      users.push(user);
      this.createdRecords.users.push(user.id);
    }
    return users;
  }

  /**
   * 複数パフォーマー作成
   */
  async createPerformers(count = 50, overrides = {}) {
    const performers = [];
    for (let i = 0; i < count; i++) {
      const performerData = this.generatePerformerData(overrides);
      const performer = await Performer.create(performerData);
      performers.push(performer);
      this.createdRecords.performers.push(performer.id);
    }
    return performers;
  }

  /**
   * 複数バッチジョブ作成
   */
  async createBatchJobs(count = 20, overrides = {}) {
    const jobs = [];
    for (let i = 0; i < count; i++) {
      const jobData = this.generateBatchJobData(overrides);
      const job = await BatchJob.create(jobData);
      jobs.push(job);
      this.createdRecords.batchJobs.push(job.id);
    }
    return jobs;
  }

  /**
   * 複数Webhook作成
   */
  async createWebhooks(count = 10, overrides = {}) {
    const webhooks = [];
    for (let i = 0; i < count; i++) {
      const webhookData = this.generateWebhookData(overrides);
      const webhook = await Webhook.create(webhookData);
      webhooks.push(webhook);
      this.createdRecords.webhooks.push(webhook.id);
    }
    return webhooks;
  }

  /**
   * 複数APIログ作成
   */
  async createApiLogs(count = 100, overrides = {}) {
    const logs = [];
    for (let i = 0; i < count; i++) {
      const logData = this.generateApiLogData(overrides);
      const log = await ApiLog.create(logData);
      logs.push(log);
      this.createdRecords.apiLogs.push(log.id);
    }
    return logs;
  }

  /**
   * 完全なテストデータセット作成
   */
  async createFullDataSet(options = {}) {
    const {
      userCount = 20,
      performerCount = 100,
      batchJobCount = 30,
      webhookCount = 15,
      apiLogCount = 200
    } = options;

    console.log('🚀 完全テストデータセット作成開始...');

    const users = await this.createUsers(userCount);
    console.log(`✅ ユーザー ${userCount} 件作成完了`);

    const performers = await this.createPerformers(performerCount);
    console.log(`✅ パフォーマー ${performerCount} 件作成完了`);

    const batchJobs = await this.createBatchJobs(batchJobCount, {
      userId: faker.helpers.arrayElement(users).id
    });
    console.log(`✅ バッチジョブ ${batchJobCount} 件作成完了`);

    const webhooks = await this.createWebhooks(webhookCount, {
      userId: faker.helpers.arrayElement(users).id
    });
    console.log(`✅ Webhook ${webhookCount} 件作成完了`);

    const apiLogs = await this.createApiLogs(apiLogCount, {
      userId: () => faker.helpers.arrayElement(users).id
    });
    console.log(`✅ APIログ ${apiLogCount} 件作成完了`);

    console.log('🎉 完全テストデータセット作成完了');

    return {
      users,
      performers,
      batchJobs,
      webhooks,
      apiLogs
    };
  }

  /**
   * 作成したテストデータをクリーンアップ
   */
  async cleanup() {
    console.log('🧹 テストデータクリーンアップ開始...');

    if (this.createdRecords.apiLogs.length > 0) {
      await ApiLog.destroy({ where: { id: this.createdRecords.apiLogs } });
      console.log(`✅ APIログ ${this.createdRecords.apiLogs.length} 件削除`);
    }

    if (this.createdRecords.webhooks.length > 0) {
      await Webhook.destroy({ where: { id: this.createdRecords.webhooks } });
      console.log(`✅ Webhook ${this.createdRecords.webhooks.length} 件削除`);
    }

    if (this.createdRecords.batchJobs.length > 0) {
      await BatchJob.destroy({ where: { id: this.createdRecords.batchJobs } });
      console.log(`✅ バッチジョブ ${this.createdRecords.batchJobs.length} 件削除`);
    }

    if (this.createdRecords.performers.length > 0) {
      await Performer.destroy({ where: { id: this.createdRecords.performers } });
      console.log(`✅ パフォーマー ${this.createdRecords.performers.length} 件削除`);
    }

    if (this.createdRecords.users.length > 0) {
      await User.destroy({ where: { id: this.createdRecords.users } });
      console.log(`✅ ユーザー ${this.createdRecords.users.length} 件削除`);
    }

    // レコード追跡をリセット
    this.createdRecords = {
      users: [],
      performers: [],
      batchJobs: [],
      webhooks: [],
      apiLogs: []
    };

    console.log('🎉 テストデータクリーンアップ完了');
  }

  /**
   * ローマ字変換（簡易版）
   */
  toRoman(str) {
    return str.toLowerCase()
      .replace(/[あ-お]/g, 'a')
      .replace(/[か-ご]/g, 'ka')
      .replace(/[さ-ぞ]/g, 'sa')
      .replace(/[た-ど]/g, 'ta')
      .replace(/[な-の]/g, 'na')
      .replace(/[は-ぽ]/g, 'ha')
      .replace(/[ま-も]/g, 'ma')
      .replace(/[や-よ]/g, 'ya')
      .replace(/[ら-ろ]/g, 'ra')
      .replace(/[わ-ん]/g, 'wa');
  }
}

module.exports = TestDataGenerator;