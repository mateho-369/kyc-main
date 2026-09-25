#!/usr/bin/env node
/**
 * ローカル開発用の秘密値を「貼り付け用」に表示する（Windows / macOS / Linux 共通）。
 * ファイルには何も書かない。表示された行で server/.env の同じ名前の行を置き換える。
 *
 *   cd server
 *   npm run secrets:local
 *   npm run secrets:local -- --project=demo-kyc-local   # エミュレータのプロジェクトIDを変える場合
 *
 * 1) JWT / セッション / 暗号化キー
 *    .env.example の REPLACE_WITH_... のままだと、誰でも知っている値で JWT に署名していることになる。
 *    変えると既存のログインは無効になる（Sharegram から SSO し直すだけでよい）。
 *
 * 2) Firebase Admin SDK の「エミュレータ専用」サービスアカウント
 *    その場で作った使い捨ての RSA 鍵。Google に登録されていないので、本物の Firebase では何もできない。
 *    FIREBASE_AUTH_EMULATOR_HOST を設定したローカルでは、Admin SDK は ID トークンの検証も
 *    失効チェック（verifyIdToken(token, true)）もエミュレータに問い合わせるだけなので、この鍵で SSO が動く。
 *    → 本物のサービスアカウント秘密鍵をローカルの .env に置かなくてよくなる。
 *
 * 注意: 出力は秘密値。貼り終わったらターミナルの表示を消すこと。
 */

const crypto = require('crypto');

const argProject = process.argv.find((arg) => arg.startsWith('--project='));
const projectId = (argProject ? argProject.split('=')[1] : 'demo-kyc-local').trim();

if (!/^[a-z0-9-]{4,30}$/.test(projectId)) {
  console.error(`Invalid --project value: "${projectId}"`);
  process.exit(1);
}

const randomText = () => crypto.randomBytes(48).toString('base64url');
const randomHex64 = () => crypto.randomBytes(32).toString('hex');

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
});
// .env は1行で書く。改行はリテラルの \n（サーバー側で実改行に戻している）
const privateKeyForEnv = privateKey.trim().replace(/\r?\n/g, '\\n') + '\\n';

const lines = [
  `# ---- server/.env: 同じ名前の行をこれで置き換える（生成 ${new Date().toISOString()}）----`,
  `JWT_SECRET=${randomText()}`,
  `JWT_REFRESH_SECRET=${randomText()}`,
  `SESSION_SECRET=${randomText()}`,
  `ENCRYPTION_KEY=${randomHex64()}`,
  `WEBHOOK_ENCRYPTION_KEY=${randomHex64()}`,
  '',
  '# Firebase Admin: エミュレータ専用の使い捨て鍵（本物の Firebase では使えない）',
  `FIREBASE_PROJECT_ID=${projectId}`,
  'FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099',
  `FIREBASE_CLIENT_EMAIL=firebase-adminsdk-local@${projectId}.iam.gserviceaccount.com`,
  'FIREBASE_PRIVATE_KEY_ID=local-emulator-only',
  `FIREBASE_PRIVATE_KEY="${privateKeyForEnv}"`,
  '# 本物のサービスアカウントを指す次の行は削除する:',
  '#   FIREBASE_CLIENT_ID / FIREBASE_CLIENT_X509_CERT_URL'
];

console.log(lines.join('\n'));

if (!projectId.startsWith('demo-')) {
  console.error(
    `\n⚠ "${projectId}" は demo- で始まっていない。エミュレータは動くが、Sharegram 側の` +
      ' FIREBASE_PROJECT_ID と同じ値にすること（違うと SSO のトークンが 400 になる）。'
  );
}
