'use strict';

/**
 * 開発用アカウント（一般ユーザー＋管理者）を1発で作るシード。
 *
 * 【なぜ必要か】
 * migrations だけ実行した DB にはユーザーが1人もいない。Sharegram SSO を使う前に
 * ローグイン画面（POST /api/auth/login）や管理者専用 API の動作を確認したい場合、
 * 手で作るよりここで作るのが速い。`npm run migrate && npm run seed` でそろう。
 *
 * 【安全側の設計】
 * ・認証情報は git に置かない。既定値は「開発専用」と明記した分かりやすい値で、
 *   SEED_*_PASSWORD で上書きできる。
 * ・NODE_ENV=production では原則 throw（SEED_ALLOW_INSECURE=true のときだけ通す）。
 * ・冪等：2回実行しても行もパスワードも増えない／変わらない。
 * ・既存ユーザーのパスワードは絶対に上書きしない（ロールだけ揃える）。
 * ・名前に "dev seed" の目印を残す（down() と人が判別するため）。
 *
 * 環境変数（server/.env）:
 *   SEED_USER_EMAIL / SEED_USER_PASSWORD / SEED_USER_NAME / SEED_USER_ROLE
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME / SEED_ADMIN_ROLE
 */

const {
  assertRole,
  assertSeedAllowed,
  SEED_MARKER,
  normalizeEmail,
  passwordOr,
  seedName
} = require('../utils/seedGuard');

const DEFAULTS = {
  user: {
    email: 'dev.user@example.com',
    password: 'DevUser@12345',
    role: 'user',
    label: '一般ユーザー'
  },
  admin: {
    email: 'dev.admin@example.com',
    password: 'DevAdmin@12345',
    role: 'admin',
    label: '管理者'
  }
};

/** env と既定値から作る物を決める。email が不正な鍵は対象外（部分実行を許す）。 */
const plan = () => Object.keys(DEFAULTS)
  .map((key) => {
    const d = DEFAULTS[key];
    const env = key.toUpperCase();
    const email = normalizeEmail(process.env[`SEED_${env}_EMAIL`] || d.email);
    if (!email) return null;
    return {
      key,
      label: d.label,
      email,
      role: assertRole(process.env[`SEED_${env}_ROLE`] || d.role),
      password: passwordOr(process.env[`SEED_${env}_PASSWORD`] || d.password),
      name: seedName(process.env[`SEED_${env}_NAME`], email.split('@')[0]),
      usingDefaultPassword: !String(process.env[`SEED_${env}_PASSWORD`] || '').trim()
    };
  })
  .filter(Boolean);

module.exports = {
  up: async () => {
    if (!(await assertSeedAllowed('dev-accounts'))) return;

    // plan() を models の require より先に置く: 入力が不正なときに
    // コネクションプールを開いてから失敗しないため（`check:schema` 等を汚さない）。
    const accounts = plan();

    if (accounts.length === 0) {
      console.log('[seed:dev-accounts] SEED_USER_EMAIL / SEED_ADMIN_EMAIL がどちらも未設定のため作成 nothing to do');
      return;
    }

    // eslint-disable-next-line global-require
    const { User } = require('../models');

    const created = [];
    for (const account of accounts) {
      const existing = await User.findOne({ where: { email: account.email } });

      if (existing) {
        if (existing.role !== account.role) {
          await existing.update({ role: account.role });
          console.log(`[seed:dev-accounts] ${account.email} は既存 → role を ${account.role} に合わせました`);
        } else {
          console.log(`[seed:dev-accounts] ${account.email} は既存（role=${account.role}）→ パスワードは変更しません`);
        }
        continue;
      }

      await User.create({
        email: account.email,
        password: account.password,
        name: account.name,
        role: account.role,
        // パスワードログイン用のアカウント。SSO（'firebase'）とは区別する。
        authProvider: 'jwt',
        emailVerified: true,
        isActive: true
      });
      created.push(account);
      console.log(`[seed:dev-accounts] ${account.label} を作成: ${account.email} (role=${account.role})`);
    }

    if (created.length === 0) return;

    console.log('');
    console.log('[seed:dev-accounts] ログイン確認（ローカル専用）:');
    created.forEach((account) => {
      // 自分で設定したパスワードをログには出さない。既定値のときだけ表示する。
      const shown = account.usingDefaultPassword ? account.password : '(SEED_環境変数で設定した値)';
      console.log(`    ${account.email}  /  ${shown}  →  ${account.role}`);
    });
    console.log('  ※ 本番DBでは使わないこと。削除は npm run seed:undo または down()。');
  },

  /**
   * 「このシードが作った物らしき行」だけ消す。
   * SSO と紐づいた行（firebaseUid / sharegramUserId がある）や、目印の無い行は
   * 絶対に触らない。
   */
  down: async () => {
    if (!(await assertSeedAllowed('dev-accounts:undo', { allowProduction: false }))) return;

    const accounts = plan();
    if (accounts.length === 0) return;

    // eslint-disable-next-line global-require
    const { User } = require('../models');

    for (const account of accounts) {
      const row = await User.findOne({ where: { email: account.email } });
      if (!row) continue;

      const looksSeeded = String(row.name || '').includes(SEED_MARKER)
        && row.role === account.role
        && !row.firebaseUid
        && !row.sharegramUserId;

      if (!looksSeeded) {
        console.log(`[seed:dev-accounts] ${account.email} はこのシードが作った物と特定できないため残します`);
        continue;
      }
      await row.destroy();
      console.log(`[seed:dev-accounts] ${account.email} を削除しました`);
    }
  }
};
