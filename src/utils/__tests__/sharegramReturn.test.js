/**
 * Sharegram の戻り先URL処理（SSOPage と AddPerformerPage が共通で使う）。
 * 実行: npx vitest run src/utils
 */
import { describe, it, expect } from 'vitest';
import { decodeComeBackUrl, isSafeReturnUrl, buildReturnUrl, takeEditReturnUrl, clearSsoContext } from '../sharegramReturn';

describe('decodeComeBackUrl', () => {
  it('returns null for empty or non-string input', () => {
    expect(decodeComeBackUrl(null)).toBeNull();
    expect(decodeComeBackUrl('')).toBeNull();
    expect(decodeComeBackUrl(undefined)).toBeNull();
    expect(decodeComeBackUrl(42)).toBeNull();
  });

  it('leaves an already-decoded URL untouched', () => {
    expect(decodeComeBackUrl('http://localhost:3000/posts/new'))
      .toBe('http://localhost:3000/posts/new');
  });

  it('decodes the double encoding Sharegram sometimes sends', () => {
    const double = encodeURIComponent(encodeURIComponent('http://share-gram.com/posts/new?a=1'));
    expect(decodeComeBackUrl(double)).toBe('http://share-gram.com/posts/new?a=1');
  });

  it('does not throw on a malformed percent sequence', () => {
    expect(decodeComeBackUrl('http://x.test/a%')).toBe('http://x.test/a%');
  });
});

describe('isSafeReturnUrl', () => {
  it('accepts http and https only', () => {
    expect(isSafeReturnUrl('http://localhost:3000/posts/new')).toBe(true);
    expect(isSafeReturnUrl('https://share-gram.com/posts/new')).toBe(true);
    expect(isSafeReturnUrl('/posts/new')).toBe(false);          // 相対は location.href に使わない
    expect(isSafeReturnUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeReturnUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isSafeReturnUrl('not a url')).toBe(false);
    expect(isSafeReturnUrl(null)).toBe(false);
  });
});

describe('buildReturnUrl', () => {
  it('appends the performer id and status for the Sharegram handoff', () => {
    const url = buildReturnUrl('http://localhost:3000/posts/new', { performer_id: 42, status: 'created' });
    expect(url).toBe('http://localhost:3000/posts/new?performer_id=42&status=created');
  });

  it('decodes a double-encoded value before use', () => {
    const raw = encodeURIComponent('http%3A%2F%2Fshare-gram.com%2Fposts%2Fnew');
    expect(buildReturnUrl(raw, {})).toBe('http://share-gram.com/posts/new');
  });

  it('skips missing params instead of writing "undefined"', () => {
    expect(buildReturnUrl('https://share-gram.com/posts/new', { performer_id: undefined, status: 'created' }))
      .toBe('https://share-gram.com/posts/new?status=created');
  });

  it('returns null for anything unsafe so the caller can fall back', () => {
    expect(buildReturnUrl('/posts/new', { performer_id: 1 })).toBeNull();
    expect(buildReturnUrl('javascript:alert(1)', {})).toBeNull();
    expect(buildReturnUrl(null, {})).toBeNull();
  });
});

/** sessionStorage と同じ API の最小実装（テストごとに作り直す） */
const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()]
  };
};

describe('takeEditReturnUrl (SSO action=edit, spec 3.3)', () => {
  const ssoEdit = (performerId, comeBackUrl = 'http://localhost:3000/performers/2') =>
    memoryStorage({
      sharegram_action: 'edit',
      sharegram_performer_id: String(performerId),
      sharegram_come_back_url: comeBackUrl
    });

  it('returns to come_back_url with performer_id and status=updated after saving the requested performer', () => {
    const storage = ssoEdit(2);
    expect(takeEditReturnUrl(storage, 2))
      .toBe('http://localhost:3000/performers/2?performer_id=2&status=updated');
    expect(storage.keys()).toEqual([]); // SSO の依頼は完了。値を残さない
  });

  it('matches the id whether the route gives a string or a number', () => {
    expect(takeEditReturnUrl(ssoEdit('2'), '2')).toContain('performer_id=2');
  });

  it('stays in KYC when a different performer was edited (stale come_back_url must not be used)', () => {
    const storage = ssoEdit(2);
    expect(takeEditReturnUrl(storage, 5)).toBeNull();
    expect(storage.getItem('sharegram_come_back_url')).not.toBeNull();
  });

  it('stays in KYC when the SSO was for create, or there was no SSO at all', () => {
    expect(takeEditReturnUrl(memoryStorage({ sharegram_action: 'create', sharegram_come_back_url: 'http://localhost:3000/x' }), 2)).toBeNull();
    expect(takeEditReturnUrl(memoryStorage(), 2)).toBeNull();
  });

  it('does not navigate to an unsafe come_back_url, and still clears the finished SSO request', () => {
    const storage = ssoEdit(2, 'javascript:alert(1)');
    expect(takeEditReturnUrl(storage, 2)).toBeNull();
    expect(storage.keys()).toEqual([]);
  });

  it('accepts the double-encoded come_back_url Sharegram may send', () => {
    const storage = ssoEdit(2, encodeURIComponent('http://localhost:3000/performers/2?tab=kyc'));
    expect(takeEditReturnUrl(storage, 2))
      .toBe('http://localhost:3000/performers/2?tab=kyc&performer_id=2&status=updated');
  });
});

describe('clearSsoContext', () => {
  it('removes every SSO key so a later KYC-internal edit does not jump back to Sharegram', () => {
    const storage = memoryStorage({
      sharegram_action: 'create',
      sharegram_performer_id: '9',
      sharegram_come_back_url: 'http://localhost:3000/posts/new',
      unrelated: 'keep'
    });
    clearSsoContext(storage);
    expect(storage.keys()).toEqual(['unrelated']);
  });
});
