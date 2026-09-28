# Local testing → production handoff (real data only)

The temporary preview, mock API/localStorage override, fake login credentials, mock role switcher and sample-account seeders have been removed. The normal UI/design remains. Requests now use the actual API; an unavailable backend/Firebase fails instead of returning synthetic success. No existing database records were deleted.

**Production is not yet approved.** Real migration/identity/Sharegram integration and the security gates below still need your environment. Admin invitations remain disabled, not secretly replaced by a seed script.

## 1. Install and configure

Use a maintained Node.js LTS (Node22 recommended), npm, MySQL8/MariaDB-compatible SQL and Redis. Docker is optional. From repository root:

```sh
npm ci
npm --prefix server ci
npm run env:setup
```

`env:setup` creates root `.env` (frontend) and `server/.env` (backend), generates empty local secrets privately, keeps existing values, and never creates accounts. Do not use `--force` on existing configuration. Do not commit those files. On existing checkouts, update values yourself: setup deliberately does not overwrite old API URLs/settings.

* Frontend: `REACT_APP_API_URL=/api`, port3000. Remove old `REACT_APP_UI_PREVIEW`, `REACT_APP_FIXTURE_BUNDLE`, `REACT_APP_USE_MOCK_API` settings from **all** `.env*` files. The build guard rejects enabled legacy flags. The old browser `USE_MOCK_API` setting is inert; clear old site data/service workers once to discard old bundles/session data (do not clear another application's origin).
* Firebase: fill all six frontend Web App fields and backend `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` from the same **authorized shared TEST project** used by Sharegram. Put service-account private keys only on the backend. No Emulator. Authorize your localhost origin/SSO return URLs in the TEST configuration.
* Backend: set actual local MySQL credentials, separate long JWT secrets, Redis address, `DISABLE_DB=false`, `DISABLE_FIREBASE=false`. Never reuse production DB/credentials for local tests. Configure the optional Sharegram URLs only if you have authorized test services.
* API/browser routing: use `http://localhost:3000`; `/api` goes through CRA to loopback5000, not staging. Do not set browser API URL to another port when using cookie auth. CRA rewrites Origin to its local proxy target; the local example includes that exact origin. Never use the development server as production hosting.

### Optional fresh local dependencies (Docker)

```sh
docker compose --env-file server/.env -f compose.local.yml up -d
docker compose --env-file server/.env -f compose.local.yml ps
```

For this compose configuration set backend `MYSQL_HOST=127.0.0.1`, `MYSQL_PORT=3307`, `MYSQL_DATABASE=kyc_local`, `MYSQL_USER=kyc_local`, `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6380`. `env:setup` generates blank MYSQL_PASSWORD and LOCAL_MYSQL_ROOT_PASSWORD; neither is printed. Compose binds services to loopback only, creates a schema/service DB user, **not KYC accounts**. Wait for MySQL healthy before migrating. Existing named volumes retain their original passwords; changing `.env` does not rotate them. Never run `down -v` against data you need.

Alternatively create an empty `kyc_local` database and dedicated least-privilege DB user using your own local engine. App user needs appropriate migration DDL permissions for setup, then reviewed runtime permissions. Do not use root for the API.

## 2. Migrate, then start actual services

```sh
npm --prefix server run check:config
npm --prefix server run migrate:status
npm --prefix server run migrate
npm --prefix server run migrate:status
```

Migration CLI is pinned and explicitly reads `server/config/config.js`. App, worker and CLI select local `.env` versus production `.env.production` without borrowing missing values from the other environment. Startup no longer calls `sync({alter:true})` even in development. `db:setup` only migrates. `seed`/legacy admin promotion fail closed; `db:reset` is disabled. Do not use old seed/reset documentation.

Run in separate terminals:

```sh
npm --prefix server start
npm start
```

Visit **http://localhost:3000**. Empty data is expected on a new DB. Use your authorized real TEST identity through the supported Firebase/Sharegram login flow; create only test records you are authorized to create. No default admin password or simulated user is supplied. If you have no already-authorized KYC local admin, reviewer testing is **blocked** until an approved provisioning procedure/claim contract is agreed. Do not promote by guessing an email or restoring the old seeder.

## 3. Verification

```sh
npm test
npm --prefix server run test:sso -- --runInBand
npm run build
```

These automated suites use isolated test doubles, not application demo data. Build includes pre/post guards against runtime fixtures. A passing compilation is not proof of correct Firebase credentials or database connectivity.

For real migration16 duplicate/unique behavior and real SQL outbox fencing, run `npm --prefix server run test:isolated-db` with the explicit `KYC_ISOLATED_DB_ACK` and `KYC_TEST_DB_*` settings in [the operations runbook](docs/backend/security-operations-runbook-2026-09-28.md). Only a **disposable local engine** with test-only create/drop privileges is permitted. This runner creates/drops its own random schema, never your `kyc_local` DB. Its transport is simulated even when SQL is real. Do not replace the real-engine result with unit mocks.

Manual acceptance:

- Own user can create/read/edit only own eligible records; another user is denied.
- Non-admin cannot verify, approve, reject, invite or operate outbox.
- Document verification alone does not approve; final approval requires all three verified documents and becomes active+verified.
- Final reject retains reason/prior/new audit; correction/resubmission stays distinct.
- Failed network/API calls show errors, not fake success/data.
- Real receiver validates owner/signature/timestamp, persists/deduplicates same event ID, and shows status only to the correct creator. Verify separately for approve/reject and lost reply/5xx.

To enable actual V2 delivery, configure authorized `KYC_DECISION_WEBHOOK_URL`, exact `KYC_DECISION_WEBHOOK_ALLOWED_HOSTS` and separate >=32-byte `KYC_DECISION_WEBHOOK_SECRET`, then run:

```sh
npm --prefix server run worker:decisions
```

Without a configured running worker, persisted decisions stay pending; that is not confirmed Sharegram delivery. Receiver must be approved public HTTPS; sender intentionally blocks private/localhost destinations. Legacy V1 notifications are separate and left unconfigured by the template. Admin outbox operations/runbook explain discovery and safe replay.

## 4. Production: separate reviewed deployment, not automatic promotion

1. Close the gates in [security control matrix](docs/backend/security-control-matrix-2026-09-28.md): actual SQL migration/rollback evidence, real Firebase TEST→Sharegram owner/persistence/dedup/visibility, invitation contract if needed, proxy/CSRF/CSP/WS/distributed rate/revocation controls, secret rotation and V1 inventory. Invitation remains503 until implemented; do not advertise it as available.
2. Back up and test restoring production identity/performer/audit/outbox data. Investigate duplicate identities without automatic delete/merge. Approve a migration maintenance/roll-forward plan.
3. Provision separate production secrets/DB/Redis/service account and authorized receiver. Set `NODE_ENV=production` **before** launching CLI/API/worker; use secure injected environment or `server/.env.production`, never local .env. Set exact HTTPS origins, `HOST=127.0.0.1` behind a same-host reverse proxy, appropriate network ACLs and persistent private upload storage. Never put Admin SDK/JWT secrets in REACT_APP_*.
4. In a clean release workspace, supply production public Firebase web configuration, `REACT_APP_API_URL=/api`, secure cookies and approved Sharegram URLs, then `npm ci && npm run build`. CRA's `.env.local` can override production settings: do not copy local override files into CI. Deploy only this freshly built `build/` plus reviewed backend; never use the old preview artifact.
5. Install backend including pinned migration CLI in the release migration job (`npm --prefix server ci`), run `check:config` and reviewed migrations with NODE_ENV=production, then run API and decision worker under a supervised non-root service. Runtime installs may omit dev dependencies after the separate migration job. Configure restart/shutdown/log retention/monitoring explicitly.
6. Serve over HTTPS on one origin. `deploy/nginx.production.example.conf` is a starting example, **not ready-to-install TLS policy**: edit hostname/certificates/paths; reject unknown hosts, restrict backend port, configure trusted proxy/IP handling and reviewed CSP. Public uploads and WebSocket upgrades are intentionally blocked in the example.
7. Smoke-test login, owner boundaries, review/audit, queue/retry and receiver visibility, with authorized accounts only. Monitor failures/oldest pending, retain backups, and use the approved roll-forward procedure. Do not run seed/down/reset as rollback.

## Results in this sandbox

No live DB/Firebase/Sharegram calls or account provisioning were performed by this cleanup. Docker/local SQL infrastructure is not available here; compose and real migrations still require local execution. Production build compiled with existing lint warnings and passed the no-fixture artifact guard. Final verification: backend **25 suites / 244 tests passed**, frontend **8 files / 55 tests passed**; production frontend build compiled (existing lint warnings), artifact scan passed, enabled preview flag correctly rejected, and missing local config correctly rejected. No compose/live integration execution is claimed. Test counts changed because preview tests and tests expecting default account creation were replaced by removal/fail-closed regressions.
