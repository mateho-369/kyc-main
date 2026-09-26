# SafeVideo KYC

Identity verification (KYC) system. React frontend, Node.js/Express API,
MySQL, and Firebase-based single sign-on for the Sharegram integration.

## Architecture

nginx terminates TLS, serves the built frontend as static files, and proxies
API and WebSocket traffic to a single Node process managed by PM2.

```
Browser
   |  HTTPS
   v
nginx --+-- /              -> /var/www/html        (React build output)
        +-- /api/  /auth/  -> 127.0.0.1:5002       (Express)
        +-- /ws            -> 127.0.0.1:5002       (WebSocket)
        +-- /uploads/      -> denied               (KYC documents are served
                                                    only through authenticated
                                                    API endpoints)
                                  |
                                  +-- MySQL   127.0.0.1:3306
                                  +-- Redis   127.0.0.1:6379
                                  +-- Firebase Admin SDK
```

| Component | Detail |
|---|---|
| Frontend | React 18 (Create React App), React Router, Tailwind CSS |
| Backend | Node.js 18 / Express 4, Sequelize |
| Database | MySQL 8.0 |
| Cache | Redis (rate limiting, token validation) |
| Auth | JWT sessions + Firebase Admin SDK (SSO) |
| Process manager | PM2, fork mode, single instance |

## Repository layout

```
src/            React application
server/         Express API
  routes/       Endpoint definitions
  models/       Sequelize models
  middleware/   Auth, CORS, CSRF, security headers, rate limiting
  utils/        Logging, helpers
public/         Static assets
docs/           API reference and Firebase SSO guide
```

## Requirements

- Node.js 18.20.x (not verified on 20+)
- MySQL 8.0
- Redis
- nginx

## Setup

```bash
npm install
cd server && npm install && cd ..

npm run env:setup    # .env.example -> .env と server/.env.example -> server/.env を作成し、
                     # JWT/セッション/暗号化キーを自動生成する（既存 .env は上書きしない）
# 残りは人がやる: MYSQL_PASSWORD / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
# （実行時に表示される「要記入」の並びがそのままチェックリスト）

npm start          # frontend dev server
cd server && npm start   # API

cd server && npm run db:setup  # migrate (schema from zero) + seed (accounts + demo data)
```

### Local Firebase Emulator (optional)

```bash
npm run emulator   # Auth 9099 / Firestore 8080 / RTDB 9000 / Storage 9199 / Hosting 5000 / UI 4000
```

- Uses `firebase.emulator.json` and the deny-all rules in `emulator/`. `firebase.json` and the
  root `*.rules` files are the deploy config and are not touched by the emulator.
- Accounts persist in `../firebase-data/` beside the KYC checkout (for example, `shargram-kyc/firebase-data/`). `npm run emulator` creates this folder only if it does not exist, imports its saved data, and exports updates there when the emulator exits. Existing data is preserved; do not delete it if you need the emulator accounts/UIDs.
- Enable it on the frontend with `REACT_APP_USE_FIREBASE_EMULATOR=true` and on the API with
  `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` (project id `demo-kyc-local` on both).
- Sending performers to Sharegram: [`docs/SHAREGRAM_KYC_WEBHOOK.md`](docs/SHAREGRAM_KYC_WEBHOOK.md).
- Receiving users from Sharegram (`/sso?token=...`): the URL the Sharegram side must build and
  the checks when it does not work — [`docs/SHAREGRAM_SSO_HANDOFF.md`](docs/SHAREGRAM_SSO_HANDOFF.md).

### Read this first

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — where each kind of change goes, the SSO
  flow, and the list of things that are not wired up (notifications, approvals, `/api/v1`).
- [`docs/CLEANUP-2026-09-24.md`](docs/CLEANUP-2026-09-24.md) — the 140 unreferenced files
  removed from `src/`, `server/` and the repo root, how that was verified, and how to restore.

API calls resolve their base URL in exactly one place, `src/config/apiBase.js`
(`REACT_APP_API_URL`, else the relative `/api`). When pointing the UI at a backend you
started by hand, set `REACT_APP_API_URL=http://localhost:5000/api` in `.env` —
otherwise `/api` goes to the dev `proxy` in `package.json`, which is a different server
with a different database. A dev build prints a console warning when this is unset.

### Seeding

After `npm run migrate` the database has the right *shape* but **zero users**. Three
seeders exist; all are idempotent, and `npm run seed` runs them in order
(or `npm run db:setup`, which is `migrate && seed`):

| seeder | what it does | needs env? |
| --- | --- | --- |
| `0001-seed-accounts` | creates a **normal user** and an **admin** you can log in with | no (defaults below) |
| `0002-promote-sso-admin` | promotes *your real Sharegram account* to `admin` | `SEED_ADMIN_EMAIL` |
| `0003-seed-demo-performers` | adds a few **performers** (and matching audit rows) to those accounts so the lists are not empty | no — skip with `SEED_DEMO_DATA=false` |

```bash
cd server
npm run migrate && npm run seed      # or: npm run db:setup
npm run seed:status                 # what has been applied
npm run seed:undo                   # down() both seeders
```

The dev accounts (only ever created outside production):

```
user@example.com   /  user123    role=user
admin@example.com  /  admin123   role=admin
```

These are deliberately weak and easy to type. What keeps them from becoming an
incident is that the seeder refuses to run in production at all (below), not the
password strength — so do not run this against a shared database.

Override any of it in `server/.env` — `SEED_USER_EMAIL`, `SEED_USER_PASSWORD`,
`SEED_USER_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`,
`SEED_ADMIN_ROLE`. Rules the seeders enforce, and why:

- **`NODE_ENV=production` aborts** with an error naming `SEED_ALLOW_INSECURE`, rather
  than quietly creating `admin@example.com` on a real database. Passwords shorter than
  6 characters are rejected before bcrypt, and a role outside the `ENUM('admin','user')`
  is rejected before MySQL can answer with `Data truncated`. (`manager` and `superadmin`
  do **not** exist in this column even though some frontend code mentions `superadmin`.)
- An existing row is never re-passworded: the seed only aligns `role`, and says so.
- `down()` (via `npm run seed:undo`) only **reports** what it could delete; nothing is
  destroyed until you set `SEED_UNDO_DELETE=true`, and a row carrying `firebaseUid` or
  `sharegramUserId` is never deleted even then — undo cannot remove a real SSO identity.
- `SEED_ADMIN_EMAIL` unset (or without an `@`) makes the second seeder a clean no-op.
- A Sharegram SSO sign-in still wins over all of this: `getOrCreateUserFromFirebase`
  matches by email, so `SEED_ADMIN_EMAIL=makara@gmail.com` promotes the row SSO uses and
  nothing else changes.

### "I seeded, but the dashboard still shows nothing"

That is usually not a seeding failure — it is a different table:

- the performer list and detail pages read **`performers`**, and `GET /api/performers`
  forces `userId = <your id>` for `role: 'user'`, so a brand-new account legitimately
  owns zero rows and the table is empty by design;
- the seeded accounts themselves are only listed on `/admin/users`, which needs an
  **admin** login (and `REACT_APP_API_URL` pointing at your local API, or the request
  goes to the dev proxy and you are looking at a different database);
- `cd server && npm run check:schema` prints the newest rows of `Users` with their
  roles — the fastest way to tell "not seeded" from "seeded, wrong page".

`0003` exists so the first bullet stops being a problem during development. It leaves
`documents` empty on purpose: a document entry with no file behind it renders a
preview/download button that fails, which reads exactly like a broken feature. Upload
through the UI when you need real files.

Do not run `npm run db:reset` on a database you care about: it is
`db:drop && db:create && migrate && seed`, i.e. it deletes the schema and every
row before rebuilding it.

## Configuration

Environment variables are not committed. Templates are provided as
`.env.example` and `server/.env.auth.example`.

### API (`server/.env`)

| Key | Notes |
|---|---|
| `NODE_ENV` | `production` in production. Controls error detail suppression and disables Sequelize auto-sync. |
| `PORT` | Defaults to **5000** (`server/server.js`). Under `docker-compose.yml` the container still listens on 5000 and is published to the host as **5002** (`"5002:5000"`); nginx/PM2 deployments front 5002. Whatever you run, use the `Server running on port N` line from the boot log — `REACT_APP_API_URL` must match it. |
| `DB_HOST` | Use `127.0.0.1`, not `localhost` — see "Operational notes". |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` | MySQL connection. |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET` | Random values. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Service account. Keep the private key quoted with literal `\n`. |
| `DISABLE_FIREBASE` | `false`. `true` is a development-only bypass and is rejected when `NODE_ENV=production`. |
| `SHAREGRAM_API_KEY`, `SHAREGRAM_WEBHOOK_SECRET` | Sharegram integration. |
| `ALLOWED_ORIGINS`, `CORS_ORIGIN` | Comma-separated. |

`FIREBASE_DATABASE_URL` should be left unset — Realtime Database is not used.

### Frontend

`REACT_APP_*` variables are inlined at build time, so changing them requires a
rebuild. They ship to the browser and must not contain secrets.

```
REACT_APP_FIREBASE_API_KEY
REACT_APP_FIREBASE_AUTH_DOMAIN
REACT_APP_FIREBASE_PROJECT_ID
REACT_APP_FIREBASE_STORAGE_BUCKET
REACT_APP_FIREBASE_MESSAGING_SENDER_ID
REACT_APP_FIREBASE_APP_ID
```

`src/config/firebase.js` falls back to default values when these are unset, so
a missing variable will not fail loudly. Keep the fallbacks and the environment
in sync.

## Build

```bash
CI=false GENERATE_SOURCEMAP=false npm run build
```

`CI=false` prevents warnings from being treated as build errors.

## Tests

```bash
npm test                    # frontend
cd server && npm test       # API
```

Coverage is partial. Some suites under `server/tests/` were written against a
specific developer machine and have only recently been made portable; treat a
green run as a smoke test rather than a guarantee.

## Security

Implemented and verified in the running system:

- HSTS (with preload), Content-Security-Policy, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`
- CSRF token issuance and validation
- Rate limiting on authentication endpoints (20 requests / 15 min per IP)
- bcrypt password hashing
- Webhook signature verification using HMAC-SHA256 with a constant-time
  comparison, failing closed when the secret is unset
- Uploaded KYC documents are not served as static files

Known weaknesses that have not been addressed:

- The CSP allows `'unsafe-inline'` and `'unsafe-eval'` in `script-src`
- JWTs are stored in `localStorage` on the frontend, so an XSS would expose them
- `xlsx`, used for audit-log export, has published vulnerabilities with no fixed
  release available
- `firebase-admin` is several major versions behind

## Operational notes

These are behaviours that have caused production incidents. Read before
deploying.

**`NODE_ENV` belongs in `server/.env`, not in the process environment.**
`server.js` picks its env file *before* dotenv runs: `production` makes it load
`.env.production`, which does not exist. Setting `NODE_ENV=production` in PM2
therefore drops every variable, including database credentials.

**Use `127.0.0.1` for `DB_HOST`.** With `bind-address = 127.0.0.1`, MySQL
listens on IPv4 only, while Node 18 resolves `localhost` to `::1` first. The
result is `ECONNREFUSED ::1:3306`.

**Express 4 does not catch rejected promises from async handlers.** An
exception inside a handler leaves the request unanswered until the proxy times
out at 60 seconds, and can terminate the process as an unhandled rejection.
Wrap new routers:

```js
const wrapRouter = require('../utils/wrapRouter');
const router = wrapRouter(express.Router());
```

**Always set `tableName` on Sequelize models.** Without it Sequelize pluralises
the model name, and MySQL on Linux treats `Performers` and `performers` as
different tables.

**Verify module resolution after dependency changes.** Packages that are
`require`d but missing from `package.json` have survived only as transitive
dependencies, and have been removed by dependency cleanup:

```bash
cd server && node -e "require('./server.js')" 2>&1 | grep "Cannot find module"
```

**`db:migrate` and `sequelize.sync({ alter: true })` fight over the same
schema.** In development the API syncs every model on boot
(`server/config/db.js`), so the columns exist before any migration is recorded.
An unguarded migration then stops on the first one:

```
== 20240101000001-add-firebase-integration-columns: migrating ==
ERROR: Duplicate column name 'firebaseUid'
```

and because a failed migration is never written to `SequelizeMeta`, every later
migration stays unapplied too — including the ones the running code depends on.
Migration `up`/`down` in `server/migrations/` are wrapped in
`server/utils/migrationGuard.js`, which skips only "already exists" / "can't
drop" errors and re-raises everything else, so a synced database can be brought
up to date in one pass (the skips are logged as `[migrate:<name>] SKIP ...`).

**Migrations now build a schema from zero.** `Users`, `performers`, `AuditLogs`
and `Videos` were created only by `sequelize.sync()` — no migration created them
— so `db:migrate` on an empty database stopped immediately:

```
== 20240101000001-add-firebase-integration-columns: migrating =======
ERROR: Table 'safevideo.users' doesn't exist
```

`server/migrations/20240101000000-create-base-tables.js` creates those four from
the model definitions (`Model.sync()` checks `tableExists` first, so it is a
no-op where the table already exists), which means a fresh environment — including
production, where auto-sync is off — can be provisioned with `npm run migrate`
alone. If you add a model, add a migration:
`server/tests/sso/migration-coverage.test.js` fails whenever a model table is not
created by any migration.

`server/config/config.js` (the file `sequelize-cli` loads) **is** committed and
holds no credentials — it resolves `MYSQL_*` / `DB_*` in exactly the same order
as `config/db.js`, so the CLI and the API cannot end up on different databases.
If a machine still has an old hand-written `config.js` with values hardcoded in
it, delete it and put those values in `server/.env` instead; keep the repo copy
clean. Without this file the CLI aborts before connecting:

```
ERROR: Cannot find "...\server\config\config.json". Have you run "sequelize init"?
```

Check the history and the schema state with:

```bash
cd server
npx sequelize-cli db:migrate:status   # what is already recorded
npm run check:schema                  # columns + SequelizeMeta + CLI-vs-app DB
```

## Current limitations

The deployment is deliberately simple, and the following are not in place:

- Single application instance. No load balancing, no zero-downtime deployment.
- No staging environment; `stg.` and the production hostname resolve to the
  same server and database.
- Deployment is manual (file transfer plus `pm2 restart`). Rollback is
  restoring a snapshot taken beforehand.
- No automated database backups.
- No metrics or alerting stack. Operational visibility is PM2 status and log
  files.
- Application code on the server is not under version control.

## Documentation

- [docs/API_Reference_Final.md](docs/API_Reference_Final.md)
- [docs/FIREBASE_SSO_GUIDE.md](docs/FIREBASE_SSO_GUIDE.md)
- [docs/SHAREGRAM_SSO_HANDOFF.md](docs/SHAREGRAM_SSO_HANDOFF.md)
- [API_DOCUMENTATION_SHAREGRAM.md](API_DOCUMENTATION_SHAREGRAM.md)

## License

Private and proprietary. All rights reserved.
