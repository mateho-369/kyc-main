import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    include: [
      'src/__tests__/integration/**/*.test.js'
    ],
    exclude: [
      'node_modules/',
      'dist/',
      'build/',
      'src/**/*.{test,spec}.{js,jsx}',
      'src/__tests__/unit/**/*',
      'src/__tests__/components/**/*'
    ],
    setupFiles: ['./src/setupIntegrationTests.js'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage/integration',
      exclude: [
        'node_modules/',
        'src/setupTests.js',
        'src/setupIntegrationTests.js',
        'public/',
        'build/'
      ]
    }
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