/**
 * API ベース URL の決定規則（src/services/api.js と SecureApiClient.js が共有する）。
 * 以前は両者が別の既定値を持っていたので、そこを固定するテスト。
 * 実行: npx vitest run src/config
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const load = async (env) => {
  vi.resetModules();
  if (env === undefined) delete process.env.REACT_APP_API_URL;
  else process.env.REACT_APP_API_URL = env;
  return import('../apiBase');
};

describe('apiBase', () => {
  const originalUrl = process.env.REACT_APP_API_URL;
  const originalEnv = process.env.NODE_ENV;
  let warn;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => {
    warn.mockRestore();
    process.env.REACT_APP_API_URL = originalUrl;
    process.env.NODE_ENV = originalEnv;
  });

  it('uses REACT_APP_API_URL and strips a trailing slash', async () => {
    const mod = await load('http://localhost:5000/api/');
    expect(mod.API_BASE_URL).toBe('http://localhost:5000/api');
  });

  it('falls back to the relative /api so the dev proxy / nginx keeps working', async () => {
    process.env.NODE_ENV = 'production';
    const mod = await load(undefined);
    expect(mod.API_BASE_URL).toBe('/api');
    expect(mod.default).toBe('/api');
  });

  it('warns in development when the URL is not configured', async () => {
    process.env.NODE_ENV = 'development';
    const mod = await load(undefined);
    expect(mod.API_BASE_URL).toBe('/api');
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn.mock.calls[0][0]).toMatch(/REACT_APP_API_URL/);
  });

  it('does not warn when it is configured', async () => {
    process.env.NODE_ENV = 'development';
    await load('http://localhost:5000/api');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('apiUrl() joins paths with or without a leading slash', async () => {
    const mod = await load('http://localhost:5000/api');
    expect(mod.apiUrl('/auth/me')).toBe('http://localhost:5000/api/auth/me');
    expect(mod.apiUrl('auth/me')).toBe('http://localhost:5000/api/auth/me');
    expect(mod.apiUrl()).toBe('http://localhost:5000/api');
  });
});
