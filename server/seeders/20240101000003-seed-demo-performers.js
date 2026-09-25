'use strict';

/**
 * ダッシュボードを見るためのデモ出演者（＋監査ログ1件）を作るシード。
 *
 * 【なぜ必要か】
 * 0001 でアカウントを作っても、ダッシュボードと一覧ページが出るのは **performers（出演者）**
 * が在るときの話。`GET /api/performers` は role='user' なら自分の行だけ、admin なら全件を
 * 返すので、出演者が0件だと「シードしたのにデータが見えない」に見える。ここで
 * オーナーごとに数件入れると、一覧・詳細・フィルタ・監査ログが動く状態になる。
 *
 * 【入れない物】
 * 書類（images）は意図的に入れていない。documents に { idFront: {...} } だけ入れると
 * 一覧・詳細には出るが「ダウンロード/プレビュー」が実ファイル不在で失敗し、
 * 壊れたボタンを「動かない」と誤解させる。ファイル付きが欲しい場合は
 * 画面からアップロードするのが正しい（保存先: server/uploads）。
 *
 * 【制御】
 *   SEED_DEMO_DATA=false            でスキップ
 *   SEED_DEMO_OWNER_EMAILS=a,b,c    で作成先（既定: user@example.com,admin@example.com）
 *   down() は external_id が SEED-DEMO- で始まる行だけ消す
 *   NODE_ENV=production では abort（assertSeedAllowed）
 */

const { assertSeedAllowed } = require('../utils/seedGuard');

const EXTERNAL_PREFIX = 'SEED-DEMO-';
const AUDIT_MARKER = 'seed-demo';
const DEFAULT_OWNERS = 'user@example.com,admin@example.com';

/** オーナーごとに見せ方を変えるテンプレ（一覧のフィルタが動くように状態を散らす） */
const TEMPLATES = (ownerIndex) => [
  {
    suffix: 'A',
    lastName: ownerIndex === 0 ? '山田' : '佐藤',
    firstName: '太郎',
    lastNameRoman: ownerIndex === 0 ? 'Yamada' : 'Sato',
    firstNameRoman: 'Taro',
    status: 'active',
    kycStatus: 'verified',
    riskScore: 0.04,
    verifiedDaysAgo: 20,
    expiresInDays: 345,
    notes: 'デモデータ（審査済み）'
  },
  {
    suffix: 'B',
    lastName: '鈴木',
    firstName: '花子',
    lastNameRoman: 'Suzuki',
    firstNameRoman: 'Hanako',
    status: 'pending',
    kycStatus: 'in_progress',
    riskScore: 0.61,
    verifiedDaysAgo: null,
    expiresInDays: null,
    notes: 'デモデータ（審査中）'
  },
  {
    suffix: 'C',
    lastName: '高橋',
    firstName: '一郎',
    lastNameRoman: 'Takahashi',
    firstNameRoman: 'Ichiro',
    status: 'rejected',
    kycStatus: 'rejected',
    riskScore: 0.94,
    verifiedDaysAgo: null,
    expiresInDays: null,
    notes: 'デモデータ（差し戻し）'
  }
];

const dayMs = 24 * 60 * 60 * 1000;
const shift = (days) => new Date(Date.now() + days * dayMs);

const ownerEmails = () => String(process.env.SEED_DEMO_OWNER_EMAILS || DEFAULT_OWNERS)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value.includes('@'));

const demoEnabled = () => String(process.env.SEED_DEMO_DATA === undefined ? 'true' : process.env.SEED_DEMO_DATA)
  .toLowerCase() !== 'false';

module.exports = {
  up: async () => {
    if (!(await assertSeedAllowed('demo-performers', { allowProduction: false }))) return;

    if (!demoEnabled()) {
      console.log('[seed:demo] SEED_DEMO_DATA=false のためデモ出演者は作りません');
      return;
    }

    const emails = ownerEmails();
    if (emails.length === 0) {
      console.log('[seed:demo] SEED_DEMO_OWNER_EMAILS が空なので作れません');
      return;
    }

    // eslint-disable-next-line global-require
    const { User, Performer, AuditLog } = require('../models');

    let total = 0;
    for (const [ownerIndex, email] of emails.entries()) {
      const owner = await User.findOne({ where: { email } });
      if (!owner) {
        console.log(`[seed:demo] ${email} が Users に無いのでスキップ（先に npm run seed でアカウントを作る）`);
        continue;
      }

      for (const template of TEMPLATES(ownerIndex)) {
        const externalId = `${EXTERNAL_PREFIX}${email.split('@')[0]}-${template.suffix}`;

        // 冪等: external_id は unique。在れば触らない
        // eslint-disable-next-line no-await-in-loop
        const existing = await Performer.findOne({ where: { external_id: externalId } });
        if (existing) {
          console.log(`[seed:demo] ${externalId} は既存（id=${existing.id}）→ 変更しません`);
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const performer = await Performer.create({
          external_id: externalId,
          lastName: template.lastName,
          firstName: template.firstName,
          lastNameRoman: template.lastNameRoman,
          firstNameRoman: template.firstNameRoman,
          status: template.status,
          kycStatus: template.kycStatus,
          kycVerifiedAt: template.verifiedDaysAgo === null ? null : shift(-template.verifiedDaysAgo),
          kycExpiresAt: template.expiresInDays === null ? null : shift(template.expiresInDays),
          nationality: 'JP',
          phoneNumber: null,
          birthDate: '1995-04-01',
          riskScore: template.riskScore,
          notes: `${template.notes} (demo seed)`,
          // 意図的に空。ファイル実体の無い documents を入れると preview/download が壊れる
          documents: {},
          userId: owner.id
        });
        total += 1;

        // 監査ログ画面をからっぽにしないための1件（実際の作成イベントの模倣）
        // eslint-disable-next-line no-await-in-loop
        await AuditLog.create({
          userId: owner.id,
          action: 'create',
          resourceType: 'performer',
          resourceId: performer.id,
          details: { marker: AUDIT_MARKER, via: 'seeder', external_id: externalId },
          ipAddress: '127.0.0.1',
          userAgent: 'sequelize-seeder'
        });

        console.log(`[seed:demo] ${owner.email} に ${performer.lastName} ${performer.firstName} を追加 (kyc=${template.kycStatus})`);
      }
    }

    if (total > 0) {
      console.log('');
      console.log(`[seed:demo] ${total} 件追加。フロントで確認: /performers（一覧） → 行をクリック（詳細・フィルタ・監査ログ）`);
      console.log('[seed:demo] 書類は入れていないので、プレビュー/ダウンロードは「未提出」のままです');
    }
  },

  /**
   * このシードが作った物（external_id が SEED-DEMO- 始まり）だけ消す。
   * 実運用で付けた external_id（Sharegram の ID など）には触らない。
   */
  down: async () => {
    if (!(await assertSeedAllowed('demo-performers:undo', { allowProduction: false }))) return;
    if (!demoEnabled()) return;

    // eslint-disable-next-line global-require
    const { Op } = require('sequelize');
    // eslint-disable-next-line global-require
    const { Performer, AuditLog } = require('../models');

    const performers = await Performer.findAll({
      where: { external_id: { [Op.like]: `${EXTERNAL_PREFIX}%` } }
    });
    for (const performer of performers) {
      // eslint-disable-next-line no-await-in-loop
      await AuditLog.destroy({ where: { resourceType: 'performer', resourceId: performer.id, details: { marker: AUDIT_MARKER } } });
      // eslint-disable-next-line no-await-in-loop
      await performer.destroy();
      console.log(`[seed:demo] 削除: ${performer.external_id} (id=${performer.id})`);
    }
    console.log(`[seed:demo] ${performers.length} 件を処理しました（書類実体は server/uploads に残る場合あり）`);
  }
};
