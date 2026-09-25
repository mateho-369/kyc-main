'use strict';

/**
 * 管理（admin）アカウントのシード。
 *
 * 【なぜ必要か】
 * Sharegram SSO が作るユーザーは role='user'。それで performers の作成・一覧・
 * 書類確認はできるが、admin 限定の画面/APIは使えない：
 *   ・POST /api/performers/:id/approve     （checkRole(['admin'])）
 *   ・/api/v1/analytics|bulk|batch|integrations（requireAdmin）
 *   ・フロントの管理ナビ（Header.jsx / Navigation.jsx の isAdmin）
 *   ・AdminUsersPage / UserDetailPage の管理セクション
 * 昇格用のシードはこれまでリポジトリに存在しなかった（server/seeders/ 自体が
 * 無いため `npm run seed` は何もできませんでした）。
 *
 * 実行順: 0001-seed-dev-accounts（開発用の架空アカウントを作る）→ 本シード
 * （Sharegram の実アカウントを昇格する）。本シードはemail指定のみで動き、
 * SEED_ADMIN_EMAIL 未設定なら何もせず終わります。
 *
 * 【方針】
 * 認証情報は git に書かない。誰を admin にするかだけ server/.env の
 * SEED_ADMIN_EMAIL で渡し、パスワードは作らない（ランダム値なので
 * パスワードログインは使えず、SSO でのみログインできる）。
 * 何度実行しても結果が変わらない（冪等）。
 */

const crypto = require('crypto');
const { assertRole, assertSeedAllowed, normalizeEmail } = require('../utils/seedGuard');

const targetEmail = () => normalizeEmail(process.env.SEED_ADMIN_EMAIL);
const targetRole = () => assertRole(process.env.SEED_ADMIN_ROLE || 'admin');

module.exports = {
  up: async () => {
    // 本番でも実行可（パスワードはランダム生成なので漏れる認証情報が無い）。
    // DISABLE_DB=true のときだけスキップする。
    if (!(await assertSeedAllowed('promote-sso-admin', { allowProduction: true }))) return;

    const email = targetEmail();
    if (!email) {
      console.log('[seed] SEED_ADMIN_EMAIL が未設定（または不正）なので何もしません');
      console.log('[seed] 使い方: server/.env に SEED_ADMIN_EMAIL=makara@gmail.com を追記して npm run seed');
      return;
    }

    // eslint-disable-next-line global-require
    const { User } = require('../models');
    const role = targetRole();

    const existing = await User.findOne({ where: { email } });

    if (existing) {
      if (existing.role === role) {
        console.log(`[seed] ${email} は既に ${role} です（変更なし）`);
        return;
      }
      await existing.update({ role });
      console.log(`[seed] ${email} (id=${existing.id}) を ${role} に昇格しました`);
      console.log('[seed] SSO で再度ログインすると、その場で管理者として表示されます');
      return;
    }

    // SSO でまだ誰もログインしていない場合に先に作っておくケース。
    // users.password は NOT NULL かつ beforeCreate で bcrypt ハッシュされるため、
    // 推測不能なランダム値を入れておく（＝パスワードログインは不可、SSO専用）。
    const created = await User.create({
      email,
      name: process.env.SEED_ADMIN_NAME || email.split('@')[0],
      role,
      authProvider: 'firebase',
      emailVerified: true,
      password: crypto.randomBytes(32).toString('hex')
    });

    console.log(`[seed] 管理ユーザー ${email} (id=${created.id}) を作成しました`);
    console.log('[seed] Sharegram SSO で初ログインすると同じ email に firebaseUid が紐づきます');
  },

  /**
   * ロールを戻すだけ（行を消さない）。
   * dev DB の唯一の管理者をうっかり削除しないため。
   */
  down: async () => {
    const email = targetEmail();
    if (!email) {
      console.log('[seed] SEED_ADMIN_EMAIL 未設定なので down() も何もしません');
      return;
    }

    // eslint-disable-next-line global-require
    const { User } = require('../models');
    const existing = await User.findOne({ where: { email } });
    if (!existing) {
      console.log(`[seed] ${email} は存在しないため nothing to undo`);
      return;
    }
    if (existing.role !== targetRole()) {
      console.log(`[seed] ${email} のロールは ${existing.role}（このシードが作った物ではない）なので変更しません`);
      return;
    }
    await existing.update({ role: 'user' });
    console.log(`[seed] ${email} を user に戻しました`);
  }
};
