/**
 * /sso に届く Firebase ID Token の取り出し（src/utils/ssoToken.js）。
 *
 * 実際の障害: `http://localhost:3300/sso?come_back=...&action=create` のように
 * token が付かずに届き、画面は「Firebase ID Tokenが指定されていません」だけを
 * 出していた。どの形なら拾えるのか／拾えないときに何と言うのかを固定する。
 * 実行: npx vitest run src/utils
 */
import { describe, it, expect, vi } from 'vitest';
import { extractSsoToken, looksLikeJwt, TOKEN_PARAM_NAMES } from '../ssoToken';

// JWT の形をしたダミー（3 要素・十分な長さ）
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJ1aWQiOiJhYmMxMjMifQ.signature_part_123456';

describe('looksLikeJwt', () => {
  it('accepts a JWT-shaped value', () => {
    expect(looksLikeJwt(JWT)).toBe(true);
  });

  it('rejects empty, short and placeholder values', () => {
    expect(looksLikeJwt('')).toBe(false);
    expect(looksLikeJwt(null)).toBe(false);
    expect(looksLikeJwt('undefined')).toBe(false);
    expect(looksLikeJwt('null')).toBe(false);
    expect(looksLikeJwt('short')).toBe(false);
    expect(looksLikeJwt('<html>error</html>')).toBe(false);
  });
});

describe('extractSsoToken', () => {
  it('finds ?token= (the documented contract)', () => {
    const result = extractSsoToken({ search: `?token=${JWT}&action=create` });
    expect(result.token).toBe(JWT);
    expect(result.source).toBe('query');
    expect(result.paramName).toBe('token');
    expect(result.reason).toBeNull();
  });

  it('finds the camelCase / snake_case aliases', () => {
    TOKEN_PARAM_NAMES.slice(1).forEach((name) => {
      const result = extractSsoToken({ search: `?${name}=${JWT}` });
      expect(result.token).toBe(JWT);
      expect(result.paramName).toBe(name);
    });
  });

  it('finds a token in the hash (#token=...)', () => {
    const result = extractSsoToken({ search: '?action=create', hash: `#token=${JWT}` });
    expect(result.token).toBe(JWT);
    expect(result.source).toBe('hash');
  });

  it('finds a token inside a hash route (#/sso?token=...)', () => {
    const result = extractSsoToken({ hash: `#/sso?token=${JWT}&action=create` });
    expect(result.token).toBe(JWT);
    expect(result.source).toBe('hash');
  });

  it('decodes a percent-encoded token', () => {
    const result = extractSsoToken({ search: `?token=${encodeURIComponent(JWT)}` });
    expect(result.token).toBe(JWT);
  });

  it('prefers the query token over a stale hash token', () => {
    const stale = 'aaaa.bbbb.cccc_stale_value_long_enough';
    const result = extractSsoToken({ search: `?token=${JWT}`, hash: `#token=${stale}` });
    expect(result.token).toBe(JWT);
  });

  it('reports "missing" and the received parameter names when no token is present (the reported bug)', () => {
    const result = extractSsoToken({
      search: '?come_back=http%253A%252F%252Flocalhost%253A3000%252Fposts%252Fnew&action=create',
      hash: ''
    });
    expect(result.token).toBeNull();
    expect(result.reason).toBe('missing');
    expect(result.receivedParamNames).toEqual(['come_back', 'action']);
  });

  it('reports "malformed" when a token parameter exists but is not a JWT', () => {
    const result = extractSsoToken({ search: '?token=undefined&action=create' });
    expect(result.token).toBeNull();
    expect(result.reason).toBe('malformed');
  });

  it('accepts unsigned emulator tokens only in emulator mode or on the localhost emulator project', () => {
    const emulatorToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJhdWQiOiJkZW1vLWt5Yy1sb2NhbCJ9.';
    vi.stubEnv('REACT_APP_USE_FIREBASE_EMULATOR', 'false');
    vi.stubGlobal('window', { location: { hostname: 'app.example.com' } });
    expect(extractSsoToken({ search: `?token=${emulatorToken}` }).reason).toBe('malformed');
    vi.stubEnv('REACT_APP_USE_FIREBASE_EMULATOR', 'true');
    expect(extractSsoToken({ search: `?token=${emulatorToken}` }).token).toBe(emulatorToken);
    vi.stubEnv('REACT_APP_USE_FIREBASE_EMULATOR', 'false');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('window', { location: { hostname: 'app.example.com' } });
    expect(extractSsoToken({ search: `?token=${emulatorToken}` }).reason).toBe('malformed');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    expect(extractSsoToken({ search: `?token=${emulatorToken}` }).token).toBe(emulatorToken);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not blow up on an empty location', () => {
    expect(extractSsoToken({ search: '', hash: '' }).token).toBeNull();
    expect(extractSsoToken({}).token).toBeNull();
  });
});
