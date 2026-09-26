/**
 * アクセストークン（JWT）の保管場所を 1 箇所にまとめる。
 *
 * 【なぜ必要か】
 * 同じ「access token」を、保存する側と読む側でキー名が食い違っていた。
 *   - SecureApiClient / auth.js / SSOPage … localStorage['accessToken']
 *   - services/api.js（/auth/refresh の成功時）… localStorage['token']
 * そのためリフレッシュが 200 で成功しても、他の全リクエストは古い（または無い）
 * 'accessToken' を送り続け、401 が止まらない状態になっていた。
 *
 * ここを唯一の出入口にすることで、書き込み側と読み込み側のズレを構造的に防ぐ。
 * 旧キー 'token' は読み込み時に 'accessToken' へ移行する（書いた直後に消さないのは、
 * 古いタブが残っている間に読めなくなるのを避けるため）。
 */

const PRIMARY_KEY = 'accessToken';
const LEGACY_KEYS = ['token'];

/** localStorage が無い環境（SSR・プライベートモード等）用のフォールバック */
let memoryToken = null;

const getStorage = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch (e) {
    // セキュリティ設定で localStorage 参照自体が例外になる場合がある
  }
  return null;
};

/**
 * 保存済みのアクセストークンを返す（無ければ null）。
 * 旧キーにしか無い場合は新しいキーへ移行してから返す。
 */
export function getAccessToken() {
  const storage = getStorage();
  if (!storage) return memoryToken;

  try {
    const primary = storage.getItem(PRIMARY_KEY);
    if (primary) return primary;

    for (const legacyKey of LEGACY_KEYS) {
      const legacy = storage.getItem(legacyKey);
      if (legacy) {
        storage.setItem(PRIMARY_KEY, legacy);
        return legacy;
      }
    }
  } catch (e) {
    console.warn('[authToken] トークンの読み込みに失敗:', e.message);
  }

  return memoryToken;
}

/** アクセストークンを保存する。null/undefined を渡した場合は何もしない。 */
export function setAccessToken(token) {
  if (typeof token !== 'string' || token === '') return;

  memoryToken = token;
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(PRIMARY_KEY, token);
  } catch (e) {
    console.warn('[authToken] トークンの保存に失敗:', e.message);
  }
}

/** アクセストークンを破棄する（ログアウト・認証失効時）。 */
export function clearAccessToken() {
  memoryToken = null;
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(PRIMARY_KEY);
    LEGACY_KEYS.forEach((key) => storage.removeItem(key));
  } catch (e) {
    console.warn('[authToken] トークンの削除に失敗:', e.message);
  }
}

export const ACCESS_TOKEN_KEY = PRIMARY_KEY;
export const LEGACY_ACCESS_TOKEN_KEYS = LEGACY_KEYS;
