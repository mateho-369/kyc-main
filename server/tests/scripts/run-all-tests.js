#!/usr/bin/env node

const TestReporter = require('../utils/testReporter');
const { execSync } = require('child_process');
const path = require('path');

/**
 * 全テスト実行スクリプト
 */
class TestRunner {
  constructor() {
    this.projectRoot = path.join(__dirname, '../..');
    this.reporter = new TestReporter();
    this.verbose = process.argv.includes('--verbose');
    this.skipE2E = process.argv.includes('--skip-e2e');
    this.skipPerf = process.argv.includes('--skip-performance');
    this.onlyUnit = process.argv.includes('--unit-only');
  }

  /**
   * メイン実行関数
   */
  async run() {
    console.log('🚀 SafeVideo KYC 包括的テスト実行開始');
    console.log('=' .repeat(60));

    const startTime = Date.now();

    try {
      // 前準備
      await this.setup();

      // テスト種別に応じて実行
      if (this.onlyUnit) {
        await this.runUnitTestsOnly();
      } else {
        await this.runAllTests();
      }

      const duration = Date.now() - startTime;
      console.log('=' .repeat(60));
      console.log(`✅ 全テスト完了 (実行時間: ${this.formatDuration(duration)})`);

    } catch (error) {
      console.error('❌ テスト実行エラー:', error.message);
      process.exit(1);
    }
  }

  /**
   * 前準備
   */
  async setup() {
    console.log('🔧 テスト環境セットアップ中...');

    // 環境変数設定
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';

    // ディレクトリ作成
    this.execCommand('mkdir -p tests/reports tests/coverage', false);

    // 依存関係チェック
    await this.checkDependencies();

    console.log('✅ セットアップ完了');
  }

  /**
   * 依存関係チェック
   */
  async checkDependencies() {
    const requiredDeps = ['jest', 'supertest'];
    const optionalDeps = ['cypress', 'k6'];

    console.log('📦 依存関係チェック中...');

    // 必須依存関係
    for (const dep of requiredDeps) {
      try {
        this.execCommand(`npm list ${dep}`, false);
        console.log(`  ✅ ${dep} インストール済み`);
      } catch (error) {
        console.error(`  ❌ ${dep} が見つかりません`);
        throw new Error(`必須依存関係 ${dep} がインストールされていません`);
      }
    }

    // オプション依存関係
    for (const dep of optionalDeps) {
      try {
        if (dep === 'k6') {
          this.execCommand('k6 version', false);
        } else {
          this.execCommand(`npm list ${dep}`, false);
        }
        console.log(`  ✅ ${dep} インストール済み`);
      } catch (error) {
        console.log(`  ⚠️ ${dep} が見つかりません (オプション)`);
      }
    }
  }

  /**
   * 単体テストのみ実行
   */
  async runUnitTestsOnly() {
    console.log('🧪 単体テスト実行中...');

    try {
      this.execCommand('npm run test:unit -- --coverage', this.verbose);
      console.log('✅ 単体テスト完了');
    } catch (error) {
      console.error('❌ 単体テスト失敗');
      throw error;
    }
  }

  /**
   * 全テスト実行
   */
  async runAllTests() {
    const testSuite = [
      { name: '単体テスト', command: 'npm run test:unit -- --coverage', required: true },
      { name: '統合テスト', command: 'npm run test:integration', required: true },
      { name: 'E2Eテスト', command: 'npm run test:e2e', required: false, skip: this.skipE2E },
      { name: 'パフォーマンステスト', command: 'npm run test:performance', required: false, skip: this.skipPerf }
    ];

    const results = [];

    for (const test of testSuite) {
      if (test.skip) {
        console.log(`⏭️ ${test.name}をスキップ`);
        continue;
      }

      console.log(`\n🧪 ${test.name}実行中...`);
      console.log('-' .repeat(40));

      const startTime = Date.now();
      let success = false;

      try {
        this.execCommand(test.command, this.verbose);
        success = true;
        const duration = Date.now() - startTime;
        console.log(`✅ ${test.name}完了 (${this.formatDuration(duration)})`);
      } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ ${test.name}失敗 (${this.formatDuration(duration)})`);
        
        if (test.required) {
          throw error;
        } else {
          console.log(`⚠️ ${test.name}は必須ではないため続行します`);
        }
      }

      results.push({
        name: test.name,
        success,
        duration: Date.now() - startTime
      });
    }

    // 結果サマリー表示
    this.printTestSummary(results);

    // 包括的レポート生成
    if (!this.onlyUnit) {
      console.log('\n📊 包括的テストレポート生成中...');
      try {
        await this.reporter.generateFullReport();
        console.log('✅ テストレポート生成完了');
      } catch (error) {
        console.error('⚠️ レポート生成エラー:', error.message);
      }
    }
  }

  /**
   * テスト結果サマリー表示
   */
  printTestSummary(results) {
    console.log('\n📋 テスト実行サマリー');
    console.log('=' .repeat(60));

    const totalTests = results.length;
    const passedTests = results.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;

    console.log(`総テストスイート数: ${totalTests}`);
    console.log(`成功: ${passedTests} ✅`);
    console.log(`失敗: ${failedTests} ${failedTests > 0 ? '❌' : ''}`);

    console.log('\n詳細:');
    results.forEach(result => {
      const status = result.success ? '✅' : '❌';
      const duration = this.formatDuration(result.duration);
      console.log(`  ${status} ${result.name.padEnd(20)} (${duration})`);
    });

    // カバレッジ情報表示
    this.printCoverageSummary();
  }

  /**
   * カバレッジサマリー表示
   */
  printCoverageSummary() {
    try {
      const coveragePath = path.join(this.projectRoot, 'tests/coverage/coverage-summary.json');
      const fs = require('fs');
      
      if (fs.existsSync(coveragePath)) {
        const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
        const total = coverage.total;

        console.log('\n📈 コードカバレッジ:');
        console.log(`  ステートメント: ${total.statements.pct}%`);
        console.log(`  ブランチ:     ${total.branches.pct}%`);
        console.log(`  関数:         ${total.functions.pct}%`);
        console.log(`  行:           ${total.lines.pct}%`);
      }
    } catch (error) {
      console.log('\n⚠️ カバレッジ情報を取得できませんでした');
    }
  }

  /**
   * コマンド実行ヘルパー
   */
  execCommand(command, showOutput = true) {
    try {
      const options = {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: showOutput ? 'inherit' : 'pipe'
      };

      if (this.verbose || showOutput) {
        console.log(`💻 実行: ${command}`);
      }

      return execSync(command, options);
    } catch (error) {
      if (!showOutput && this.verbose) {
        console.error('コマンド出力:', error.stdout || error.stderr);
      }
      throw error;
    }
  }

  /**
   * 時間フォーマット
   */
  formatDuration(ms) {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    }
  }

  /**
   * ヘルプ表示
   */
  static showHelp() {
    console.log(`
SafeVideo KYC テストランナー

使用方法:
  node tests/scripts/run-all-tests.js [オプション]

オプション:
  --unit-only         単体テストのみ実行
  --skip-e2e          E2Eテストをスキップ
  --skip-performance  パフォーマンステストをスキップ
  --verbose           詳細出力
  --help              このヘルプを表示

例:
  node tests/scripts/run-all-tests.js                    # 全テスト実行
  node tests/scripts/run-all-tests.js --unit-only        # 単体テストのみ
  node tests/scripts/run-all-tests.js --skip-e2e         # E2Eテスト以外を実行
  node tests/scripts/run-all-tests.js --verbose          # 詳細出力で実行
`);
  }
}

// スクリプト実行
if (require.main === module) {
  if (process.argv.includes('--help')) {
    TestRunner.showHelp();
    process.exit(0);
  }

  const runner = new TestRunner();
  runner.run().catch(error => {
    console.error('❌ 予期しないエラー:', error);
    process.exit(1);
  });
}

module.exports = TestRunner;