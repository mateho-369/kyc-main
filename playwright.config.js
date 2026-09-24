import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/__tests__/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/e2e-results.json' }],
    ['junit', { outputFile: 'test-results/e2e-results.xml' }]
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  webServer: [
    {
      command: 'npm start',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 120000
    },
    {
      command: 'npm run start:server',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 60000
    }
  ],

  // テスト実行前の準備
  globalSetup: require.resolve('./src/__tests__/e2e/global-setup.js'),
  globalTeardown: require.resolve('./src/__tests__/e2e/global-teardown.js'),

  // 期待値
  expect: {
    timeout: 10000,
    toHaveScreenshot: { 
      threshold: 0.2, 
      maxDiffPixels: 1000 
    },
    toMatchSnapshot: { 
      threshold: 0.2 
    }
  },

  // テスト設定
  timeout: 60000,
  testMatch: '**/*.e2e.{js,ts}',
  
  // 環境変数
  globalSetupTimeout: 120000,
  globalTeardownTimeout: 60000
});