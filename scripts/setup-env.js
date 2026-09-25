#!/usr/bin/env node
/**
 * ローカルの .env を作る（Windows / macOS / Linux 共通）。
 *
 *   npm run env:setup            両方（ルート=フロント / server=バックエンド）
 *   npm run env:setup -- --force 既存(.env)があっても上書きする
 *
 * やること:
 *   1) .env.example を .env へコピー（既存があれば触らない。--force で置換）
 *   2) .env 内で空になっている秘密キーに、**その場で生成した**ランダム値を入れる
 *      （JWT_SECRET / JWT_REFRESH_SECRET / SESSION_SECRET / ENCRYPTION_KEY /
 *        WEBHOOK_ENCRYPTION_KEY）。コピペ用の値は最後に1回だけ表示する。
 *   3) 埋めていない必須項目を一覧表示する（Firebase 秘密鍵など。ここは人がやる）
 *
 * 注意: 生成値は標準出力に出る。ログに残らないよう、貼ったらこの出力は閉じること。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const force = process.argv.includes('--force');

const TARGETS = [
  { label: 'frontend (React)', dir: ROOT, example: '.env.example', target: '.env' },
  { label: 'backend  (Express)', dir: path.join(ROOT, 'server'), example: '.env.example', target: '.env' }
];

/** 自動生成してよいキー（値が空のときだけ埋める） */
const SECRET_KEYS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'WEBHOOK_ENCRYPTION_KEY'
];

/** 人が貼らないと始まらないキー */
const REQUIRED_KEYS = {
  frontend: ['REACT_APP_FIREBASE_API_KEY', 'REACT_APP_FIREBASE_APP_ID'],
  backend: ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
};

const secretFor = (key) => {
  // ENCRYPTION_KEY / WEBHOOK_ENCRYPTION_KEY は64hex（32バイト）を要求される
  return /KEY$/.test(key) ? crypto.randomBytes(32).toString('hex') : crypto.randomBytes(48).toString('base64url');
};

const fillSecrets = (text) => {
  const generated = {};
  const next = text.split('\n').map((line) => {
    const m = /^([A-Z0-9_]+)=$/.exec(line.trim());
    if (!m || !SECRET_KEYS.includes(m[1])) return line;
    generated[m[1]] = secretFor(m[1]);
    return `${m[1]}=${generated[m[1]]}`;
  }).join('\n');
  return { text: next, generated };
};

const missingFor = (text, keys) => keys.filter((key) => {
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
  return !m || m[1].trim() === '';
});

let written = 0;
const allGenerated = {};

for (const t of TARGETS) {
  const examplePath = path.join(t.dir, t.example);
  const targetPath = path.join(t.dir, t.target);
  const name = t.label.trim().split(' ')[0];

  if (!fs.existsSync(examplePath)) {
    console.log(`  ! ${t.label}: ${t.example} が見つからないためスキップ`);
    continue;
  }
  if (fs.existsSync(targetPath) && !force) {
    const label = `${name === 'frontend' ? '' : 'server/'}${t.target}`;
    const text = fs.readFileSync(targetPath, 'utf8');
    // 既存ファイルは壊さない。ただし**空の秘密キーだけ**を埋める
    // （手で .env を作った人が JWT_SECRET 無しで 500 になる事故が一番多い）。
    const { text: next, generated } = fillSecrets(text);
    const generatedKeys = Object.keys(generated);
    if (generatedKeys.length > 0) {
      fs.writeFileSync(targetPath, next);
      generatedKeys.forEach((k) => { allGenerated[`${name}:${k}`] = generated[k]; });
      console.log(`  ~ ${t.label}: ${label} は既存 → 空だった秘密キー ${generatedKeys.length} 個だけを補いました`);
    } else {
      console.log(`  = ${t.label}: ${label} は既存（変更なし。作り直すなら --force）`);
    }
    const missing = missingFor(next, REQUIRED_KEYS[name] || []);
    if (missing.length) console.log(`      要記入: ${missing.join(', ')}`);
    continue;
  }

  const { text, generated } = fillSecrets(fs.readFileSync(examplePath, 'utf8'));
  fs.writeFileSync(targetPath, text);
  written += 1;
  Object.entries(generated).forEach(([k, v]) => { allGenerated[`${name}:${k}`] = v; });
  console.log(`  + ${t.label}: ${name === 'frontend' ? '' : 'server/'}${t.target} を作成（秘密キー ${Object.keys(generated).length} 個を生成）`);
  const missing = missingFor(text, REQUIRED_KEYS[name] || []);
  if (missing.length) console.log(`      要記入: ${missing.join(', ')}`);
}

console.log('');
if (written === 0) {
  console.log('既存の .env を使います。作り直すなら: npm run env:setup -- --force');
} else {
  console.log('生成した秘密キー（この端末の .env に入りました。再実行すると変わります）:');
  Object.entries(allGenerated).forEach(([k, v]) => console.log(`  ${k.padEnd(34)} ${v.slice(0, 10)}…${v.slice(-4)}`));
  console.log('');
  console.log('次にやること:');
  console.log('  1) server/.env の FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY');
  console.log('     ローカル（Firebase エミュレータ）: cd server && npm run secrets:local の出力を貼る');
  console.log('     本番/ステージング: Sharegram と同じプロジェクトのサービスアカウントを貼る');
  console.log('  2) Sharegram 連携: server/.env の SYSTEM_API_KEYS に Sharegram の AUTHORIZED_KYC_KEY と同じ値');
  console.log('  3) MySQL のパスワードを server/.env の MYSQL_PASSWORD に入れる');
  console.log('  4) cd server && npm run migrate && npm run seed');
  console.log('  5) npm start（ルート＝フロント） / cd server && npm start（API）');
}
