# Backend security operations and blocked release gates

2026-09-28 — PR #6, Arena branch only. This runbook does not authorize production rollout or real account creation.

## 1. Admin invitation: explicitly disabled

`POST /api/admin/invitations` requires authenticated **local** reviewer authority. Ordinary user403, unauthenticated401; authorized local admin503 with `ADMIN_INVITATION_CONTRACT_REQUIRED`. It creates **nothing**: no account, invitation token, DB role or Firebase custom claim. This is a fail-closed placeholder, not a finished invitation service. No UI change or automatic default admin.

Before implementation, owners must approve:

1. Exact KYC-specific claim namespace/key/value, all consuming services, whether a KYC local admin requires a claim, and who owns shared-project claim writes. Do not use/invent a global admin/Sharegram grant. Firebase setCustomUserClaims replaces a claim map; independent read/merge/write writers can lose concurrent updates, so a coordinated writer contract is required.
2. Authorized inviter policy: local admin is necessary but who may grant/revoke admins, recovery/bootstrap authority and audit retention must be explicit. Historical account records are not authorization to seed an admin.
3. Real shared Firebase **TEST** project and authorized test identities, secure invite delivery mechanism, allowed return URLs, expiry policy, verified email requirements and revocation policy.

Proposed future server-only flow, **not currently implemented**:

* Authenticate inviter from DB; rate-limit and audit issuance. Bind immutable intended Firebase UID where known and normalized intended verified email. Client role fields never confer authority. Do not auto-link an existing account by matching email alone.
* Generate high-entropy one-time token; store only digest with inviter, target binding, expiration, state and audit correlation. Never log token, send it in normal API responses to unrelated users, or commit it. Avoid account-enumerating public errors.
* Redemption requires a recent verified/revocation-checked Firebase identity from the approved project, email_verified and exact UID/email binding. Row-lock token; reject expired/used/revoked/duplicate/conflicting invitations and already-admin cases according to approved idempotency policy.
* SQL role changes and external Firebase claim writes cannot be one SQL transaction. Use a coordinated, durable provisioning state machine/outbox, retry reconciliation and explicit compensation/revocation. Define which state authorizes access; no silently half-provisioned admin. Preserve unrelated claims through the approved coordinated writer, not an invented KYC claim map.
* Test duplicate concurrent redemption, issuer denial, binding mismatch, expiry, revocation, SDK/database failure windows, audit rollback, claim reconciliation and no unrelated Sharegram/global elevation before enabling endpoint.

## 2. Real isolated MySQL/MariaDB verification

### Actual result here

No MySQL/MariaDB binary/service available. Debian package downloads failed TLS; direct guarded runner attempt against loopback33079 failed `SequelizeConnectionRefusedError`. **Migration16 not executed on real SQL.** Unit mocks and runner configuration-guard tests are not substitutes. No SQLite/Emulator substitution.

### Reproduce safely when a disposable engine is available

Provision a dedicated **non-production disposable MySQL/MariaDB server**. Do not point at a production tunnel merely because its endpoint is loopback. Use test-only credentials via secure environment injection; do not paste credentials into chat, docs, command history or Git.

Runner requires explicit settings (it intentionally ignores app `.env`, MYSQL_* and app database config):

```
NODE_ENV=test
KYC_ISOLATED_DB_ACK=disposable-local-server
KYC_TEST_DB_HOST=127.0.0.1
KYC_TEST_DB_PORT=<explicit disposable server port>
KYC_TEST_DB_USER=<test-only SQL user>
KYC_TEST_DB_PASSWORD=<securely injected test-only password>
```

Run `node server/scripts/verify-isolated-security-db.js` from repository root. User must have create/drop privileges on the disposable engine. The runner generates a fresh `kyc_isolated_security_<random>` schema, never accepts an existing application database name, and drops only the schema it successfully created itself. If interrupted, have the test operator inspect that test schema; never run a wildcard drop. No Firebase/Sharegram calls or real application accounts are created.

Intended assertions, **SQL execution still unverified here**:

* Empty migration and rerun; unique owner mappings and multiple NULLs retain all rows.
* Duplicate owner mappings fail unique-index creation and leave the before/after rows identical.
* Existing incorrectly defined same-name index is rejected, not dropped/replaced silently.
* Concurrent duplicate insert permits only one mapping.
* Actual migration15 outbox schema: transient delivery retry retains event ID; audited manual replay preserves payload; audit failure rolls back SQL change; active lease excludes worker, expired lease is reclaimed, stale completion cannot overwrite newer fence.

Transport results in this runner are deliberately simulated even when SQL is real. It does not establish Firebase/receiver/network behavior. Preserve engine version, case result output and operator-approved environment evidence when actually run.

### Backup and duplicate-resolution rollout gate

1. Pause identity provisioning/mapping writes and decision workers according to an approved maintenance plan; identify all writers. Obtain encrypted, access-controlled backup/snapshot of **Users and dependent identity/performer/audit tables**, schema/index definitions, and migration metadata. Verify restore on isolated infrastructure. Do not dump PII to build logs/Git.
2. Inspect migration state and `SHOW INDEX FROM Users` with authorized DB tooling. Count duplicate non-NULL `sharegramUserId` groups privately; index collation may regard case/trailing-space variants as duplicates. Treat actual target-engine uniqueness as authoritative, not a JavaScript string comparison.
3. If duplicates exist: stop migration, preserve both identities and ownership/history. Open a restricted identity-resolution case with verified UID evidence and application/Sharegram owners. **Do not auto-delete, merge, null out or reassign mappings to get a green migration.** Resolution requires explicit approval, affected-performer analysis, audit and a reviewed correction plan.
4. Run isolated verification first, then reviewed migration on backed-up non-production dataset. Compare row counts/mappings and index definition, ensure unique violations fail safely, test rollback/recovery plan. MySQL DDL may auto-commit; a JS transaction is not a backup.
5. Production migration only after separate authorization and all release gates close. Migration16 down intentionally refuses to remove the identity integrity constraint; do not use destructive down as casual rollback. Restore/roll-forward requires controlled incident procedure.

## 3. Outbox discovery, retry and logs

Admin-only endpoints:

* `GET /api/admin/decision-outbox` defaults to pending+failed; `status=pending|failed|sent`, `limit=1..100` (default25), `offset=0..10000`. Returns summary fields only, `Cache-Control: no-store`; audit read required. No payload, owner identifier, document path or lease token.
* `POST /api/admin/decision-outbox/<event-UUID>/retry` body `{"expectedAttempts":8,"confirmation":"retry_same_event"}` (use **actual observed attempts**, not blindly8). Requires a failed row, matching attempts and no active lease. Conflicts409; never replays sent/pending. Cookie auth also requires same-origin Origin; explicit bearer must be valid.

Before retry: investigate safe error summary and receiver availability; fix credentials/destination through approved secret configuration, not a request payload. Confirm receiver supports event-ID deduplication. A timeout can mean the receiver persisted the event but its reply was lost. **Do not create a new event ID or edit payload to evade deduplication.** Avoid retry storms and do not bypass row locks using manual SQL updates.

Retry atomically resets pending/attempts/lease and records previous/new state plus event ID. Payload/eventType/event ID remain unchanged. Audit failure rolls back. Worker must be running with migrations applied and verified configuration; startup does not sync the schema. Failed configuration is fixed before consuming attempts. Worker emits only `{eventId,status,error}` with allowlisted summary, including lease_lost/STALE_LEASE; no secrets, PII, URLs or document paths. Legacy logging elsewhere is not certified by this change.

Delivery is **at-least-once**, bounded retry, not exactly-once. Lease expiry permits re-delivery with the same ID; fencing protects the local row, not external duplicate persistence. `sent` means accepted HTTP response, **not proven creator visibility or durable receiver storage**. Sender attempt reset does not erase audit history. Monitor oldest pending age, failed count and lease_lost frequency using restricted summary access; service-level thresholds and global destination rate limits require operator policy.

## 4. Real Firebase TEST → authorized Sharegram verification checklist

Blocked pending securely configured shared TEST project, authorized test identities/owners and authorized receiver endpoint. Never Emulator. No real-user/account creation is implied by this checklist.

For approved and rejected events separately:

1. Verify real test identity/UID/email binding, wrong-project/revoked/disabled rejection and cross-owner denials. Ordinary user cannot verify/approve/reject/invite. Confirm authoritative local admin identity without adding global/Sharegram claims.
2. Verify document-only action does not approve; required document checks, rejection reason, previous/new audit, final reject vs correction/resubmit and transaction outcomes on real SQL.
3. Capture only safe correlation evidence (event ID/status/error summary). Receiver operator verifies exact signature bytes and timestamp freshness, owner authorization and stable event-ID deduplication. Exercise invalid signature, stale timestamp, wrong owner, timeout/lost reply,5xx and repeated delivery.
4. Obtain receiver-side persisted event/dedup evidence and correct creator-visible status evidence; demonstrate a different owner cannot observe it. Sender HTTP200 alone is insufficient. Never put tokens, document files/paths, private user details or secrets in the report.
5. Record separate outcomes for sender commit, transport receipt, receiver persistence, deduplication and creator visibility. Until those observations exist all receiver claims remain **unverified**.

Other gates retained: legacy refresh/logout CSRF coverage, trusted ingress/proxy/Host policy, CSP compatibility, WS authentication, distributed revocation/replay/rate limits, V1 inventory and secret rotation. See the control matrix; no production readiness assertion is made.
