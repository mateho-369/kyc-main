# 構造ガイド（どこに何があり、どこへ足すか）

このリポジトリは**独立した2アプリ**です。共通のビルドも共通の `node_modules` もありません。

| 領域 | 場所 | 起動 | 説明 |
| --- | --- | --- | --- |
| 管理画面（フロント） | `src/` | `npm start`（:3000） | Create React App。`src/index.js` → `src/App.jsx` が唯一のエントリ |
| API（バックエンド） | `server/` | `cd server && npm start`（:5000） | Express + Sequelize。`server/server.js` が唯一のエントリ |

`server/` を触るときは **cwd を `server/` にする**こと（`.env` と `config/config.js` を
カレント基準で読むため）。ルートから `node server/server.js` をすると env が読めません。

---

## 1. フロントエンド（`src/`）

```
src/
├── index.js            # 起動のみ。ここ以外に ReactDOM.render を書かない
├── App.jsx             # ルーター＋レイアウト。ページ追加はここ（Public / Protected を区別）
├── config/
│   ├── apiBase.js      # ★ APIベースURLの唯一の決定元（REACT_APP_API_URL || '/api'）
│   └── firebase.js     # 共有 Firebase SDK 設定
├── contexts/AuthContext.jsx  # ログイン状態の単一ソース（localStorage + /auth/me + SSO）
├── services/
│   ├── SecureApiClient.js    # ★ 全ての /api 呼び出しはこれを通す（CSRF・Firebaseトークン・401処理）
│   ├── api.js               # 旧クライアント（refresh/cookie 系のみ）。新規は使わない
│   ├── performerService.js  # 出演者 CRUD・書類
│   ├── auditService.js      # 監査ログ一覧・CSV/XLSX エクスポート
│   └── auth.js              # 従来ログイン
├── pages/               # ルートに紐づく画面のみ。再利用できない UI はここ
├── components/          # 複数画面で共有する UI
│   ├── Header.jsx       # ロゴ／メニューボタン（狭い画面）／ユーザー／ログアウト
│   └── Navigation.jsx   # サイドバー（lg以上は常時、未満はドロワー）
└── utils/               # 画面に依存しない純関数（テストしやすくする場所）
    ├── sharegramReturn.js  # Sharegram への戻り先URL検証（SSOPage と登録画面が共有）
    ├── ssoToken.js         # /sso に届く token の取り出し（クエリ/ハッシュ/別名）
    └── authToken.js        # ★ access token の保存キーはここだけ（'accessToken' に統一）
```

**追加時の規則**

1. API を叩く → `services/<対象>Service.js` に関数足し、画面はそれを呼ぶ。`axios` を画面で直接 import しない。
2. ベース URL・URL組み立ても変えない → `config/apiBase.js` が決めるまで。
3. 画面分割は「状態を持たない表示部品」だけを `components/` へ。状態とAPI呼び出しはページに残す。
4. バックアップファイル（`*.backup*`, `*.fixed.jsx`, `*.hotfix.jsx`, `*.improved.js`）は作らない。
   git が履歴なのでコピーで保存する物はゼロ。`.gitignore` で禁止済み。
5. テストは `npx vitest run`（jsdom）。純ロジックは `src/**/__tests__/*.test.js`。

## 2. バックエンド（`server/`）

```
server/
├── server.js            # ミドルウェアとマウント表（app.use）はここ1箇所
├── config/
│   ├── db.js            # アプリが使う接続（.env を読む）＋ development の sync(alter)
│   └── config.js        # sequelize-cli 用（migrate/seed）。同じ .env を読む
├── models/index.js      # ★ モデルの静的リスト。新モデルはここに追加しないと使えない
├── middleware/          # auth（JWT）/ firebaseAuth（Sharegram IDトークン）/ checkRole / hybrid-auth
├── routes/              # HTTP 層。ビジネスロジックは services/ へ逃がす
│   ├── auth-firebase-standard.js  # ★ Sharegram SSO（POST /api/auth/firebase-session）
│   └── performers.js              # 出演者 CRUD・書類・approve（:1213）
├── services/
│   └── sharegram/sharegramAccountService.js  # API照会＋JWT claimsから表示情報を正規化
├── utils/
│   ├── requestToken.js  # ★ 保護APIのトークン解決（Authorization → Cookie → refresh）
│   └── auth.js          # setAuthCookies / clearAuthCookies（Cookie の唯一の定義）
├── migrations/ + utils/migrationGuard.js     # 冪等マイグレーション（1050/1051/1060/1061/1091のみ無視）
├── seeders/             # SEED_ADMIN_EMAIL で admin を昇格（未設定なら no-op）
├── scripts/             # diagnose-sso-token.js / check-user-schema.js / healthcheck.js
└── tests/sso/           # ★ MySQL 不要の回帰テスト（npm run test:sso）
```

**追加時の規則**

1. ルートは `server.js` に `app.use('/api/...', require('./routes/x'))` で登録。
   登録していない route ファイルは**存在しても動かない**（過去にこれが原因で
   「APIが生きているのに404」が起きた。未マウント一覧は下記）。
2. モデルは `models/index.js` のリストに明示追加（`fs.readdirSync` での自動読込はしていない）。
3. DDL は migration で書き、`makeSafe(queryInterface, id)` を `up()`/`down()` の先頭に置く。
4. ロール制限は `checkRole([...])` を middleware に。ハンドラ内の `req.user.role` 直接比較は
   `routes/performers.js` に既存の形があるので、そこだけ追従する。
5. 「失敗時にダミーのユーザーやダミーの成功を作る」分岐は作らない（このプロダクトで
   最も高価なバグだった。SSO は fail-closed、503 を返す）。

## 3. Sharegram SSO の流れ（現状の実装）

```
Sharegram FE (:3000)
  └─ /sso?token=<Firebase ID token>&come_back=...&action=create
      └─ KYC FE (:3300) SSOPage
           ├─ token を解決: クエリ → ハッシュ → （同じブラウザの Firebase サインイン）
           │    └─ 見つからなければ「tokenパラメータが送られていません」と明示して停止
           ├─ POST /api/auth/firebase-session  { idToken }      ← 3つのヘッダーにも同値を載せる
           │    └─ middleware/firebaseAuth: verifyIdToken(project adroit-standard-496710-r5)
           │         ├─ Sharegram 口座APIで名前・avatar を補完（失敗しても継続）
           │         ├─ getOrCreateUserFromFirebase: email → users 行を作る/再利用
           │         │    └─ profilePicture は URL でない・512字超なら NULL（Users は varchar(512)）
           │         └─ FirebaseUsers に uid マッピング（1行のみ）
           ├─ setAuthCookies（httpOnly access/refresh）＋ 応答の token を localStorage へ
           │    └─ 保存キーは utils/authToken.js の 'accessToken' のみ
           ├─ AuthContext.setUser（表示名は claims か Sharegram API、Test User には絶対フォールバックしない）
           └─ come_back が安全（http/https・512字以内）なら navigate、無ければ /performers/add
```

保護API（`/api/performers`, `/api/dashboard/stats`, `/api/admin/users` …）は
`utils/requestToken.js` 経由で **Authorization → Cookie → refresh Cookie** の順に
トークンを解決する。以前は `/api/auth/me` だけが Cookie を見ていたため、
Cookie セッションなのに「me は 200、保護APIは 401」という食い違いが起きていた。

送信側（Sharegram）が守る URL 仕様と実装例: [`SHAREGRAM_SSO_HANDOFF.md`](SHAREGRAM_SSO_HANDOFF.md)

## 4. いま「配線されていない」もの（見つけたら壊れていて当然の箇所）

| 項目 | 状態 |
| --- | --- |
| 通知ベル | バックエンドに通知APIなし。UIは「未実装」表示（未読バッジは嘘だったので削除） |
| `POST /api/performers/:id/approve` | 生きている（admin限定）が、**これを呼ぶボタンがフロントに無い**。書類ごとの「検証」ボタンは `PerformerDetailPage` に追加済み（`PUT /:id/documents/:type/verify`）で、出演者単位の approve（kycStatus 確定）だけが未実装 |
| `/api/v1/*` | `server.js:169` でマウントがコメントアウト。front からの v1 呼び出しは 404 |
| 動画まわり | 半端実装ごと削除（`/videos` は空のレイアウトを描画するだけのルートだった） |
| モックAPI（`mockApiService.js`） | `REACT_APP_USE_MOCK_API=true` か localStorage `USE_MOCK_API` でだけ発動。デモ用の架空データと架空adminパスワードを含むので、本番ビルドでは有効にしないこと |

## 5. 確認コマンド

```bash
npx vitest run                     # フロントのユニットテスト（jsdom）
CI=false npx react-scripts build   # 型・import_graph の健全性
cd server && npm run test:sso      # SSO とマイグレーションの回帰（MySQL 不要）
cd server && npm run migrate:status
cd server && npm run check:schema  # Users の列と最新ユーザー（role 含む）
cd server && node scripts/diagnose-sso-token.js "</sso?token=... URL>"   # npm 経由は & で割れる
```
