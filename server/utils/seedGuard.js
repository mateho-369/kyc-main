'use strict';

/**
 * シード共通の安全装置。
 *
 * なぜ別ファイルか: 「本番で実行してはいけない」「ロールは ENUM('admin','user') だけ」
 * 「email は正規化して扱う」を seeder ごとに書き直すと、必ず片方だけ更新される。
 * ここに1回だけ書く。
 *
 * 使い方（seeder 側）:
 *   const { assertSeedAllowed, normalizeEmail, assertRole } = require('../utils/seedGuard');
 *   await assertSeedAllowed('dev-accounts');   // 本番なら throw
 *   const email = normalizeEmail(process.env.SEED_USER_EMAIL);
 */

/** Users.role の ENUM。これ以外を書くと MySQL は 1265 (Data truncated) を返す。 */
const ROLES = ['admin', 'user'];

const isProduction = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';

/** SEED_ALLOW_INSECURE=true のときだけ本番でも通す（事故り方の指定）。 */
const allowInsecure = () => String(process.env.SEED_ALLOW_INSECURE || '').toLowerCase() === 'true';

/** DB が無い環境（DISABLE_DB=true）では model が throw するので先に抜ける。 */
const dbDisabled = () => String(process.env.DISABLE_DB || '').toLowerCase() === 'true';

/**
 * @param {string} name シード名（ログ用）
 * @param {{allowProduction?: boolean}} [opts] allowProduction:true なら本番でも実行する
 * @returns {boolean} true のときだけ続けてよい。false のときは呼び出し側が何もせず終わる。
 * @throws {Error} 本番で && SEED_ALLOW_INSECURE 未設定（＝誤実行を音を立てて止める）
 */
async function assertSeedAllowed(name, opts = {}) {
  if (dbDisabled()) {
    console.log(`[seed:${name}] DISABLE_DB=true のためスキップします（DBなしでは作れません）`);
    return false;
  }
  if (isProduction() && !allowInsecure() && !opts.allowProduction) {
    throw new Error(
      `[seed:${name}] production では実行を中止しました。` +
      'ダミーアカウントの作成は意図的な操作だけです。本当に必要な場合は ' +
      'SEED_ALLOW_INSECURE=true を設定してください（認証情報が .env に残る点に注意）'
    );
  }
  return true;
}

/** 空・不正な email は「未設定」と同じ扱いにする（部分実行で作る物を変えないため）。 */
function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.includes('@') && email.length <= 255 ? email : null;
}

/** パスワード: 未設定なら渡された既定値を使い、短すぎる物は拒否する（bcrypt 前に潰す）。 */
function passwordOr(fallback, min = 6) {
  const pw = String(fallback || '').trim();
  if (pw.length < min) {
    throw new Error(
      `[seed] パスワードは ${min} 文字以上にしてください（現在 ${pw.length} 文字）。` +
      '既定値を使う場合は SEED_*_PASSWORD を空にせず明示的に設定してください'
    );
  }
  return pw;
}

function assertRole(role) {
  const value = String(role || '').trim();
  if (!ROLES.includes(value)) {
    throw new Error(
      `[seed] role="${value}" は不正です。Users.role の ENUM は ${ROLES.join(' / ')} のみ` +
      '（"manager" や "superadmin" は保存できません。フロントが superadmin を許容しているのは' +
      ' 過去の仕様の名残で、DB 側には存在しない）'
    );
  }
  return value;
}

module.exports = {
  ROLES,
  assertRole,
  assertSeedAllowed,
  dbDisabled,
  isProduction,
  normalizeEmail,
  passwordOr
};
