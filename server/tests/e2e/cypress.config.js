const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    // ベースURL
    baseUrl: 'http://localhost:3000',
    
    // テストファイルパターン
    specPattern: 'tests/e2e/**/*.cy.js',
    
    // サポートファイル
    supportFile: 'tests/e2e/support/e2e.js',
    
    // フィクスチャーフォルダ
    fixturesFolder: 'tests/e2e/fixtures',
    
    // スクリーンショット設定
    screenshotsFolder: 'tests/e2e/screenshots',
    screenshotOnRunFailure: true,
    
    // ビデオ設定
    videosFolder: 'tests/e2e/videos',
    video: true,
    videoCompression: 32,
    
    // ビューポート設定
    viewportWidth: 1280,
    viewportHeight: 720,
    
    // タイムアウト設定
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 30000,
    requestTimeout: 10000,
    responseTimeout: 30000,
    
    // リトライ設定
    retries: {
      runMode: 2,
      openMode: 0
    },
    
    // ブラウザ設定
    chromeWebSecurity: false,
    
    // 環境変数
    env: {
      apiUrl: 'http://localhost:3000/api',
      testUser: {
        email: 'test@example.com',
        password: 'TestPassword123!'
      },
      adminUser: {
        email: 'admin@example.com',
        password: 'AdminPassword123!'
      }
    },
    
    setupNodeEvents(on, config) {
      // タスク定義
      on('task', {
        // データベースリセット
        resetDatabase() {
          const { sequelize } = require('../../models');
          return sequelize.sync({ force: true });
        },
        
        // テストデータ作成
        async createTestData() {
          const TestDataGenerator = require('../utils/testDataGenerator');
          const generator = new TestDataGenerator();
          
          return await generator.createFullDataSet({
            userCount: 10,
            performerCount: 50,
            batchJobCount: 5,
            webhookCount: 3,
            apiLogCount: 100
          });
        },
        
        // API認証トークン取得
        async getAuthToken(credentials) {
          const request = require('supertest');
          const app = require('../../server');
          
          const response = await request(app)
            .post('/api/auth/login')
            .send(credentials);
            
          return response.body.token;
        },
        
        // ログ出力
        log(message) {
          console.log(message);
          return null;
        }
      });
      
      // ファイルアップロードサポート
      on('file:preprocessor', require('@cypress/webpack-preprocessor')({
        webpackOptions: {
          resolve: {
            extensions: ['.ts', '.js']
          },
          module: {
            rules: [
              {
                test: /\.ts$/,
                exclude: [/node_modules/],
                use: [
                  {
                    loader: 'ts-loader'
                  }
                ]
              }
            ]
          }
        }
      }));
      
      return config;
    }
  },
  
  component: {
    devServer: {
      framework: 'react',
      bundler: 'webpack'
    },
    specPattern: 'src/**/*.cy.{js,jsx,ts,tsx}'
  }
});