/**
 * Sharegram SSO テスト専用設定。
 *
 * tests/jest.config.js は setup.js 経由で MySQL と Redis を要求するが、
 * SSOのトークン交換ロジックは DB/Redis 無しで検証できる（モデルはモック）。
 * そのため独立した設定で実行する:  npm run test:sso
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: '../..',
  testMatch: ['**/tests/sso/*.test.js'],
  collectCoverage: false,
  testTimeout: 30000,
  verbose: true
};
