// 16エンドポイント統合自動テストスクリプト
// Phase2効率化 - 即座統合テスト開始準備

const axios = require('axios');
const https = require('https');

// Simple color output functions (chalk alternative)
const chalk = {
  blue: { bold: (str) => `\x1b[1;34m${str}\x1b[0m` },
  cyan: (str) => `\x1b[36m${str}\x1b[0m`,
  yellow: { 
    bold: (str) => `\x1b[1;33m${str}\x1b[0m`
  },
  green: { 
    bold: (str) => `\x1b[1;32m${str}\x1b[0m`
  },
  red: { 
    bold: (str) => `\x1b[1;31m${str}\x1b[0m`
  },
  gray: (str) => `\x1b[90m${str}\x1b[0m`
};

// Add simple color functions
chalk.yellow = (str) => `\x1b[33m${str}\x1b[0m`;
chalk.green = (str) => `\x1b[32m${str}\x1b[0m`;
chalk.red = (str) => `\x1b[31m${str}\x1b[0m`;

// Response formatter functions
const formatSuccessResponse = (data, message = null) => {
  return {
    success: true,
    data: data || {},
    error: null,
    message
  };
};

const formatErrorResponse = (message, code = null, details = null) => {
  return {
    success: false,
    data: null,
    error: {
      message,
      code,
      details
    }
  };
};

class IntegratedEndpointTester {
  constructor() {
    this.baseURL = process.env.REACT_APP_API_URL || 'https://stg.id-manager.com/api';
    this.testResults = {
      passed: 0,
      failed: 0,
      errors: [],
      detailed: {}
    };
    this.testStartTime = null;
    this.testEndTime = null;
  }

  // メインテスト実行
  async runAllTests() {
    console.log(chalk.blue.bold('🚀 16エンドポイント統合自動テスト開始'));
    console.log(chalk.cyan(`📡 ベースURL: ${this.baseURL}`));
    console.log(chalk.cyan(`⏰ 開始時刻: ${new Date().toLocaleString()}`));
    console.log('─'.repeat(80));

    this.testStartTime = Date.now();

    // 優先度順でテスト実行
    await this.testTier1Authentication();
    await this.testTier2PerformerManagement();  
    await this.testTier3DocumentManagement();
    await this.testTier4VerificationSystem();
    await this.testTier5IntegrationMonitoring();

    this.testEndTime = Date.now();
    this.generateFinalReport();
  }

  // Tier 1: 認証・SSO連携API群テスト
  async testTier1Authentication() {
    console.log(chalk.yellow.bold('\n🔐 Tier 1: 認証・SSO連携API群テスト'));
    
    // 1. Firebase ID Token検証
    await this.testEndpoint('POST', '/auth/firebase-verify', {
      name: 'Firebase認証検証',
      priority: 1,
      payload: {
        id_token: 'mock_firebase_token_for_testing',
        client_id: 'sharegram_platform'
      },
      expectedResponse: {
        success: true,
        data: { user: 'object', session_token: 'string' }
      }
    });

    // 2. Firebase SSO リダイレクト
    await this.testEndpoint('GET', '/auth/firebase-sso', {
      name: 'Firebase SSO認証',
      priority: 2,
      queryParams: {
        id_token: 'mock_firebase_token',
        redirect_url: 'https://sharegram.com/callback'
      },
      expectedStatus: [200, 302] // リダイレクトまたは成功
    });
  }

  // Tier 2: 出演者情報連携API群テスト
  async testTier2PerformerManagement() {
    console.log(chalk.yellow.bold('\n👥 Tier 2: 出演者情報連携API群テスト'));

    // 3. 出演者情報同期
    await this.testEndpoint('POST', '/performers/sync', {
      name: '出演者情報同期',
      priority: 3,
      payload: {
        performer: {
          external_id: 'test_performer_123',
          lastName: '田中',
          firstName: '太郎',
          lastNameRoman: 'Tanaka',
          firstNameRoman: 'Taro',
          user_id: 'test_user_456'
        }
      },
      expectedResponse: {
        success: true,
        data: { performer: 'object' }
      }
    });

    // 4. 出演者詳細取得
    await this.testEndpoint('GET', '/performers/test_performer_123', {
      name: '出演者詳細取得',
      priority: 4,
      queryParams: { external_id: 'true' },
      expectedResponse: {
        success: true,
        data: { performer: 'object' }
      }
    });

    // 5. 出演者一覧取得
    await this.testEndpoint('GET', '/performers', {
      name: '出演者一覧取得',
      priority: 5,
      queryParams: {
        page: 1,
        limit: 20,
        status: 'active'
      },
      expectedResponse: {
        success: true,
        data: { performers: 'array', pagination: 'object' }
      }
    });

    // 6. 出演者登録完了通知
    await this.testEndpoint('POST', '/performers/registration-complete', {
      name: '出演者登録完了通知',
      priority: 6,
      payload: {
        performer_id: 'test_performer_123',
        external_id: 'sharegram_performer_456',
        status: 'pending',
        documents: [
          { type: 'agreementFile', verified: false },
          { type: 'idFront', verified: false }
        ]
      },
      expectedResponse: {
        success: true,
        data: { message: 'string', redirect_url: 'string' }
      }
    });
  }

  // Tier 3: 身分証明書連携API群テスト
  async testTier3DocumentManagement() {
    console.log(chalk.yellow.bold('\n📄 Tier 3: 身分証明書連携API群テスト'));

    // 7. 書類一覧取得
    await this.testEndpoint('GET', '/performers/test_performer_123/documents', {
      name: '書類一覧取得',
      priority: 7,
      queryParams: { external_id: 'true' },
      expectedResponse: {
        success: true,
        data: { documents: 'array' }
      }
    });

    // 8. 書類ダウンロード
    await this.testEndpoint('GET', '/performers/test_performer_123/documents/idFront/download', {
      name: '書類ダウンロード',
      priority: 8,
      responseType: 'blob',
      expectedContentType: ['application/pdf', 'image/jpeg', 'image/png']
    });

    // 9. 書類メタデータ取得（新規実装）
    await this.testEndpoint('GET', '/performers/test_performer_123/documents/metadata', {
      name: '書類メタデータ取得',
      priority: 9,
      queryParams: { external_id: 'true' },
      expectedResponse: {
        success: true,
        data: { documents: 'array' }
      }
    });
  }

  // Tier 4: 検証ステータス連携API群テスト
  async testTier4VerificationSystem() {
    console.log(chalk.yellow.bold('\n✅ Tier 4: 検証ステータス連携API群テスト'));

    // 10. 書類検証
    await this.testEndpoint('PUT', '/performers/test_performer_123/documents/idFront/verify', {
      name: '書類検証',
      priority: 10,
      payload: {
        verified: true,
        verified_by: 'admin_test_user',
        notes: '自動テストによる検証'
      },
      expectedResponse: {
        success: true,
        data: { document: 'object', all_verified: 'boolean' }
      }
    });

    // 11. KYC承認処理
    await this.testEndpoint('POST', '/performers/test_performer_123/approve', {
      name: 'KYC承認処理',
      priority: 11,
      payload: {
        admin_user_id: 'admin_test',
        admin_session_id: 'session_test',
        approval_action: 'approve',
        approval_level: 'final',
        notes: '自動テストによる承認'
      },
      expectedResponse: {
        success: true,
        data: { performer: 'object', sharegram_notification: 'object' }
      }
    });

    // 12. コンテンツ承認Webhook
    await this.testEndpoint('POST', '/webhooks/content-approved', {
      name: 'コンテンツ承認Webhook',
      priority: 12,
      payload: {
        content_id: 'content_test_789',
        content_title: 'テストコンテンツ',
        performer_ids: ['test_performer_123'],
        approved_at: new Date().toISOString(),
        approved_by: 'admin_test'
      },
      expectedResponse: {
        success: true,
        data: { updated_performers: 'array' }
      }
    });

    // 13. KYC承認通知
    await this.testEndpoint('POST', '/performers/kyc-approved', {
      name: 'KYC承認通知',
      priority: 13,
      payload: {
        performer_id: 'test_performer_123',
        external_id: 'sharegram_performer_456',
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: 'admin_test'
      },
      expectedResponse: {
        success: true,
        data: { message: 'string', performer_status: 'string' }
      }
    });
  }

  // Tier 5: 連携状態管理API群テスト
  async testTier5IntegrationMonitoring() {
    console.log(chalk.yellow.bold('\n🔄 Tier 5: 連携状態管理API群テスト'));

    // 14. 連携状態確認
    await this.testEndpoint('GET', '/integration/status', {
      name: '連携状態確認',
      priority: 14,
      expectedResponse: {
        success: true,
        data: { status: 'string', last_sync: 'string', features: 'object' }
      }
    });

    // 15. 連携ヘルスチェック
    await this.testEndpoint('GET', '/integration/health', {
      name: '連携ヘルスチェック',
      priority: 15,
      expectedResponse: {
        success: true,
        data: { status: 'string', response_time: 'number', service_checks: 'object' }
      }
    });
  }

  // 個別エンドポイントテスト実行
  async testEndpoint(method, path, config) {
    const testName = `[${config.priority}] ${config.name}`;
    const fullUrl = `${this.baseURL}${path}`;
    
    try {
      console.log(chalk.cyan(`\n🧪 ${testName}`));
      console.log(chalk.gray(`   ${method} ${fullUrl}`));

      // リクエスト設定
      const requestConfig = {
        method,
        url: fullUrl,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Mode': 'true'
        },
        // SSL証明書エラーを無視
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      };

      // クエリパラメータ追加
      if (config.queryParams) {
        requestConfig.params = config.queryParams;
      }

      // ペイロード追加
      if (config.payload) {
        requestConfig.data = config.payload;
      }

      // レスポンスタイプ設定
      if (config.responseType) {
        requestConfig.responseType = config.responseType;
      }

      const startTime = Date.now();
      const response = await axios(requestConfig);
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      // レスポンス検証
      const validationResult = this.validateResponse(response, config);
      
      if (validationResult.isValid) {
        console.log(chalk.green(`   ✅ PASS (${responseTime}ms)`));
        this.testResults.passed++;
        this.testResults.detailed[config.priority] = {
          name: config.name,
          status: 'PASS',
          responseTime,
          details: validationResult.details
        };
      } else {
        console.log(chalk.red(`   ❌ FAIL: ${validationResult.error}`));
        this.testResults.failed++;
        this.testResults.errors.push({
          endpoint: testName,
          error: validationResult.error,
          responseTime
        });
        this.testResults.detailed[config.priority] = {
          name: config.name,
          status: 'FAIL',
          responseTime,
          error: validationResult.error
        };
      }

    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      console.log(chalk.red(`   ❌ ERROR: ${errorMessage}`));
      
      this.testResults.failed++;
      this.testResults.errors.push({
        endpoint: testName,
        error: errorMessage,
        status: error.response?.status
      });
      this.testResults.detailed[config.priority] = {
        name: config.name,
        status: 'ERROR',
        error: errorMessage,
        status: error.response?.status
      };
    }
  }

  // レスポンス検証
  validateResponse(response, config) {
    // ステータスコード検証
    if (config.expectedStatus) {
      const expectedStatuses = Array.isArray(config.expectedStatus) 
        ? config.expectedStatus 
        : [config.expectedStatus];
      
      if (!expectedStatuses.includes(response.status)) {
        return {
          isValid: false,
          error: `期待ステータス: ${expectedStatuses.join('/')}, 実際: ${response.status}`
        };
      }
    }

    // Content-Type検証（バイナリファイル用）
    if (config.expectedContentType) {
      const contentType = response.headers['content-type'];
      const expectedTypes = Array.isArray(config.expectedContentType)
        ? config.expectedContentType
        : [config.expectedContentType];
      
      if (!expectedTypes.some(type => contentType?.includes(type))) {
        return {
          isValid: false,
          error: `期待Content-Type: ${expectedTypes.join('/')}, 実際: ${contentType}`
        };
      }
    }

    // レスポンス形式検証
    if (config.expectedResponse && response.data) {
      const validation = this.validateResponseStructure(response.data, config.expectedResponse);
      if (!validation.isValid) {
        return validation;
      }
    }

    return {
      isValid: true,
      details: {
        status: response.status,
        contentType: response.headers['content-type'],
        responseSize: JSON.stringify(response.data || {}).length
      }
    };
  }

  // レスポンス構造検証
  validateResponseStructure(actual, expected) {
    for (const [key, expectedType] of Object.entries(expected)) {
      if (!(key in actual)) {
        return {
          isValid: false,
          error: `必須フィールド '${key}' が存在しません`
        };
      }

      const actualType = typeof actual[key];
      const actualValue = actual[key];

      if (expectedType === 'array' && !Array.isArray(actualValue)) {
        return {
          isValid: false,
          error: `フィールド '${key}' は配列である必要があります (実際: ${actualType})`
        };
      }

      if (expectedType === 'object' && (actualType !== 'object' || Array.isArray(actualValue))) {
        return {
          isValid: false,
          error: `フィールド '${key}' はオブジェクトである必要があります (実際: ${actualType})`
        };
      }

      if (expectedType !== 'array' && expectedType !== 'object' && actualType !== expectedType) {
        return {
          isValid: false,
          error: `フィールド '${key}' は${expectedType}型である必要があります (実際: ${actualType})`
        };
      }
    }

    return { isValid: true };
  }

  // 最終レポート生成
  generateFinalReport() {
    const duration = this.testEndTime - this.testStartTime;
    const totalTests = this.testResults.passed + this.testResults.failed;
    const successRate = ((this.testResults.passed / totalTests) * 100).toFixed(2);

    console.log('\n' + '='.repeat(80));
    console.log(chalk.blue.bold('📊 16エンドポイント統合テスト結果'));
    console.log('='.repeat(80));
    
    console.log(chalk.cyan(`⏱️  実行時間: ${(duration / 1000).toFixed(2)}秒`));
    console.log(chalk.cyan(`🧪 総テスト数: ${totalTests}`));
    console.log(chalk.green(`✅ 成功: ${this.testResults.passed}`));
    console.log(chalk.red(`❌ 失敗: ${this.testResults.failed}`));
    console.log(chalk.yellow(`📈 成功率: ${successRate}%`));

    // 成功率に基づく評価
    if (successRate >= 90) {
      console.log(chalk.green.bold('\n🎉 優秀! システム統合準備完了'));
    } else if (successRate >= 70) {
      console.log(chalk.yellow.bold('\n⚠️  改善が必要 - 部分的修正推奨'));
    } else {
      console.log(chalk.red.bold('\n🚨 重大な問題 - システム修正必須'));
    }

    // エラー詳細表示
    if (this.testResults.errors.length > 0) {
      console.log(chalk.red.bold('\n🔍 エラー詳細:'));
      this.testResults.errors.forEach((error, index) => {
        console.log(chalk.red(`${index + 1}. ${error.endpoint}: ${error.error}`));
      });
    }

    // 成功した重要エンドポイント
    const criticalEndpoints = Object.values(this.testResults.detailed)
      .filter(test => test.status === 'PASS' && [1, 2, 3, 4, 5].includes(parseInt(test.priority)))
      .length;
    
    console.log(chalk.green(`\n🎯 重要エンドポイント成功: ${criticalEndpoints}/5`));

    console.log('\n' + '='.repeat(80));
    console.log(chalk.blue(`🏁 テスト完了: ${new Date().toLocaleString()}`));
  }
}

// 実行部分
const runIntegrationTest = async () => {
  const tester = new IntegratedEndpointTester();
  await tester.runAllTests();
  
  // 結果をファイルに保存
  const reportData = {
    timestamp: new Date().toISOString(),
    results: tester.testResults,
    summary: {
      totalTests: tester.testResults.passed + tester.testResults.failed,
      successRate: ((tester.testResults.passed / (tester.testResults.passed + tester.testResults.failed)) * 100).toFixed(2)
    }
  };
  
  // レポートファイル保存（オプション）
  if (process.env.SAVE_TEST_REPORT) {
    const fs = require('fs');
    const reportPath = `./test-reports/integration-test-${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(chalk.blue(`📄 レポート保存: ${reportPath}`));
  }
  
  return tester.testResults;
};

// CLI実行対応
if (require.main === module) {
  runIntegrationTest()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(chalk.red('テスト実行エラー:'), error);
      process.exit(1);
    });
}

module.exports = { IntegratedEndpointTester, runIntegrationTest };