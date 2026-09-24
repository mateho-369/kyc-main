/**
 * vitest のセットアップ（vitest.config.js の setupFiles から読まれる）。
 * このファイルが無かったため、テストは実行前に全ファイル読込失敗していた。
 */
import '@testing-library/jest-dom';
