# KYC review audit and staged implementation — 2026-09-28

## Baseline and scope

- Clean worktree at start; working branch `arena/01a0e712-kyc-main`.
- Fetched `origin/main`: `f7eac65ea24696ece2decbde3a1fcbf08b0548a2`, identical to HEAD.
- GitHub confirms PR #5 merged at 2026-09-28T08:08:19Z with that merge SHA.
- Fetched original upload `9e5e7aff1c0e9c5cfdb4f73d940c0d27861bd641` (initial checkout lacked the object). Compared committed objects with `git show` / `git diff`, not the edited worktree.
- No UI, Sharegram repository, credentials, users, performers or database contents changed. No Firebase Emulator used. No branch switch or push.
- This is a first hardening tranche, **not completion of the requested approval/rejection/invitation/outbox system**.

## Baseline route graph BEFORE this patch (server/server.js, not inferred from documentation)

| Mounted prefix | Actual implementation / limitations |
| --- | --- |
| `/api/performers` | `routes/performers.js`: GET collection/detail; POST create; PUT detail (multipart uploads); GET documents, metadata and files; PUT `/:id/documents/:type/verify`; POST `/:id/approve`; POST `/registration-complete`; POST `/sync`; POST `/kyc-approved`; DELETE detail. No performer reject or document reject endpoint. |
| `/api/documents` | `routes/api/documents.js`: external-ID document read/cache invalidation. Its access logic consumes both `status=active` and `kycStatus=verified`. |
| `/api/admin/users` | `routes/admin-users.js`: GET list and GET detail; `auth` + DB admin role check. No create, invite or role-management endpoint. Admin reads here lack dedicated access audit. |
| `/api/audit-logs`, `/api/dashboard` | Mounted; audit log route is protected at mount by auth/admin. |
| `/api/sharegram` | SSO prepare/consume, health; auth-result/user-register/integration/webhook handlers are explicitly not implemented (fail rather than fabricate success). |
| `/api/sharegram/performers` | Owner-scoped external reads. Preserve UID/Sharegram-ID separation from local user PKs. |
| `/api/auth`, `/auth` | Several legacy and Firebase auth routers coexist. Sharegram SSO router also mounted at `/api/v1/auth`. |
| `/api/v1` | General v1 router commented out. **This does not disable the separately mounted `/api/v1/auth`.** |
| `/api/webhooks`, `/api/integration`, batch documents, `/api/kyc` | Commented out at startup. Do not enable wholesale to obtain a reject endpoint. |

Dormant `routes/api/v1/kyc.js` has request creation, document upload, submission, review approval/rejection and Sharegram verification-result ingress. It calls `services/kyc/kycService.js`. Those are not the mounted performer review flow. The mounted `/api/performers/kyc-approved` ingress uses `SHAREGRAM_WEBHOOK_SECRET`, ISO-style timestamp freshness (5 minutes) and timing-safe HMAC comparison over timestamp + JSON.stringify(parsed body). It is **not raw-body signature verification**. It updates KYC, not performer approval. It lacks a durable replay ledger and writes audit fields inconsistent with AuditLog's non-null userId/details schema. It needs separate remediation and contract verification.

## Data and semantics

- `models/Performer.js`: `status`: pending/active/inactive/rejected. `kycStatus`: not_started/in_progress/verified/rejected/expired. These are independent columns, not synonyms.
- Performer documents are a JSON object (or MariaDB JSON string), with verified/verifiedAt/verifiedBy per document. Existing required set is agreementFile, idFront, selfie. selfieWithId and idBack are separate optional slots; do not silently substitute them without a rule.
- `kycMetadata` exists, but there is no dedicated durable performer-decision history/rejection record. AuditLog has required local userId, action, resourceType, resourceId; details is JSON and createdAt is the timestamp.
- `models/KYCRequest.js`: draft/submitted/in_review/approved/rejected/expired, reviewedBy/reviewedAt/rejectionReason. Model approve/reject require in_review. The dormant service updates performer's KYC status; this is not the mounted final performer decision route.
- `models/KYCDocument.js`: pending/verified/rejected/tampered, distinct from performer documents JSON.
- `models/KYCVerificationStep.js`: pending/in_progress/completed/failed/skipped.
- `User.role` permits only admin/user. No superadmin. Local ownership is Performer.userId; external identity includes User.firebaseUid, User.sharegramUserId, Performer.sharegramUserId and external_id. Do not use email alone as the owner key.
- Before this patch, document verification automatically activated the performer and emitted approval, but did not set verified KYC. Approve also only set active. This mismatch explains why “active” alone cannot prove KYC or visibility to an external consumer.

## Authentication and admin provisioning

`middleware/hybrid-auth.js` loads a local user for JWT auth and checks account lock/activity. It also assigns a synthetic admin with no user ID to explicitly configured system API keys. Previously document verification bypassed admin checks for Sharegram credentials, while approval's role check alone admitted synthetic admins. The new reviewer guard denies integrations, missing/invalid local IDs and non-admin roles for those two endpoints.

`middleware/auth.js` also loads the local DB user. Mounted SSO flows create ordinary users and retain local DB role. `routes/auth-firebase-sso.js` embeds local role in custom-token claims. Disabled `auth-firebase-v2.js` has separate claims-management code; its existence does not make it an active admin API. Mounted `auth-firebase-standard.js` also has a self-service firebase-claims endpoint setting Sharegram ID/permissions and replacing claims. This requires security/compatibility review before any new invitation claim sync. Do not introduce a global Firebase admin claim that could grant unintended Sharegram privileges.

`admin@example.com` is a sample account in `seeders/20240101000001-seed-accounts.js`. Its existence/role in a real DB is **unverified**. `0002-promote-sso-admin` promotes an email selected via environment or creates a local SSO placeholder with a random password. These seeders are not a verified invitation flow, do not establish Firebase claim reconciliation, and can alter existing local roles. The accounts seeder has production safety controls but permits an explicit insecure override; never deploy defaults or use that override in production.

Proposed invitation design (not implemented): local admin initiates a narrowly scoped invite, normalized email uniqueness, hashed single-use expiring token, acceptance bound to a verified Firebase UID/email from the shared test project, transactionally recorded acceptance/role/audit, duplicate and race protection, revocation/expiry, and no role field trusted from public input. Decide whether only local KYC privileges are intended. If claims are required, use a KYC-specific namespaced claim with a reconciliation job preserving unrelated claims. No shared-project privilege change without approval.

## Outgoing Sharegram contract and reliability

`services/sharegram/sharegramWebhook.js` currently emits performer.created/updated/approved/deleted and document.verified. There is no performer.rejected. Envelope is `{id, event, occurredAt, data}`; headers X-KYC-Event/Delivery/Timestamp/Signature. Timestamp is UNIX seconds. HMAC-SHA256 covers `${timestamp}.${rawBody}`, and those exact serialized bytes are sent. The same delivery ID/body are reused within the three in-memory attempts (1s/3s delays); network/5xx/429 retry, other 4xx stop. No redirects; production HTTPS is required; missing secret fails closed. Secret length only warns, and a hardened destination allowlist/egress policy is absent.

Payload excludes paths, binary, DOB and address, but includes names, owner email, local IDs, external IDs and Firebase UID when lookup succeeds. Owner lookup failure currently permits null owner. A minimal versioned decision envelope should fail closed on unresolved required stable identity, omit names/email/document detail, and contain eventId/eventType/occurredAt, performer ID/external ID, stable owner UID/Sharegram ID and final statuses. Do not change the existing consumer envelope silently.

There is a second, legacy `services/webhookService.js` sender with a separate contract and configured integrations. Final decisions no longer invoke this sender after the follow-up implementation below; other callers still require a security/reliability review.

No real Sharegram receiver exists in this repo. The local test receiver is a contract test double, not evidence of real Sharegram persistence, deduplication, timestamp validation or acknowledgement semantics. HTTP 2xx is not proof of a stored creator record. Owner visibility and event delivery remain distinct problems.

Proposed next implementation:

1. Immutable decision table with reviewer/reason/reasonCode/time and old/new statuses; explicit transition validator. Lock the performer during decisions.
2. Durable outbox row in the **same DB transaction** as performer and decision/audit. UUID event ID, immutable minimal payload, pending/sent/failed, attempts, nextAttemptAt, sanitized lastError, lease/claim expiry. Worker claims atomically; crash recovery and at-least-once delivery, not exactly-once.
3. Dedicated worker process fitting existing Node/container deployment; bounded attempts/exponential backoff, admin retry with same event ID. Startup/config validation, HTTPS, minimum secret strength, operator-owned allowlisted destinations and egress restrictions. Do not store secrets in payload/error logs. Record sent only after receiver HTTP success, with documentation of its limited meaning.
4. Keep API response about committed decision plus outbox state; do not wait for remote delivery. Receiver support for new events/version and deduplication remains an external dependency.
5. Fix ingress raw-body capture/strict schema/signature freshness/replay protection independently, without mounting dormant APIs.

## State machine presented for confirmation (subsequently approved below)

| Action | Proposed transition |
| --- | --- |
| Submit complete application | pending / in_progress |
| Verify a document | Only that document and audit change; readiness does not decide performer or KYC |
| Approve complete, verified application | pending / in_progress → active / verified; record reviewer/time and verifiedAt |
| Final rejection | pending / in_progress → rejected / rejected; required reason, optional controlled reasonCode; preserve immutable history |
| Request correction | Separate decision from final rejection; pending review lifecycle with explicit correction record, not an overloaded final rejected state |
| Resubmit | Explicit owner-scoped transition; reset only replaced documents' verification, start a new review version, preserve history |
| Re-review active/rejected/expired | Explicit authorized action, never ordinary generic PUT or blind approve |

Open decisions: final rejection versus corrections; eligibility for re-review; exact mandatory documents; whether admin approval is itself the authoritative KYC verification or requires external KYC first. Also review `/sync`, generic updates and KYC ingress: they can change documents/status outside final decisions. Until these alternate writers share the validator/locking strategy, the full state machine is not secure. Row locks in this patch only serialize these review endpoints, not all writers.

## Confirmed decisions and final implementation in this branch

The user selected: (1) final rejection plus separate correction/resubmission; (2) admin approval authoritatively sets active + verified after the three required documents are verified; (3) eventual admin invitation must use a KYC-specific Firebase claim, not global/shared admin. The precise claim/consumer contract remains unconfirmed, and invitation is deferred for the reasons below.

### Implemented APIs (mounted under `/api/performers`)

| Method/path | Authorization | Result |
| --- | --- | --- |
| PUT `/:id/documents/:type/verify` | Local admin reviewer | Document-only verification + audit, no automatic approval |
| PUT `/:id/documents/:type/reject` | Local admin reviewer | Required reason (trimmed, 1–2000 chars), document reviewer/time/reason and audit; no performer rejection |
| POST `/:id/approve` | Local admin reviewer | Requires pending performer, not_started/in_progress KYC, no outstanding correction, all agreementFile/idFront/selfie verified; active/verified + decision/audit/outbox |
| POST `/:id/reject` | Local admin reviewer | Required reason, optional uppercase `reasonCode` (max 64); pending review → rejected/rejected + decision/audit/outbox |
| POST `/:id/request-correction` | Local admin reviewer | Pending review remains pending/in_progress, metadata.reviewState=correction_required; reason/reviewer/time kept in immutable decision row, no external final-decision event |
| POST `/:id/resubmit` | Local owner or local admin | Only correction_required → submitted, all required documents present; audit references previous decision; previous decisions retained |
| POST `/registration-complete` | Local owner or local admin | Required documents present, pending/reviewable state → in_progress/submitted; correction must use resubmit |
| GET `/:id/review-history` | Local admin reviewer | Latest 100 decisions and 100 notification statuses, auditable read; no raw outbox payload returned |
| PUT `/:id` | Existing owner-scoped authorization | Now locks row + transaction, refuses final/invalid review states; replacement document loses verification; name changes reset document verification; does not delete old file during transaction |

DELETE also locks the row and refuses final states, preventing a delete/decision race. Pending deletion retains file evidence for a separately authorized retention/erasure policy. Review transactions lock performer rows. Audit failure/outbox insertion failure rolls the entire final decision back. `previousStatus` and `previousKycStatus` are captured before mutation. Decision history preserves reviewer ID, timestamp, reason/reasonCode and previous/final statuses. API returns `{performer, decisionId, notification: {eventId, status: "pending"}}` for approve/reject. Correction returns notification=null. It never reports receiver storage success.

System API credentials, synthetic admins with no local ID, ordinary users and body/query `role` values cannot act as reviewers. Existing owner scoping is preserved. No new superadmin enum. No real accounts created. Required documents are the existing trio, not a newly invented requirement. Approvals currently have no automatic expiry (kycExpiresAt=null); an expiry/re-review policy still needs product definition. Legacy inconsistent active/not_started records are not silently backfilled or approved.

Final rejection is terminal in this implementation. Repeated final decisions return 409 rather than enqueueing a second event. Re-review/reopen of active/rejected/expired records is not implemented. Correction/resubmission is distinct and keeps history. Resubmission does not silently re-verify replaced documents.

### Important compatibility changes / deployment gate

**`POST /api/performers/sync` and `/api/performers/kyc-approved` now return 409 with explicit contract-required codes and make no writes.** Their old implementations could bypass the authoritative admin decision state machine (including importing verified documents/status). They were removed rather than left as bypasses. The old ingress's signature contract/replay flaws are therefore not treated as fixed or accepted: ingress is closed pending a trusted external-evidence-only contract. This is a breaking backend API change that must be communicated to integrations before rollout. General `/api/v1` remains unmounted.

Final approval no longer invokes either the legacy integration sender or the old in-memory Sharegram sender. Instead it enqueues v2 only. Existing created/updated/deleted/document.verified events still use the old sender, unchanged; those are best effort, can still include names/email and have no outbox durability. No document.rejected/correction event is invented for an unknown consumer.

PerformerDetailPage/performerService inspection found document verification controls but no final approval control. Operators need authenticated admin API calls until a separately authorized UI task supplies controls. No UI files changed.

### Durable decision events

New `performer_decisions` and `decision_outbox` models/migration. Decision ID doubles as the stable event ID for a final decision. No cascade foreign keys: decision/event records remain if a performer/user is later removed. There is no update/delete decision API. Outbox has pending/sent/failed, attempts, nextAttemptAt, leaseUntil/token, sanitized lastError and sentAt.

V2 payload (intentionally a separate destination/consumer contract):

```json
{
  "schemaVersion": 2,
  "eventId": "UUID",
  "eventType": "performer.approved or performer.rejected",
  "occurredAt": "ISO timestamp",
  "performer": { "id": 123, "externalId": null, "status": "active", "kycStatus": "verified" },
  "owner": { "firebaseUid": "stable UID", "sharegramUserId": null }
}
```

No name/email/DOB/address/file/document data, rejection free text or internal notes. Final decision fails closed with EXTERNAL_OWNER_IDENTITY_REQUIRED if its local owner cannot resolve to either Firebase UID or Sharegram ID. This means sample local-only accounts cannot produce externally routable final decisions until properly linked; do not fabricate external identities.

Worker uses the existing X-KYC signing headers with exact raw serialized bytes and a fresh UNIX timestamp per attempt. V2 names (`eventId`, `eventType`) are deliberately not silently sent to the old `id/event/data` receiver. Receiver must explicitly support v2, verify signature/freshness with constant-time comparison, and deduplicate eventId. Receiver support and its actual persistence remain unverified.

Delivery uses an atomic row-lock claim, 60-second expiring lease and a fencing token; attempt persisted before network I/O. Eight attempts with exponential backoff; transport/5xx/429 retry, other non-success 3xx/4xx fail. Lost acknowledgement/crash after remote acceptance can cause duplicate delivery: this is at-least-once. HTTP success marks sent, not proof of business persistence. Restart after a final-attempt crash marks exhausted work failed rather than retrying forever. There is currently no admin retry/requeue API; failed rows require operator triage, not silent recreation of an event with a new ID.

V2 sender enforces HTTPS in every environment, >=32-byte secret, exact hostname allowlist, no URL credentials/query/fragment, no redirects/proxy, 10-second timeout, and public-IPv4 DNS resolution pinned into the TLS connection. Private/reserved addresses are blocked; IPv6-only receivers intentionally unsupported. Add network egress policy as defense in depth. Exceptions/response bodies/URLs are not persisted as lastError.

### Admin invitation remains NOT implemented

User chose namespaced KYC Firebase claims. Existing mounted self-service `/api/auth/firebase-claims` replaces shared claims and accepts Sharegram identity/permission inputs. Adding invitation claim writes without first agreeing namespacing/merge/reconciliation and remediating that endpoint risks lost claims or unintended cross-app privileges. No invite/create/promote API was added; no invitation token/mail or Firebase mutation performed. The existing admin GET API remains unchanged, including its audit-access gap. This work is not permission to provision production admins through sample seeds.

Required next decisions/evidence: exact namespaced claim contract (for example `kyc: {role: "admin"}`, explicitly not global admin), whether any Sharegram consumer interprets it, authorized test project/runtime setup, invitation acceptance/verification and email-delivery configuration. Implement acceptance tokens hashed at rest, expiry/single-use/duplicate/race handling, DB audit, and a DB-backed claims reconciliation process preserving unrelated claims. Address or close the existing self-service claim setter before enabling invitations.

## Original-upload comparison

Original upload already had automatic activation and the approval prior-status bug. PR #5-era main added owner filtering/UID resolution, document aliases and metadata ordering, Sharegram sender and route hooks, guarded unavailable integrations, strict SSO tests, and migration/seed infrastructure. Backend diff original→baseline spans 112 files; it is not reproduced here. This patch preserves owner-scoping and fail-closed fixes; the automatic-approval regression assertion intentionally becomes a separation-of-review test. The legacy sync/ingress changes above are intentional compatibility breaks, not PR #5 regression claims.

## Migrations, seeds and deployment

- New migration: `20240101000015-create-review-decisions-outbox.js`. Creates only two new tables/index; no Performer/User enum change. Uses existing migrationGuard convention. Undo deliberately refuses destructive deletion of decision/event history; explicit export/authorization required.
- Existing seeders unchanged. No demo performers, real test accounts, database reset or seed run.
- Apply `cd server && npm run migrate` before deploying the new API. Do not deploy API without migration: decisions must fail rather than succeed without outbox/history.
- Base migration uses model.sync; development connectDB still uses sync({alter:true}). Fresh-DB and upgrade migrations need real MySQL testing before rollout; do not rely on automatic alteration. Worker never syncs schema.
- Run a separate managed process/container with `cd server && npm run worker:decisions`, same DB/runtime environment as API. SIGTERM stops after current work; leases recover after crashes. Monitor pending age/failed rows and worker liveness. A down/unconfigured worker does not stop decision commits; events remain pending.
- Explicit v2-only runtime variables: `KYC_DECISION_WEBHOOK_URL`, `KYC_DECISION_WEBHOOK_ALLOWED_HOSTS` (comma-separated exact hostnames), `KYC_DECISION_WEBHOOK_SECRET` (at least 32 bytes). Worker refuses startup when missing/unsafe. Do not configure until real receiver contract is confirmed. Old `KYC_WEBHOOK_EVENTS` does not control v2 decision delivery.
- No credentials in source/chat. This checkout has only example env files; checked Firebase service-account/project and DB host environment variables were unset. Provision authorized shared Firebase test runtime securely before integration tests. No Emulator.
- Ordinary upload replacement retains superseded files rather than deleting evidence inside a transaction. Retention policy/cleanup for superseded files and persistent upload failures requires a separate operational task.

## Validation and remaining acceptance gaps

Latest executed `cd server && npm run test:sso -- --runInBand`: **14 suites, 163 tests passed**. Includes PR #5 SSO/auth/ownership/seeding/migration/webhook tests, real-router decision/rejection/correction/document rejection tests, reason/transition validation, authorization including synthetic admins, missing owner failure, audit/outbox rollback, immutable final state, minimal v2 payload, worker retry/lease fencing/attempt exhaustion, sender exact-byte signature/config/destination guards, and new migration boundary test.

Models/auth/Firebase are mocked. Legacy webhook tests use a local HTTP fixture, not Sharegram; v2 sender's DNS/HTTP are mocked. Transaction tests assert transaction/lock propagation and use a rollback-capable double; worker tests are boundary tests, not proof of real MySQL isolation/concurrency/crash recovery. Repeated final decisions return conflict; receiver deduplication is only a required contract, not implemented receiver behavior.

`git diff --check` and Node syntax checks pass. Dependencies installed with lifecycle scripts disabled, no Cypress download; incidental yarn.lock modification restored from clean baseline. No dependency added.

NOT run: shared-project Firebase integration, real MySQL fresh/upgrade migrations and rollback/concurrency, real Sharegram v2 acceptance/deduplication, browser E2E, load/crash recovery. Runtime authorization/configuration unavailable. Admin invite/claims tests and ingress signature/replay tests remain blocked/unimplemented; ingress is closed rather than insecurely accepted. Admin list-read audit, production seed-default policy, global log sanitization, final-state re-review/expiry policy and operational failed-outbox retry API remain work. **Not production-ready until these compatibility gates and real integration validation are addressed.**
