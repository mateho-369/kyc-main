/**
 * アクセストークンの保存キー統一（src/utils/authToken.js）。
 *
 * 背景: /auth/refresh は localStorage['token'] に書き、他の全リクエストは
 * localStorage['accessToken'] を読んでいた。リフレッシュが成功しても 401 が
 * 止まらない状態を二度と作らないためのテスト。
 * 実行: npx vitest run src/utils
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getAccessToken, setAccessToken, clearAccessToken } from '../authToken';

describe('authToken', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing is stored', () => {
    expect(getAccessToken()).toBeNull();
  });

  it('stores and reads back under the single canonical key', () => {
    setAccessToken('jwt-abc');
    expect(localStorage.getItem('accessToken')).toBe('jwt-abc');
    expect(getAccessToken()).toBe('jwt-abc');
  });

  it('ignores empty / non-string writes instead of wiping a good token', () => {
    setAccessToken('jwt-abc');
    setAccessToken('');
    setAccessToken(null);
    setAccessToken(undefined);
    expect(getAccessToken()).toBe('jwt-abc');
  });

  it('migrates a token left in the legacy "token" key', () => {
    localStorage.setItem('token', 'legacy-jwt');
    expect(getAccessToken()).toBe('legacy-jwt');
    // 移行後は新しいキーからも読める（古いタブの読み取りも壊さない）
    expect(localStorage.getItem('accessToken')).toBe('legacy-jwt');
  });

  it('prefers the canonical key over the legacy one', () => {
    localStorage.setItem('token', 'stale-jwt');
    localStorage.setItem('accessToken', 'fresh-jwt');
    expect(getAccessToken()).toBe('fresh-jwt');
  });

  it('clears both keys on logout', () => {
    localStorage.setItem('accessToken', 'jwt-abc');
    localStorage.setItem('token', 'jwt-old');
    clearAccessToken();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});
