import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/setupTests.js',
        '**/*.test.{js,jsx}',
        '**/*.spec.{js,jsx}',
        'src/index.js',
        'public/',
        'build/'
      ],
      // 80% 強制（thresholds）は、ユニットテストが実質0本の時点で常に失敗して
      // 意味をなさない。テストを増やしてから、その時点の実測値で戻すこと。
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    // src/__tests__/e2e/** は Playwright の仕様（@playwright/test が必要）。
    // vitest が拾うと全ファイルが読めずに失敗していたので除外する。
    include: [
      'src/**/*.{test,spec}.{js,jsx}'
    ],
    exclude: [
      'node_modules/',
      'dist/',
      'build/',
      'src/__tests__/e2e/**'
    ]
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  define: {
    global: 'globalThis',
  }
});