/**
 * API のベース URL を決める唯一の場所。
 *
 * 【なぜ 1 箇所にまとめるか】
 * 以前は services/api.js が `http://localhost:5002/api` を既定に、
 * services/SecureApiClient.js が `/api`（= CRA の dev proxy）を既定にしていました。
 * 同じ「API」を指しながら既定値が違うため、開発中だけで見ると
 * 画面によって実態が「ローカルAPI」だったり「stg.id-manager.com（別のDB）」だったりした。
 * ここに両クライアントが同じ場所を向くようにする。
 *
 * 【決まり方】
 *   1. REACT_APP_API_URL が設定されていれば、それが絶対（本番・staging・ローカル共）
 *   2. 無ければ相対 '/api' → dev では package.json の proxy、本番では同一ドメインの nginx
 *
 * 【ローカルAPIを叩きたい場合】
 *   .env（または .env.local）に 1 行:
 *     REACT_APP_API_URL=http://localhost:5000/api     # cd server && npm start の場合
 *     REACT_APP_API_URL=http://localhost:5002/api     # docker-compose の場合
 *   ※ プロキシ経由('/api')でも動くが、その場合のリクエスト先は package.json の
 *   　 proxy であって、ローカル立ち上げ中の server ではありません。
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
    '（開発中は stg.id-manager.com）に送信されます。ローカルAPIを叩くには .env に ' +
    'REACT_APP_API_URL=http://localhost:5000/api を設定して npm start し直してください。'
  );
  /* eslint-enable no-console */
};
warnOnce();

export default API_BASE_URL;
