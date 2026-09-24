/**
 * Sharegram の come_back（戻り先URL）を扱う共通ロジック。
 *
 * 【なぜ utils に切り出すか】
 * 以前は SSOPage.jsx がデコード処理をインラインで持ち、AddPerformerPage.jsx は
 * sessionStorage の値を `new URL()` にそのまま渡していた。後者は Sharegram が
 * 相対パス（/posts/new）や壊れたエンコードを送ると例外になり、
 * 「登録は成功したのに赤いエラーが出て Sharegram に戻れない」になる。
 * 判定を1箇所に寄せることで、SSO画面と登録画面で挙動を揃える。
 */

/** Sharegram は二重に URL エンコードしてくることがある（%253A → %3A → :）。 */
export function decodeComeBackUrl(raw, { maxPass = 3 } = {}) {
  if (typeof raw !== 'string' || raw === '') return null;
  let value = raw;
  for (let i = 0; i < maxPass; i += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch (e) {
      break; // % で終わる不正な文字列など
    }
    if (decoded === value) break;
    value = decoded;
  }
  return value;
}

/**
 * 遷移してよい URL か。このアプリが window.location.href に使って良いのは
 * http / https だけ（javascript:, data:, vbscript: などは XSS になる）。
 * 相対パスは Sharegram のものかどうか判定できないため許可しない。
 */
export function isSafeReturnUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  let url;
  try {
    url = new URL(value);
  } catch (e) {
    return false; // 相対パス・不正文字列
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/**
 * 戻り先を「使える形」にする。安全でなければ null（呼び出し側がフォールバックを決める）。
 * @param {string|null} raw     sessionStorage / query に残っている生の値
 * @param {Object} [params]     付与する検索パラメータ（performer_id, status など）
 * @returns {string|null}
 */
export function buildReturnUrl(raw, params = {}) {
  const decoded = decodeComeBackUrl(raw);
  if (!isSafeReturnUrl(decoded)) return null;

  const url = new URL(decoded);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}
