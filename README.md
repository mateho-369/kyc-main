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

cp .env.example .env
cp server/.env.auth.example server/.env
# fill in the values described below

npm start          # frontend dev server
cd server && npm start   # API
```

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

`sequelize-cli` loads `server/config/config.js`, which is **not** in the
repository — without it `db:migrate` fails on a fresh clone. Copy the template
and confirm it points at the same database the API uses:

```bash
cd server
cp config/config.example.js config/config.js   # then edit only if you must
npx sequelize-cli db:migrate:status            # what is already recorded
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
- [API_DOCUMENTATION_SHAREGRAM.md](API_DOCUMENTATION_SHAREGRAM.md)

## License

Private and proprietary. All rights reserved.
