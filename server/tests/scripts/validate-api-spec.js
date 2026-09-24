#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const YAML = require('yamljs');
const request = require('supertest');

/**
 * API仕様書との整合性検証スクリプト
 */
class ApiSpecValidator {
  constructor() {
    this.projectRoot = path.join(__dirname, '../..');
    this.specPath = path.join(this.projectRoot, 'docs/swagger/swagger.yaml');
    this.errors = [];
    this.warnings = [];
    this.verbose = process.argv.includes('--verbose');
  }

  /**
   * メイン実行関数
   */
  async validate() {
    console.log('🔍 API仕様書整合性検証開始');
    console.log('=' .repeat(60));

    try {
      // OpenAPI仕様書読み込み
      const spec = await this.loadApiSpec();
      
      // アプリケーション起動（テスト用）
      const app = await this.loadApp();
      
      // エンドポイント存在確認
      await this.validateEndpoints(spec, app);
      
      // レスポンス形式確認
      await this.validateResponseFormats(spec, app);
      
      // エラーレスポンス確認
      await this.validateErrorResponses(spec, app);
      
      // セキュリティ要件確認
      await this.validateSecurityRequirements(spec, app);
      
      // 結果レポート
      this.generateReport();
      
    } catch (error) {
      console.error('❌ 検証エラー:', error.message);
      process.exit(1);
    }
  }

  /**
   * OpenAPI仕様書読み込み
   */
  async loadApiSpec() {
    try {
      const specContent = await fs.readFile(this.specPath, 'utf8');
      const spec = YAML.parse(specContent);
      
      console.log(`✅ API仕様書読み込み完了: ${this.specPath}`);
      console.log(`📋 API仕様 v${spec.info.version}`);
      
      return spec;
    } catch (error) {
      throw new Error(`API仕様書読み込み失敗: ${error.message}`);
    }
  }

  /**
   * アプリケーション読み込み
   */
  async loadApp() {
    try {
      // テスト環境設定
      process.env.NODE_ENV = 'test';
      
      const appPath = path.join(this.projectRoot, 'server.js');
      const app = require(appPath);
      
      console.log('✅ アプリケーション読み込み完了');
      return app;
    } catch (error) {
      throw new Error(`アプリケーション読み込み失敗: ${error.message}`);
    }
  }

  /**
   * エンドポイント存在確認
   */
  async validateEndpoints(spec, app) {
    console.log('\n🛣️ エンドポイント存在確認中...');
    
    const paths = spec.paths;
    let validEndpoints = 0;
    let totalEndpoints = 0;

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
        
        totalEndpoints++;
        const fullPath = `/api/v1${path}`;
        
        try {
          let response;
          
          // 認証が必要なエンドポイントの場合はダミートークン使用
          const headers = {};
          if (operation.security) {
            headers['Authorization'] = 'Bearer dummy-token-for-endpoint-check';
          }

          switch (method) {
            case 'get':
              response = await request(app).get(fullPath).set(headers);
              break;
            case 'post':
              response = await request(app).post(fullPath).set(headers).send({});
              break;
            case 'put':
              response = await request(app).put(fullPath).set(headers).send({});
              break;
            case 'delete':
              response = await request(app).delete(fullPath).set(headers);
              break;
          }

          // 404以外であればエンドポイントは存在する
          if (response.status !== 404) {
            validEndpoints++;
            if (this.verbose) {
              console.log(`  ✅ ${method.toUpperCase()} ${fullPath} (${response.status})`);
            }
          } else {
            this.errors.push(`エンドポイント未実装: ${method.toUpperCase()} ${fullPath}`);
            console.log(`  ❌ ${method.toUpperCase()} ${fullPath} (404)`);
          }
          
        } catch (error) {
          this.errors.push(`エンドポイント検証エラー: ${method.toUpperCase()} ${fullPath} - ${error.message}`);
        }
      }
    }

    console.log(`📊 エンドポイント確認結果: ${validEndpoints}/${totalEndpoints} 実装済み`);
  }

  /**
   * レスポンス形式確認
   */
  async validateResponseFormats(spec, app) {
    console.log('\n📋 レスポンス形式確認中...');
    
    // 主要エンドポイントのレスポンス形式確認
    const testCases = [
      {
        method: 'get',
        path: '/api/v1/',
        expectedStatus: 200,
        description: 'API情報取得'
      },
      {
        method: 'post',
        path: '/api/auth/login',
        body: { email: 'invalid@test.com', password: 'invalid' },
        expectedStatus: 401,
        description: '認証エラー'
      },
      {
        method: 'get',
        path: '/api/v1/nonexistent',
        expectedStatus: 404,
        description: '404エラー'
      }
    ];

    for (const testCase of testCases) {
      try {
        let response;
        
        switch (testCase.method) {
          case 'get':
            response = await request(app).get(testCase.path);
            break;
          case 'post':
            response = await request(app).post(testCase.path).send(testCase.body || {});
            break;
        }

        // ステータスコード確認
        if (response.status === testCase.expectedStatus) {
          if (this.verbose) {
            console.log(`  ✅ ${testCase.description}: ステータス ${response.status}`);
          }
        } else {
          this.warnings.push(`${testCase.description}: 期待ステータス ${testCase.expectedStatus}, 実際 ${response.status}`);
        }

        // レスポンス形式確認
        if (response.headers['content-type']?.includes('application/json')) {
          try {
            const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
            
            // エラーレスポンスの形式確認
            if (response.status >= 400) {
              if (body.error && body.error.code && body.error.message) {
                if (this.verbose) {
                  console.log(`  ✅ ${testCase.description}: エラーレスポンス形式OK`);
                }
              } else {
                this.errors.push(`${testCase.description}: エラーレスポンス形式が統一されていません`);
              }
            }
            
          } catch (parseError) {
            this.errors.push(`${testCase.description}: JSONパース失敗`);
          }
        }
        
      } catch (error) {
        this.errors.push(`${testCase.description}: テスト実行エラー - ${error.message}`);
      }
    }
  }

  /**
   * エラーレスポンス確認
   */
  async validateErrorResponses(spec, app) {
    console.log('\n❌ エラーレスポンス確認中...');
    
    const errorTestCases = [
      {
        path: '/api/v1/nonexistent',
        method: 'get',
        expectedStatus: 404,
        expectedError: 'NOT_FOUND'
      },
      {
        path: '/api/auth/login',
        method: 'post',
        body: {},
        expectedStatus: 400,
        expectedError: 'VALIDATION_ERROR'
      },
      {
        path: '/api/v1/performers',
        method: 'get',
        expectedStatus: 401,
        expectedError: 'AUTHENTICATION_ERROR'
      }
    ];

    for (const testCase of errorTestCases) {
      try {
        let response;
        
        switch (testCase.method) {
          case 'get':
            response = await request(app).get(testCase.path);
            break;
          case 'post':
            response = await request(app).post(testCase.path).send(testCase.body || {});
            break;
        }

        // 統一エラーレスポンス形式確認
        if (response.status === testCase.expectedStatus) {
          const body = response.body;
          
          if (body.error && body.error.code && body.error.message && body.error.timestamp) {
            if (this.verbose) {
              console.log(`  ✅ ${testCase.path}: 統一エラーレスポンス形式OK`);
            }
          } else {
            this.errors.push(`${testCase.path}: 統一エラーレスポンス形式違反`);
          }
        }
        
      } catch (error) {
        this.warnings.push(`エラーレスポンステスト失敗: ${testCase.path} - ${error.message}`);
      }
    }
  }

  /**
   * セキュリティ要件確認
   */
  async validateSecurityRequirements(spec, app) {
    console.log('\n🔒 セキュリティ要件確認中...');
    
    // 認証必須エンドポイントの確認
    const protectedEndpoints = [
      '/api/v1/performers',
      '/api/v1/batch/performers',
      '/api/v1/analytics/stats'
    ];

    for (const endpoint of protectedEndpoints) {
      try {
        const response = await request(app).get(endpoint);
        
        if (response.status === 401) {
          if (this.verbose) {
            console.log(`  ✅ ${endpoint}: 認証必須確認OK`);
          }
        } else {
          this.errors.push(`${endpoint}: 認証なしでアクセス可能`);
        }
        
      } catch (error) {
        this.warnings.push(`セキュリティテスト失敗: ${endpoint} - ${error.message}`);
      }
    }

    // CORS設定確認
    try {
      const response = await request(app)
        .options('/api/v1/')
        .set('Origin', 'http://localhost:3000');
        
      if (response.headers['access-control-allow-origin']) {
        if (this.verbose) {
          console.log('  ✅ CORS設定確認OK');
        }
      } else {
        this.warnings.push('CORS設定が確認できません');
      }
    } catch (error) {
      this.warnings.push(`CORS確認失敗: ${error.message}`);
    }
  }

  /**
   * 結果レポート生成
   */
  generateReport() {
    console.log('\n' + '=' .repeat(60));
    console.log('📊 API仕様書整合性検証結果');
    console.log('=' .repeat(60));

    const totalIssues = this.errors.length + this.warnings.length;
    
    if (totalIssues === 0) {
      console.log('🎉 すべての検証項目をクリアしました！');
      console.log('✅ API仕様書とのコードベースの整合性が確認されました');
    } else {
      console.log(`⚠️ ${totalIssues}件の問題が見つかりました`);
      
      if (this.errors.length > 0) {
        console.log(`\n❌ エラー (${this.errors.length}件):`);
        this.errors.forEach((error, index) => {
          console.log(`  ${index + 1}. ${error}`);
        });
      }
      
      if (this.warnings.length > 0) {
        console.log(`\n⚠️ 警告 (${this.warnings.length}件):`);
        this.warnings.forEach((warning, index) => {
          console.log(`  ${index + 1}. ${warning}`);
        });
      }
    }

    // 推奨事項
    console.log('\n💡 推奨事項:');
    console.log('  1. エラーレスポンスは統一フォーマット（AppError）を使用');
    console.log('  2. 新機能追加時はOpenAPI仕様書も同時更新');
    console.log('  3. 認証必須エンドポイントは適切にミドルウェア設定');
    console.log('  4. レスポンス形式は一貫性を保つ');

    // JSON レポート出力
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalErrors: this.errors.length,
        totalWarnings: this.warnings.length,
        status: this.errors.length === 0 ? 'PASS' : 'FAIL'
      },
      errors: this.errors,
      warnings: this.warnings
    };

    const reportPath = path.join(this.projectRoot, 'tests/reports/api-spec-validation.json');
    fs.writeFile(reportPath, JSON.stringify(report, null, 2))
      .then(() => {
        console.log(`\n📄 詳細レポート: ${reportPath}`);
      })
      .catch(error => {
        console.error('レポート保存失敗:', error.message);
      });

    console.log('\n✅ API仕様書整合性検証完了');
    
    // エラーがある場合は非ゼロで終了
    if (this.errors.length > 0) {
      process.exit(1);
    }
  }
}

// スクリプト実行
if (require.main === module) {
  const validator = new ApiSpecValidator();
  validator.validate().catch(error => {
    console.error('❌ 予期しないエラー:', error);
    process.exit(1);
  });
}

module.exports = ApiSpecValidator;