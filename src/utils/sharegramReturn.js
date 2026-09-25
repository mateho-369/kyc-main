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

const SSO_KEYS = ['sharegram_come_back_url', 'sharegram_action', 'sharegram_performer_id'];

/**
 * SSO（action=edit）で依頼された出演者の編集を保存したあとの戻り先。
 * 仕様（API_DOCUMENTATION_SHAREGRAM.md 3.3）: 操作完了後、come_back_url があればそこへ戻す。
 *
 * SSO で編集を頼まれた「その出演者」を保存したときだけ Sharegram に戻す。
 * （管理者が KYC 内で別の出演者を編集したときに、古い come_back_url へ飛ばないように）
 * 対象の編集が終わったら SSO 用の sessionStorage は片付ける。
 *
 * @param {Storage} storage   sessionStorage
 * @param {string|number} performerId  保存した出演者の ID
 * @returns {string|null}     戻り先URL（performer_id / status=updated 付き）。戻さない場合は null
 */
export function takeEditReturnUrl(storage, performerId) {
  if (!storage || performerId === undefined || performerId === null) return null;
  const action = storage.getItem('sharegram_action');
  const requestedId = storage.getItem('sharegram_performer_id');
  if (action !== 'edit' || !requestedId || String(requestedId) !== String(performerId)) return null;

  const returnTo = buildReturnUrl(storage.getItem('sharegram_come_back_url'), {
    performer_id: performerId,
    status: 'updated'
  });
  // SSO で頼まれた編集はこれで完了。戻り先が壊れていても値は残さない
  SSO_KEYS.forEach((key) => storage.removeItem(key));
  return returnTo;
}

/** 新規登録で Sharegram に戻したあとに、SSO 用の値を残さない */
export function clearSsoContext(storage) {
  if (!storage) return;
  SSO_KEYS.forEach((key) => storage.removeItem(key));
}
