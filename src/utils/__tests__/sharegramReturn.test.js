/**
 * Sharegram の戻り先URL処理（SSOPage と AddPerformerPage が共通で使う）。
 * 実行: npx vitest run src/utils
 */
import { describe, it, expect } from 'vitest';
import { decodeComeBackUrl, isSafeReturnUrl, buildReturnUrl } from '../sharegramReturn';

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
