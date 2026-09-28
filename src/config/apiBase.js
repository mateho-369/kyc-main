/** Shared API base: relative /api uses the local CRA proxy in development
 * and the same-origin reverse proxy in production. Never defaults to staging.
 * Use /api for cookie authentication; do not point browser calls at another port.
 */

const normalize = (value) => String(value || '').trim().replace(/\/+$/, '');

const configured = normalize(process.env.REACT_APP_API_URL);

/** 設定済みならそれ、無ければ dev proxy / 同一オリジンに委ねる。 */
export const API_BASE_URL = configured || '/api';

/** 認証系など、ベース URL を又ぎいで fetch する箇所のための helper。 */
export const apiUrl = (path = '') => {
  const clean = String(path || '').trim();
  if (clean === '') return API_BASE_URL;
  return `${API_BASE_URL}${clean.startsWith('/') ? clean : `/${clean}`}`;
};

let warned = false;
const warnOnce = () => {
  if (warned || process.env.NODE_ENV !== 'development' || configured || typeof window === 'undefined') return;
  warned = true;
  /* eslint-disable no-console */
  console.warn(
    '[apiBase] REACT_APP_API_URL が未設定です。/api への要求は package.json の proxy 向け ' +
    '（開発中はローカル port 5000）に送信されます。ローカルAPIを叩くには .env に ' +
    'REACT_APP_API_URL=/api を設定して npm start し直してください。'
  );
  /* eslint-enable no-console */
};
warnOnce();

export default API_BASE_URL;
