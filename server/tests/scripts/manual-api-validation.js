#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

/**
 * 手動API仕様書整合性検証
 */
class ManualApiValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.checks = [];
  }

  async validate() {
    console.log('🔍 手動API仕様書整合性検証開始');
    console.log('=' .repeat(60));

    // OpenAPI仕様書の存在確認
    await this.checkSpecFileExists();
    
    // 必須エンドポイントの実装確認
    await this.checkCoreEndpoints();
    
    // エラーレスポンス統一性確認
    await this.checkErrorResponseFormat();
    
    // セキュリティ実装確認
    await this.checkSecurityImplementation();
    
    // API バージョニング確認
    await this.checkApiVersioning();
    
    // 結果レポート
    this.generateReport();
  }

  async checkSpecFileExists() {
    const specPath = path.join(__dirname, '../../docs/swagger/swagger.yaml');
    
    try {
      await fs.access(specPath);
      this.checks.push('✅ OpenAPI仕様書ファイル存在確認');
      
      const specContent = await fs.readFile(specPath, 'utf8');
      if (specContent.includes('openapi: 3.0.3')) {
        this.checks.push('✅ OpenAPI 3.0.3 仕様準拠');
      } else {
        this.warnings.push('OpenAPI バージョン確認要：3.0.3推奨');
      }
      
      if (specContent.includes('SafeVideo KYC')) {
        this.checks.push('✅ プロジェクト固有情報含有');
      }
      
    } catch (error) {
      this.errors.push('❌ OpenAPI仕様書ファイルが見つかりません');
    }
  }

  async checkCoreEndpoints() {
    const routesDir = path.join(__dirname, '../../routes');
    
    // コアエンドポイントの実装確認
    const coreEndpoints = [
      { file: 'api/v1/index.js', desc: 'API v1 メインルーター' },
      { file: 'api/v1/batch.js', desc: 'バッチ処理API' },
      { file: 'api/v1/bulk.js', desc: '一括操作API' },
      { file: 'api/v1/search.js', desc: '検索API' },
      { file: 'api/v1/analytics.js', desc: '統計API' },
      { file: 'api/v1/webhooks.js', desc: 'Webhook API' },
      { file: 'api/v1/integrations.js', desc: '統合API' },
      { file: 'api/v1/docs.js', desc: 'APIドキュメント' }
    ];

    for (const endpoint of coreEndpoints) {
      const filePath = path.join(routesDir, endpoint.file);
      
      try {
        await fs.access(filePath);
        this.checks.push(`✅ ${endpoint.desc} 実装確認`);
      } catch (error) {
        this.errors.push(`❌ ${endpoint.desc} 未実装: ${endpoint.file}`);
      }
    }
  }

  async checkErrorResponseFormat() {
    const errorHandlerPath = path.join(__dirname, '../../middleware/errorHandler.js');
    const appErrorPath = path.join(__dirname, '../../utils/errors/AppError.js');
    
    try {
      await fs.access(errorHandlerPath);
      this.checks.push('✅ 統一エラーハンドラー実装確認');
      
      const errorHandlerContent = await fs.readFile(errorHandlerPath, 'utf8');
      if (errorHandlerContent.includes('AppError')) {
        this.checks.push('✅ カスタムエラークラス使用確認');
      }
      
    } catch (error) {
      this.errors.push('❌ エラーハンドラーミドルウェア未実装');
    }

    try {
      await fs.access(appErrorPath);
      this.checks.push('✅ AppError クラス実装確認');
      
      const appErrorContent = await fs.readFile(appErrorPath, 'utf8');
      const errorTypes = [
        'AuthenticationError',
        'AuthorizationError', 
        'ValidationError',
        'NotFoundError',
        'ConflictError',
        'RateLimitError'
      ];
      
      const implementedTypes = errorTypes.filter(type => 
        appErrorContent.includes(`class ${type}`)
      );
      
      this.checks.push(`✅ エラータイプ実装: ${implementedTypes.length}/${errorTypes.length}`);
      
    } catch (error) {
      this.errors.push('❌ AppError クラス未実装');
    }
  }

  async checkSecurityImplementation() {
    const authMiddlewarePath = path.join(__dirname, '../../middleware/auth-hybrid.js');
    const rateLimiterPath = path.join(__dirname, '../../middleware/rateLimiter.js');
    
    try {
      await fs.access(authMiddlewarePath);
      this.checks.push('✅ 認証ミドルウェア実装確認');
      
      const authContent = await fs.readFile(authMiddlewarePath, 'utf8');
      if (authContent.includes('Firebase') && authContent.includes('JWT')) {
        this.checks.push('✅ ハイブリッド認証（JWT + Firebase）実装確認');
      }
      
    } catch (error) {
      this.errors.push('❌ 認証ミドルウェア未実装');
    }

    try {
      await fs.access(rateLimiterPath);
      this.checks.push('✅ レート制限ミドルウェア実装確認');
      
      const rateLimiterContent = await fs.readFile(rateLimiterPath, 'utf8');
      if (rateLimiterContent.includes('Redis')) {
        this.checks.push('✅ Redis ベースレート制限実装確認');
      }
      
    } catch (error) {
      this.warnings.push('⚠️ レート制限ミドルウェア実装確認必要');
    }
  }

  async checkApiVersioning() {
    const v1RouterPath = path.join(__dirname, '../../routes/api/v1/index.js');
    
    try {
      await fs.access(v1RouterPath);
      this.checks.push('✅ API v1 バージョニング実装確認');
      
      const routerContent = await fs.readFile(v1RouterPath, 'utf8');
      
      // APIメタ情報の確認
      if (routerContent.includes('version')) {
        this.checks.push('✅ APIバージョン情報提供確認');
      }
      
      // エンドポイント一覧の確認
      if (routerContent.includes('endpoints')) {
        this.checks.push('✅ エンドポイント一覧情報提供確認');
      }
      
    } catch (error) {
      this.errors.push('❌ API v1 ルーター未実装');
    }
  }

  generateReport() {
    console.log('\n' + '=' .repeat(60));
    console.log('📊 API仕様書整合性検証結果（手動）');
    console.log('=' .repeat(60));

    // 成功チェック
    if (this.checks.length > 0) {
      console.log(`\n✅ 確認済み項目 (${this.checks.length}件):`);
      this.checks.forEach(check => console.log(`  ${check}`));
    }

    // エラー
    if (this.errors.length > 0) {
      console.log(`\n❌ エラー (${this.errors.length}件):`);
      this.errors.forEach(error => console.log(`  ${error}`));
    }

    // 警告
    if (this.warnings.length > 0) {
      console.log(`\n⚠️ 警告 (${this.warnings.length}件):`);
      this.warnings.forEach(warning => console.log(`  ${warning}`));
    }

    // 総合評価
    const totalIssues = this.errors.length + this.warnings.length;
    console.log('\n' + '-' .repeat(60));
    
    if (this.errors.length === 0) {
      console.log('🎉 重大な問題は検出されませんでした！');
      if (this.warnings.length === 0) {
        console.log('✨ すべての確認項目をクリアしています');
      } else {
        console.log(`⚠️ ${this.warnings.length}件の改善推奨項目があります`);
      }
    } else {
      console.log(`❌ ${this.errors.length}件の修正必須項目があります`);
    }

    // 推奨事項
    console.log('\n💡 API品質向上のための推奨事項:');
    console.log('  1. 全エンドポイントでの統一エラーレスポンス使用');
    console.log('  2. 適切な認証・認可の実装');
    console.log('  3. レート制限による悪用防止');
    console.log('  4. 包括的なAPIドキュメント提供');
    console.log('  5. バージョニング戦略の適用');

    // 簡易レポート保存
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalChecks: this.checks.length,
        totalErrors: this.errors.length,
        totalWarnings: this.warnings.length,
        status: this.errors.length === 0 ? 'PASS' : 'FAIL'
      },
      checks: this.checks,
      errors: this.errors,
      warnings: this.warnings
    };

    const reportPath = path.join(__dirname, '../reports/manual-api-validation.json');
    fs.writeFile(reportPath, JSON.stringify(report, null, 2))
      .then(() => {
        console.log(`\n📄 詳細レポート: ${reportPath}`);
      })
      .catch(error => {
        console.error('レポート保存失敗:', error.message);
      });

    console.log('\n✅ 手動API仕様書整合性検証完了');
    
    return this.errors.length === 0;
  }
}

// スクリプト実行
if (require.main === module) {
  const validator = new ManualApiValidator();
  validator.validate().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('❌ 予期しないエラー:', error);
    process.exit(1);
  });
}

module.exports = ManualApiValidator;