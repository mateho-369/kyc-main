/**
 * Sharegram SSO の Firebase ID Token を URL から取り出す。
 *
 * 【なぜ複数の形を許すか】
 * 仕様書（API_DOCUMENTATION_SHAREGRAM.md §3.3）は
 *   /sso?token={Firebase_ID_Token}&action=create&come_back_url=...
 * とだけ定めており、送信側の実装は Sharegram 側にある。実際に届くURLは
 *   - クエリ ?token= / ?id_token= / ?idToken= ...
 *   - ハッシュ #token=... （Firebase のリダイレクト系でよくある）
 *   - 「#」の中にクエリを丸ごと入れた #/sso?token=...
 * のように揺れるため、取り出しロジックを 1 箇所にまとめてテスト可能にする。
 *
 * 【取り出せなかった理由も返す】
 * 「token が無い」のか「token らしくない値（undefined 文字列・HTMLなど）が入っている」
 * のかで、利用者に見せるべき案内が変わる。デバッグ表示のために、
 * 受け取ったパラメータ名の一覧も返す（値そのものは返さない）。
 */

/** クエリ／ハッシュで受け付ける名前（優先順）。 */
export const TOKEN_PARAM_NAMES = [
  'token',
  'id_token',
  'idToken',
  'idtoken',
  'firebase_token',
  'firebaseToken',
  'access_token',
  'accessToken'
];

const REJECTED_LITERALS = ['undefined', 'null', 'none', 'false', 'true'];

/**
 * Firebase ID Token（＝JWT）らしい形か。
 * JWT は `header.payload.signature` の 3 要素。Sharegram がカスタムトークンを
 * 使う場合も同じ形なので、ここでは「JWT の形をしているか」だけを見る。
 */
export function looksLikeJwt(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 20) return false;
  if (REJECTED_LITERALS.includes(trimmed.toLowerCase())) return false;
  const signedJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed);
  if (signedJwt) return true;

  // The Firebase Auth Emulator can issue unsigned ID-token-shaped JWTs (alg:none,
  // empty signature). Permit that shape only in explicit local emulator mode; the
  // backend emulator verifier remains responsible for validating the token.
  const emulatorMode = typeof process !== 'undefined'
    && process.env.REACT_APP_USE_FIREBASE_EMULATOR === 'true';
  return emulatorMode && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.$/.test(trimmed);
}

const safeDecode = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch (e) {
    return value; // % が孤立しているなど
  }
};

/**
 * search / hash をそれぞれ URLSearchParams にする。
 * hash が `#/sso?token=...`（クエリ込み）でも `#token=...` でも動く。
 */
const paramsFrom = (search = '', hash = '') => {
  const query = new URLSearchParams(typeof search === 'string' ? search : '');
  const hashValue = typeof hash === 'string' ? hash.replace(/^#/, '') : '';

  let hashQuery = new URLSearchParams();
  if (hashValue) {
    // `#/sso?token=...` はクエリ部分だけを、`#token=...` はハッシュ全体を使う。
    // `#/sso`（クエリ無しのハッシュルート）はパラメータを持たない。
    const queryPart = hashValue.includes('?')
      ? hashValue.slice(hashValue.indexOf('?') + 1)
      : (hashValue.startsWith('/') ? '' : hashValue);
    hashQuery = new URLSearchParams(queryPart);
  }

  return { query, hashQuery };
};

/**
 * URL から Firebase ID Token を取り出す。
 *
 * @param {{ search?: string, hash?: string }} locationLike 既定は window.location
 * @returns {{
 *   token: string|null,
 *   source: 'query'|'hash'|'firebase'|null,
 *   paramName: string|null,
 *   reason: 'missing'|'malformed'|null,
 *   receivedParamNames: string[]
 * }}
 */
export function extractSsoToken(locationLike = {}) {
  const search = locationLike.search !== undefined
    ? locationLike.search
    : (typeof window !== 'undefined' ? window.location.search : '');
  const hash = locationLike.hash !== undefined
    ? locationLike.hash
    : (typeof window !== 'undefined' ? window.location.hash : '');

  const { query, hashQuery } = paramsFrom(search, hash);
  const receivedParamNames = Array.from(new Set([...query.keys(), ...hashQuery.keys()]));

  let sawCandidate = false;
  let candidateWasMalformed = false;

  const containers = [['query', query], ['hash', hashQuery]];

  for (const [source, params] of containers) {
    for (const name of TOKEN_PARAM_NAMES) {
      const raw = params.get(name);
      if (raw === null) continue;

      sawCandidate = true;
      const value = safeDecode(raw).trim();

      if (looksLikeJwt(value)) {
        return {
          token: value,
          source,
          paramName: name,
          reason: null,
          receivedParamNames
        };
      }
      candidateWasMalformed = true;
    }
  }

  return {
    token: null,
    source: null,
    paramName: null,
    reason: sawCandidate && candidateWasMalformed ? 'malformed' : 'missing',
    receivedParamNames
  };
}
