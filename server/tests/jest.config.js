module.exports = {
  // テスト環境
  testEnvironment: 'node',
  
  // テストファイルパターン
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],
  
  // カバレッジ設定
  collectCoverage: true,
  collectCoverageFrom: [
    '../routes/**/*.js',
    '../middleware/**/*.js',
    '../models/**/*.js',
    '../services/**/*.js',
    '../utils/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
    '!**/coverage/**',
    '!../server.js'
  ],
  coverageDirectory: 'tests/coverage',
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov',
    'json'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  
  // セットアップファイル
  setupFilesAfterEnv: [
    '<rootDir>/setup.js'
  ],
  
  // テストタイムアウト
  testTimeout: 30000,
  
  // 詳細出力
  verbose: true,
  
  // 並列実行
  maxWorkers: '50%',
  
  // モック設定
  clearMocks: true,
  restoreMocks: true,
  
  // トランスフォーム設定（ES6対応）
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  
  // モジュールパス
  moduleDirectories: [
    'node_modules',
    '<rootDir>/..'
  ],
  
  // グローバル設定
  globals: {
    'ts-jest': {
      useESM: true
    }
  },
  
  // レポーター設定
  reporters: [
    'default'
  ]
};