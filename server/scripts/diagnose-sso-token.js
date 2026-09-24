#!/usr/bin/env node
/**
 * Sharegram SSO 診断スクリプト
 *
 * 「Invalid token」になったとき、原因が
 *   (1) トークンの期限切れ
 *   (2) .env の読み込み先 / FIREBASE_PROJECT_ID の不一致
 *   (3) FIREBASE_PRIVATE_KEY の改行・形式
 *   (4) Firebase 側の検証エラー（失効・署名）
 * のどれなのかを1回の実行で切り分ける。
 *
 * 使い方:
 *   node scripts/diagnose-sso-token.js "<Firebase ID Token>"
 *   node scripts/diagnose-sso-token.js            # 設定のチェックだけ実行
 *
 * URLをそのまま渡してもよい（token= を抽出する）。
 *
 * 【Windows】npm 経由（npm run diagnose:sso -- "<url>"）だと cmd.exe を経るため、
 * URL中の & で切れて 'come_back' is not recognized... となる。node で直接実行する:
 *   node scripts/diagnose-sso-token.js "<url>"
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVER_DIR = path.join(__dirname, '..');

const header = (title) => {
  console.log('');
  console.log('='.repeat(64));
  console.log(title);
  console.log('='.repeat(64));
};

const ok = (msg) => console.log(`  [OK]   ${msg}`);
const bad = (msg) => console.log(`  [FAIL] ${msg}`);
const warn = (msg) => console.log(`  [WARN] ${msg}`);
const info = (msg) => console.log(`  [INFO] ${msg}`);

// ---------------------------------------------------------------------------
// 1) server.js と同じ .env を読む
// ---------------------------------------------------------------------------
header('1. 環境変数ファイル（server.js と同じ読み込み順）');

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
const envPath = path.join(SERVER_DIR, envFile);
const envExists = fs.existsSync(envPath);

info(`NODE_ENV = ${process.env.NODE_ENV || '(未設定 = development扱い)'}`);
info(`読み込み先 = ${envPath}`);
if (envExists) {
  ok(`${envFile} が見つかりました`);
  // server.js と同じく dotenv で読み込む
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: envPath });
} else {
  bad(`${envFile} が存在しません。この場合 dotenv は黙って何もしないので、`);
  bad('FIREBASE_* は全て undefined になり、SSOは 503 FIREBASE_NOT_CONFIGURED になります。');
  warn('注意: server.js は __dirname (= server/) を基準にします。');
  warn('      リポジトリ直下の .env は読まれません。server/.env に置いてください。');
}

// ---------------------------------------------------------------------------
// 2) トークンを検証なしでデコード
// ---------------------------------------------------------------------------
const decodeJwt = (token) => {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return { header: JSON.parse(b64(parts[0])), payload: JSON.parse(b64(parts[1])) };
  } catch (e) {
    return null;
  }
};

let rawToken = process.argv[2] || '';
if (!rawToken && process.argv[3]) rawToken = process.argv[3];
// URLをそのまま貼られた場合に対応
const urlMatch = rawToken.match(/[?&]token=([^&\s]+)/);
if (urlMatch) rawToken = decodeURIComponent(urlMatch[1]);
rawToken = rawToken.trim();

let decoded = null;
if (rawToken) {
  header('2. トークンの内容（検証なしでデコード）');
  decoded = decodeJwt(rawToken);
  if (!decoded) {
    bad('JWTとして解析できません（3つのパートに分かれていない/壊れている）');
  } else {
    const p = decoded.payload;
    const now = Math.floor(Date.now() / 1000);
    const issProject = (p.iss || '').split('/').pop();

    info(`iss        = ${p.iss}`);
    info(`aud        = ${p.aud}`);
    info(`uid (sub)  = ${p.sub}`);
    info(`email      = ${p.email}`);
    info(`provider   = ${p.firebase?.sign_in_provider}`);
    info(`iat        = ${p.iat} (${new Date(p.iat * 1000).toISOString()})`);
    info(`exp        = ${p.exp} (${new Date(p.exp * 1000).toISOString()})`);
    info(`現在時刻   = ${now} (${new Date(now * 1000).toISOString()})`);

    if (p.exp <= now) {
      bad(`トークンは ${Math.floor((now - p.exp) / 60)} 分前に期限切れです。`);
      bad('→ Firebaseは auth/id-token-expired を返し、SSOは失敗します。');
      bad('  Sharegramでログインし直して、新しいトークンで再実行してください。');
    } else {
      ok(`有効期限まであと ${Math.floor((p.exp - now) / 60)} 分`);
    }

    header('3. Firebase プロジェクトの一致確認');
    const configured = process.env.FIREBASE_PROJECT_ID;
    info(`トークンのプロジェクト (iss/aud) = ${issProject}`);
    info(`サーバー設定 FIREBASE_PROJECT_ID = ${configured || '(未設定)'}`);
    if (!configured) {
      bad('FIREBASE_PROJECT_ID が未設定です。');
    } else if (configured !== issProject) {
      bad('一致しません。この設定では verifyIdToken は必ず失敗します。');
      bad(`→ FIREBASE_PROJECT_ID=${issProject} にしてください。`);
    } else {
      ok('一致しています');
    }
  }
} else {
  info('トークンが渡されなかったため、設定のチェックのみ実行します。');
}

// ---------------------------------------------------------------------------
// 4) 秘密鍵の形式チェック
// ---------------------------------------------------------------------------
header('4. FIREBASE_PRIVATE_KEY の形式');

const rawKey = process.env.FIREBASE_PRIVATE_KEY;
if (!rawKey) {
  bad('FIREBASE_PRIVATE_KEY が未設定です。');
} else {
  const hasLiteralNewline = rawKey.includes('\\n');
  const decodedKey = rawKey.replace(/\\n/g, '\n');
  info(`長さ = ${rawKey.length} / リテラルの "\\n" を含む = ${hasLiteralNewline}`);

  if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(decodedKey)) {
    bad('PEMヘッダー (-----BEGIN PRIVATE KEY-----) が見つかりません。');
    bad('Firebase Console > プロジェクトの設定 > サービスアカウント から');
    bad('「新しい秘密鍵を生成」で取得したJSONの private_key をそのまま入れてください。');
  } else {
    ok('PEMヘッダーを検出');
    try {
      crypto.createPrivateKey(decodedKey);
      ok('秘密鍵としてパースできました（\\n を実改行に変換后）');
      // server側のコードが同じ変換をしているか
      const src = fs.readFileSync(path.join(SERVER_DIR, 'middleware/firebaseAuth.js'), 'utf8');
      if (src.includes(".replace(/\\\\n/g, '\\n')")) {
        ok('server/middleware/firebaseAuth.js は \\n を実改行に変換しています');
      } else {
        bad('server/middleware/firebaseAuth.js に \\n の変換がありません');
      }
    } catch (e) {
      bad(`秘密鍵をパースできません: ${e.message}`);
      bad('→ 改行コード(CRLF)や途中の欠けを疑ってください。');
    }
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  if (!clientEmail) {
    bad('FIREBASE_CLIENT_EMAIL が未設定です。');
  } else {
    const keyProject = (clientEmail.split('@')[1] || '').replace('.iam.gserviceaccount.com', '');
    info(`FIREBASE_CLIENT_EMAIL = ${clientEmail}`);
    if (process.env.FIREBASE_PROJECT_ID && keyProject !== process.env.FIREBASE_PROJECT_ID) {
      bad(`サービスアカウントのプロジェクト(${keyProject})が FIREBASE_PROJECT_ID と異なります`);
    } else {
      ok('サービスアカウントのプロジェクトが一致しています');
    }
  }
}

// ---------------------------------------------------------------------------
// 5) 実際に Firebase で検証
// ---------------------------------------------------------------------------
if (rawToken && decoded) {
  header('5. Firebase による実検証 (admin.auth().verifyIdToken)');

  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !rawKey) {
    bad('設定が不完全なため検証をスキップしました（上の [FAIL] を解消してください）');
  } else {
    // eslint-disable-next-line global-require
    const admin = require('firebase-admin');
    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: rawKey.replace(/\\n/g, '\n')
          })
        });
      }
      admin
        .auth()
        .verifyIdToken(rawToken, true)
        .then((claims) => {
          ok('検証成功');
          info(`uid   = ${claims.uid}`);
          info(`email = ${claims.email}`);
          info('→ この設定のままなら POST /api/auth/firebase-session は成功し、');
          info('  Users テーブルにこのメールのユーザーが作成/更新されます。');
          process.exit(0);
        })
        .catch((error) => {
          bad(`検証失敗: ${error.code || ''} ${error.message}`);
          if (error.code === 'auth/id-token-expired') {
            bad('→ 新しいトークンで再実行してください（有効期限は1時間）');
          } else if (error.code === 'auth/id-token-revoked') {
            bad('→ パスワード変更などでトークンが無効化されています。ログインし直してください');
          } else if (error.code === 'auth/argument-error') {
            bad('→ トークンが壊れているか、別のプロジェクトのものです');
          }
          process.exit(1);
        });
    } catch (e) {
      bad(`Admin SDK の初期化に失敗: ${e.message}`);
      process.exit(1);
    }
  }
}
