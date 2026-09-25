'use strict';

/**
 * テスト用アカウント（一般ユーザー＋管理者）を作るシード。
 *
 * 【なぜ必要か】
 * `npm run migrate` だけ終わった DB は形は正しいがユーザーが0人。Sharegram SSO を
 * 使う前に、通常のログイン（POST /api/auth/login）や管理者専用画面を確認したい。
 *   cd server && npm run migrate && npm run seed      # = npm run db:setup
 *
 * 【既定のアカウント】server/.env の SEED_* で全部上書きできる
 *   user@example.com  /  user123     role=user
 *   admin@example.com /  admin123     role=admin
 *
 * 【安全側】
 * ・NODE_ENV=production では throw（SEED_ALLOW_INSECURE=true のときだけ通す）。
 *   弱いパスワードを許す代わりに、誤って本番DBに流し込む事故を止めるのはここ。
 * ・冪等：2回実行しても行もパスワードも増えない／変わらない。
 * ・既存行のパスワードは絶対に上書きしない（ロールだけ揃える）。
 * ・入力が不正なら DB コネクションを開く前に失敗する（plan() を require より前）。
 */

const { assertRole, assertSeedAllowed, normalizeEmail, passwordOr } = require('../utils/seedGuard');

const DEFAULTS = {
  user: { email: 'user@example.com', password: 'user123', role: 'user', label: '一般ユーザー' },
  admin: { email: 'admin@example.com', password: 'admin123', role: 'admin', label: '管理者' }
};

/** env と既定値から「何を作るか」を決める。email が不正な鍵は対象外（部分実行を許す）。 */
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
      name: String(process.env[`SEED_${env}_NAME`] || '').trim() || email.split('@')[0],
      usingDefaultPassword: !String(process.env[`SEED_${env}_PASSWORD`] || '').trim()
    };
  })
  .filter(Boolean);

module.exports = {
  up: async () => {
    if (!(await assertSeedAllowed('accounts'))) return;

    // plan() を models の require より先に置く: 入力が不正なときに
    // コネクションプールを開いてから失敗しないため。
    const accounts = plan();

    if (accounts.length === 0) {
      console.log('[seed:accounts] SEED_USER_EMAIL / SEED_ADMIN_EMAIL がどちらも未設定なので nothing to do');
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
          console.log(`[seed:accounts] ${account.email} は既存 → role を ${account.role} に合わせました`);
        } else {
          console.log(`[seed:accounts] ${account.email} は既存（role=${account.role}）→ パスワードは変更しません`);
        }
        continue;
      }

      await User.create({
        email: account.email,
        password: account.password,
        name: account.name,
        role: account.role,
        // パスワードログイン用のアカウント。Sharegram SSO（'firebase'）とは区別する。
        authProvider: 'jwt',
        emailVerified: true,
        isActive: true
      });
      created.push(account);
      console.log(`[seed:accounts] ${account.label} を作成: ${account.email} (role=${account.role})`);
    }

    if (created.length === 0) return;

    console.log('');
    console.log('[seed:accounts] ローカルでログイン確認できるアカウント:');
    created.forEach((account) => {
      // 自分で設定したパスワードはログに出さない。既定値のときだけ表示する。
      const shown = account.usingDefaultPassword ? account.password : '(SEED_*_PASSWORD で設定した値)';
      console.log(`    ${account.email}  /  ${shown}   →  ${account.role}`);
    });
    console.log('  ※ 共有・本番のDBでは使わないこと。消すときは SEED_UNDO_DELETE=true で npm run seed:undo');
  },

  /**
   * 削除は明示的に頼んだときだけ。
   * user@example.com / admin@example.com は誰でも使いそうなアドレスなので、行が在れば
   * 消して良いとは限らない（実運用の管理者を同じアドレスに作る人もいる）。
   * SEED_UNDO_DELETE=true が無い間は、何を消せるかを報告して終わる。
   */
  down: async () => {
    if (!(await assertSeedAllowed('accounts:undo', { allowProduction: false }))) return;

    const accounts = plan();
    if (accounts.length === 0) return;

    // eslint-disable-next-line global-require
    const { User } = require('../models');
    const armed = String(process.env.SEED_UNDO_DELETE || '').toLowerCase() === 'true';

    for (const account of accounts) {
      const row = await User.findOne({ where: { email: account.email } });
      if (!row) continue;

      if (row.firebaseUid || row.sharegramUserId) {
        console.log(`[seed:accounts] ${account.email} は SSO 連携済みなので削除対象外です`);
        continue;
      }
      if (!armed) {
        console.log(
          `[seed:accounts] 削除できます: ${account.email} (id=${row.id}, role=${row.role})。` +
          '実際に消すなら SEED_UNDO_DELETE=true を設定して npm run seed:undo'
        );
        continue;
      }
      await row.destroy();
      console.log(`[seed:accounts] ${account.email} を削除しました`);
    }
  }
};
