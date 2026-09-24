/**
 * Sharegram アカウント情報サービス
 *
 * Sharegram の Firebase ID Token には email しか入っていないことが多い
 * （sign_in_provider: custom / password）。それだけだと id-manager 側の
 * ユーザー名が "hana@gmail.com" の "hana" になってしまう。
 *
 * そこで、
 *   1) トークンに載っている追加クレーム（account_name など）を読む
 *   2) 設定されている場合のみ Sharegram のアカウントAPIから補完する
 * の2段構えで表示名を組み立てる。
 *
 * (2) は任意機能。SHAREGRAM_ACCOUNT_API_URL / SHAREGRAM_API_KEY が
 * 未設定なら何もしない（SSOは必ず成功する）。取得に失敗しても
 * ログインを止めないこと。
 */

const axios = require('axios');

const getConfig = () => ({
  baseUrl: (process.env.SHAREGRAM_ACCOUNT_API_URL || '').replace(/\/+$/, ''),
  path: process.env.SHAREGRAM_ACCOUNT_PATH || '/accounts/search',
  apiKey: process.env.SHAREGRAM_API_KEY || '',
  timeoutMs: Number(process.env.SHAREGRAM_ACCOUNT_TIMEOUT_MS || 5000)
});

/**
 * Sharegram API連携が設定されているか
 * @returns {boolean}
 */
const isConfigured = () => {
  const config = getConfig();
  return Boolean(config.baseUrl && config.apiKey);
};

const cleanString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

// users.profilePicture は STRING(512)。Sharegram が返す avatar は
// 暗号化された長文（数KB）でURLですらないため、そのまま入れると
//   Error [MySQL]: Data too long for column 'profilePicture'
// でユーザー作成そのものが失敗する（＝SSO失敗）。URLらしさ+長さで絞る。
const PROFILE_PICTURE_MAX_LENGTH = 512;
const HTTP_URL = /^https?:\/\/\S+$/i;

/**
 * 画像として保存してよい URL か（data: / 暗号化文字列は false）
 * @param {unknown} value
 * @returns {boolean}
 */
const isUsableImageUrl = (value) =>
  typeof value === 'string' && HTTP_URL.test(value.trim());

/**
 * Users.profilePicture に入る形に整える。条件を満たさなければ null。
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string|null}
 */
const safeProfilePicture = (value, maxLength = PROFILE_PICTURE_MAX_LENGTH) => {
  if (!isUsableImageUrl(value)) return null;
  const url = value.trim();
  return url.length <= maxLength ? url : null;
};

/**
 * Sharegram API のレスポンス（{success, data:{...}} 形式）を正規化する
 * @param {Object} payload
 * @returns {Object|null}
 */
const normalizeAccount = (payload) => {
  const data = payload?.data ?? payload;
  if (!data || typeof data !== 'object') return null;

  const account = {
    sharegramUserId: data.id !== undefined && data.id !== null ? String(data.id) : null,
    accountId: cleanString(data.account_id),
    accountName: cleanString(data.account_name),
    firstName: cleanString(data.first_name),
    lastName: cleanString(data.last_name),
    email: cleanString(data.email),
    avatar: safeProfilePicture(data.avatar)
  };

  const hasAnything = Object.values(account).some((value) => value !== null);
  return hasAnything ? account : null;
};

/**
 * メールアドレスから Sharegram アカウントを検索する（任意機能）
 * @param {string} email
 * @returns {Promise<Object|null>} 見つからない/未設定/失敗時は null
 */
const findAccountByEmail = async (email) => {
  const address = cleanString(email);
  if (!address || !isConfigured()) return null;

  const config = getConfig();

  try {
    const response = await axios.get(`${config.baseUrl}${config.path}`, {
      params: { email: address },
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: 'application/json'
      },
      timeout: config.timeoutMs
    });

    return normalizeAccount(response.data);
  } catch (error) {
    // Sharegram が落ちてもSSOは成功させたいので、ログだけ出して null
    console.warn('Sharegram account lookup failed (continuing without it):', error.message);
    return null;
  }
};

/**
 * Firebase ID Token のクレームからSharegramアカウント情報を読む
 * Sharegramがカスタムクレームを載せてくれた場合はAPI不要で名前が取れる。
 * @param {Object} claims - verifyIdToken の結果
 * @returns {Object|null}
 */
const fromTokenClaims = (claims) => {
  if (!claims || typeof claims !== 'object') return null;
  return normalizeAccount({
    id: claims.sharegram_user_id ?? claims.sharegramUserId ?? null,
    account_id: claims.account_id ?? claims.accountId ?? null,
    account_name: claims.account_name ?? claims.accountName ?? null,
    first_name: claims.first_name ?? claims.firstName ?? null,
    last_name: claims.last_name ?? claims.lastName ?? null,
    email: claims.email ?? null,
    avatar: safeProfilePicture(claims.picture ?? claims.avatar)
  });
};

/**
 * 表示名を組み立てる（account_name → "first last" の順）
 * @param {Object|null} account
 * @returns {string|null}
 */
const displayName = (account) => {
  if (!account) return null;
  if (account.accountName) return account.accountName;
  const full = [account.firstName, account.lastName].filter(Boolean).join(' ').trim();
  return full.length > 0 ? full : null;
};

module.exports = {
  isConfigured,
  isUsableImageUrl,
  safeProfilePicture,
  PROFILE_PICTURE_MAX_LENGTH,
  findAccountByEmail,
  fromTokenClaims,
  displayName,
  normalizeAccount
};
