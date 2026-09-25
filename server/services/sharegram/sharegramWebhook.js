/**
 * KYC → Sharegram webhook（出演者イベントの通知）
 *
 * KYC で出演者が作成・更新・承認・削除されたときに、Sharegram バックエンドへ
 * 署名付きの POST を送る。Sharegram はこれを受けて自分の DB に出演者を保存する。
 * （KYC の DB と Sharegram の DB は別物なので、何も送らなければ Sharegram 側には
 *   出演者が存在しないままになる）
 *
 * 設定は server/.env のみ:
 *   KYC_WEBHOOK_URL         受信先（Sharegram の webhook ルート）。未設定なら何もしない
 *   KYC_WEBHOOK_SECRET      HMAC 共有シークレット。Sharegram の KYC_WEBHOOK_SECRET と同じ値
 *   KYC_WEBHOOK_EVENTS      送るイベント（カンマ区切り、省略時は全部）
 *   KYC_WEBHOOK_TIMEOUT_MS  1 回あたりのタイムアウト（既定 5000）
 *
 * 署名（受信側はこの通りに検証する）:
 *   X-KYC-Timestamp: UNIX 秒
 *   X-KYC-Signature: sha256=HEX(HMAC_SHA256(secret, `${timestamp}.${生のリクエストボディ}`))
 *   → 生ボディで再計算し、定数時間比較 + 時刻の許容幅（例: 300 秒）で検証すること。
 *
 * 送信は API のレスポンスをブロックしない（失敗しても出演者の登録自体は成功のまま）。
 * 書類のファイルパス・住所・生年月日などは送らない。必要なら Sharegram から KYC API で取得する。
 */

const crypto = require('crypto');
const axios = require('axios');

const SUPPORTED_EVENTS = Object.freeze([
  'performer.created',
  'performer.updated',
  'performer.approved',
  'performer.deleted',
  'document.verified'
]);

const DOCUMENT_TYPES = Object.freeze(['agreementFile', 'idFront', 'idBack', 'selfie', 'selfieWithId']);

// 1 回目の失敗後 1 秒、2 回目の失敗後 3 秒待って再送（合計 3 回）
const RETRY_DELAYS_MS = Object.freeze([1000, 3000]);

const LOG_PREFIX = '[sharegram-webhook]';

const splitList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** env を毎回読む（.env を直して再起動しただけで反映されるように、キャッシュしない） */
const getConfig = () => {
  const events = splitList(process.env.KYC_WEBHOOK_EVENTS);
  return {
    url: String(process.env.KYC_WEBHOOK_URL || '').trim(),
    secret: String(process.env.KYC_WEBHOOK_SECRET || '').trim(),
    events: events.length > 0 ? events : [...SUPPORTED_EVENTS],
    timeoutMs: Number(process.env.KYC_WEBHOOK_TIMEOUT_MS) || 5000
  };
};

/**
 * 送信できない理由を返す（null なら送信可能）
 * @param {ReturnType<typeof getConfig>} config
 * @returns {string|null}
 */
const getConfigProblem = (config) => {
  if (!config.url) return 'KYC_WEBHOOK_URL is not set';

  let parsed;
  try {
    parsed = new URL(config.url);
  } catch (error) {
    return `KYC_WEBHOOK_URL is not a valid URL (${config.url})`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'KYC_WEBHOOK_URL must start with http:// or https://';
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    return 'KYC_WEBHOOK_URL must use https:// in production';
  }
  // 署名なしの webhook は受信側で本物か判別できないので、絶対に送らない
  if (!config.secret) return 'KYC_WEBHOOK_SECRET is not set (unsigned webhooks are never sent)';

  return null;
};

/** 起動ログ用の 1 行サマリー（シークレットは出さない） */
const describeConfig = () => {
  const config = getConfig();
  // Sharegram master にはこの受信口が無い。Sharegram は KYC の GET /api/performers を読みに来る
  // （docs/SHAREGRAM_INTEGRATION.md）ので、未設定＝正常。
  if (!config.url) return 'disabled (KYC_WEBHOOK_URL is not set — normal: Sharegram reads performers from GET /api/performers)';

  const problem = getConfigProblem(config);
  if (problem) return `⚠ NOT SENDING: ${problem}`;

  const known = config.events.filter((event) => SUPPORTED_EVENTS.includes(event));
  const unknown = config.events.filter((event) => !SUPPORTED_EVENTS.includes(event));
  const parts = [`enabled → ${config.url}`, `events: ${known.join(', ') || '(none)'}`];
  if (unknown.length > 0) parts.push(`⚠ unknown events ignored: ${unknown.join(', ')}`);
  if (config.secret.length < 32) parts.push('⚠ KYC_WEBHOOK_SECRET is shorter than 32 characters');
  return parts.join(' | ');
};

/**
 * 署名を作る（受信側と同じ計算式）
 * @param {string} secret
 * @param {string} timestamp - UNIX 秒（文字列）
 * @param {string} rawBody - 実際に送る JSON 文字列そのもの
 */
const signPayload = (secret, timestamp, rawBody) =>
  `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`;

const toIso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toIdString = (value) => (value === undefined || value === null || value === '' ? null : String(value));

/** 書類はファイルパスを含むので「提出済みか / 検証済みか」だけに要約して送る */
const summarizeDocuments = (documents) => {
  let docs = documents;
  if (typeof docs === 'string') {
    try {
      docs = JSON.parse(docs);
    } catch (error) {
      docs = {};
    }
  }
  if (!docs || typeof docs !== 'object') docs = {};

  return DOCUMENT_TYPES.reduce((summary, type) => {
    const doc = docs[type];
    summary[type] = {
      uploaded: Boolean(doc),
      verified: Boolean(doc && doc.verified),
      verifiedAt: doc ? toIso(doc.verifiedAt) : null
    };
    return summary;
  }, {});
};

/**
 * Performer（Sequelize インスタンス or プレーンオブジェクト）を送信用に整形
 * 呼び出し時点の値で固定するので、削除直後でも送れる。
 */
const buildPerformerSnapshot = (performer) => {
  const p = performer && typeof performer.get === 'function' ? performer.get({ plain: true }) : { ...(performer || {}) };
  return {
    id: p.id ?? null,
    externalId: toIdString(p.external_id),
    userId: p.userId ?? null,
    sharegramUserId: toIdString(p.sharegramUserId),
    lastName: p.lastName ?? null,
    firstName: p.firstName ?? null,
    lastNameRoman: p.lastNameRoman ?? null,
    firstNameRoman: p.firstNameRoman ?? null,
    status: p.status ?? null,
    kycStatus: p.kycStatus ?? null,
    documents: summarizeDocuments(p.documents),
    createdAt: toIso(p.createdAt),
    updatedAt: toIso(p.updatedAt)
  };
};

/**
 * 出演者を登録した KYC ユーザー（= Sharegram から SSO してきた本人）
 * Sharegram 側はこの email / firebaseUid で自分のアカウントと紐付ける。
 */
const loadOwner = async (userId) => {
  if (!userId) return null;
  try {
    // 遅延 require: テストや DB 未接続でもこのモジュール自体は読み込めるように
    const { User } = require('../../models');
    const user = await User.findByPk(userId, {
      attributes: ['id', 'email', 'firebaseUid', 'sharegramUserId']
    });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email || null,
      firebaseUid: user.firebaseUid || null,
      sharegramUserId: toIdString(user.sharegramUserId)
    };
  } catch (error) {
    console.warn(`${LOG_PREFIX} owner lookup failed for user ${userId}: ${error.message}`);
    return null;
  }
};

const STATUS_HINTS = {
  401: ' — signature rejected: KYC_WEBHOOK_SECRET must be identical in KYC server/.env and Sharegram .env',
  403: ' — forbidden: check Sharegram middleware (basic auth / IP allowlist) on the webhook route',
  404: ' — receiver route not found: check KYC_WEBHOOK_URL and `php artisan route:list`',
  405: ' — method not allowed: the Sharegram route must accept POST',
  419: ' — CSRF token mismatch: register the route in routes/api.php, not routes/web.php'
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 1 イベントを送信する（再送込み）。例外は投げず、結果オブジェクトを返す。
 * @param {string} event
 * @param {object} data
 * @param {{config?: object, retryDelaysMs?: number[], occurredAt?: string}} [options]
 */
const deliver = async (event, data, options = {}) => {
  const config = options.config || getConfig();
  const problem = getConfigProblem(config);
  if (problem) return { delivered: false, skipped: true, reason: problem };
  if (!SUPPORTED_EVENTS.includes(event) || !config.events.includes(event)) {
    return { delivered: false, skipped: true, reason: `${event} is not enabled (KYC_WEBHOOK_EVENTS)` };
  }

  const retryDelays = options.retryDelaysMs || RETRY_DELAYS_MS;
  const maxAttempts = retryDelays.length + 1;
  const deliveryId = crypto.randomUUID();
  // 署名したバイト列とまったく同じものを送る（再シリアライズさせない）
  const rawBody = JSON.stringify({
    id: deliveryId,
    event,
    occurredAt: options.occurredAt || new Date().toISOString(),
    data
  });
  const label = `${event} performer=${data?.performer?.id ?? '-'}`;
  let result = { delivered: false, attempts: 0, deliveryId };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const response = await axios.post(config.url, rawBody, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'safevideo-kyc-webhook/1.0',
          'X-KYC-Event': event,
          'X-KYC-Delivery': deliveryId,
          'X-KYC-Timestamp': timestamp,
          'X-KYC-Signature': signPayload(config.secret, timestamp, rawBody)
        },
        timeout: config.timeoutMs,
        maxRedirects: 0,
        transformRequest: [(body) => body],
        validateStatus: () => true
      });

      if (response.status >= 200 && response.status < 300) {
        console.log(`${LOG_PREFIX} ${label} → HTTP ${response.status} (attempt ${attempt})`);
        return { delivered: true, status: response.status, attempts: attempt, deliveryId };
      }

      result = { delivered: false, status: response.status, attempts: attempt, deliveryId };
      console.warn(
        `${LOG_PREFIX} ${label} → HTTP ${response.status}${STATUS_HINTS[response.status] || ''} (attempt ${attempt}/${maxAttempts})`
      );
      // 4xx は再送しても結果が変わらない（429 のみ再送）
      if (response.status < 500 && response.status !== 429) return result;
    } catch (error) {
      result = { delivered: false, error: error.code || error.message, attempts: attempt, deliveryId };
      console.warn(`${LOG_PREFIX} ${label} failed: ${error.code || error.message} (attempt ${attempt}/${maxAttempts})`);
    }

    if (attempt < maxAttempts) await sleep(retryDelays[attempt - 1]);
  }

  return result;
};

const warnedProblems = new Set();

/**
 * ルートから呼ぶ入口。即座に返り、送信はバックグラウンドで行う。
 * @param {string} event - SUPPORTED_EVENTS のいずれか
 * @param {object} performer - Performer インスタンス or プレーンオブジェクト
 * @param {object} [extra] - data にそのまま追加する項目（例: { document: { type } }）
 * @returns {boolean} 送信をキューに積んだら true
 */
const notifySharegram = (event, performer, extra = {}) => {
  try {
    const config = getConfig();
    if (!config.url) return false; // 無効（起動ログに表示済み）

    const problem = getConfigProblem(config);
    if (problem) {
      if (!warnedProblems.has(problem)) {
        warnedProblems.add(problem);
        console.warn(`${LOG_PREFIX} ⚠ ${problem} — Sharegram will not be notified`);
      }
      return false;
    }
    if (!SUPPORTED_EVENTS.includes(event) || !config.events.includes(event)) return false;

    const snapshot = buildPerformerSnapshot(performer);
    const occurredAt = new Date().toISOString();

    setImmediate(() => {
      loadOwner(snapshot.userId)
        .then((owner) => deliver(event, { performer: snapshot, owner, ...extra }, { config, occurredAt }))
        .catch((error) => console.error(`${LOG_PREFIX} ${event} unexpected error: ${error.message}`));
    });
    return true;
  } catch (error) {
    console.error(`${LOG_PREFIX} could not queue ${event}: ${error.message}`);
    return false;
  }
};

module.exports = {
  SUPPORTED_EVENTS,
  notifySharegram,
  deliver,
  describeConfig,
  signPayload,
  buildPerformerSnapshot,
  getConfigProblem,
  getConfig
};
