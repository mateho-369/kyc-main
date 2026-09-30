/**
 * vitest のセットアップ（vitest.config.js の setupFiles から読まれる）。
 * このファイルが無かったため、テストは実行前に全ファイル読込失敗していた。
 */
import '@testing-library/jest-dom';

// Register per test context, including reused Vitest forks.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => cleanup());
