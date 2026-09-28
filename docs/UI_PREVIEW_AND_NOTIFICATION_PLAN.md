# Actual application preview — temporary sample data

## Current delivery (2026-09-28)

The user explicitly authorized temporary mock records after finding the empty design workspace insufficient. **This section supersedes the earlier design-only preview description below.** Keep the fixtures until the user accepts the UI; remove them after acceptance, not before.

`npm run preview:build` and `npm run preview:serve` now serve the actual Dashboard, Performers, Performer Detail, create/edit form, admin users/detail and audit components, with the actual Header and Navigation. The Arena live preview listens on 0.0.0.0:3000. A prominent mock banner and persistent watermark identify all records and actions as synthetic.

- Six sample applications cover ready for approval, documents awaiting verification, approved, correction requested, final rejection and missing required documents.
- Full-admin, simulated review-only and owner perspectives are selectable. The owner sees only their own three applications. Reviewer user-management/audit/create/edit/delete restrictions are enforced inside the mock adapter as well as the preview navigation, **not offered as production backend role support**.
- Documents are generated, watermarked artwork. Selected upload file bytes are discarded and replaced with synthetic documents. Do not use real identity documents in the preview.
- Document verification, final decisions, history, search/status filters and notification read state operate in this tab's memory. The correction/resubmission helper is explicitly a proposed user workflow. Notifications simulate an inbox; no Sharegram or email delivery happens.
- Reset samples or refresh restores initial records. Nothing is written to local storage, Firebase or a database. Existing production services do not fall back to fixtures.
- The special build script replaces auth/API/analytics/return-URL/inbox modules only for the fixture bundle. Normal application builds retain their actual services. The static preview server blocks API/auth/upload routes with 503 and sets CSP `connect-src 'none'`. Fonts are bundled locally, not fetched from Google.
- Real invitations, reviewer provisioning, email, persistent inbox and namespaced claim integration remain unimplemented. Admin export is explicitly unavailable in this preview.

## Current verification

- Frontend: **8 files / 59 tests passed**, including six new temporary-fixture tests covering owner scope, reviewer restrictions, required document verification, correction versus final rejection, history, reset and fail-closed endpoints.
- `npm run preview:check`: actual dashboard/list/detail/admin-users/user-detail/audit/inbox at **320, 390, 768, 1024, 1440 and 1920px**, with no horizontal overflow; reviewer/owner navigation and sample scope checked.
- Browser interactions passed: search/status filtering, acknowledgment-gated approval, correction request, owner simulated resubmission and notification mark-read. No browser runtime errors or real API/Firebase/Sharegram requests. Direct API write returned 503.
- Latest desktop/mobile screenshots inspected after local Japanese fonts loaded. Preview and normal builds compile with nonfatal existing warnings.
- Normal build generated separately under ignored `.cache/app-build` with both preview flags false. Three fixture-only strings, including `KYC_TEMPORARY_FIXTURES_20260928`, are present in the preview JS and absent from normal-build JS.
- These are isolated UI/unit checks, not a live integration test. Earlier accessibility checks below describe the former design workspace, not a new full accessibility certification of these populated application pages. Backend unchanged in this fixture tranche.

## Removal after user acceptance

1. Remove `src/preview/RealPagesPreview.jsx`, `src/preview/fixtures/` (including its tests) and `scripts/build-fixture-bundle.cjs`.
2. Remove the fixture branch from `src/index.js`; restore the ordinary app entry or retain the separate non-data design preview as desired. Remove fixture flags/substitution logic from the preview builder and update/remove its fixture-specific browser checker.
3. Remove the two preview-only `@fontsource-variable` development dependencies and corresponding lock entries if no longer used. Rebuild/replace the static preview output so a stale mock bundle cannot remain served.
4. Retain the real responsive fixes, search/filter and audit filtering fixes, image-preview selection fix and truthful service-status labels. Optional simulation-only presentation props can be removed; do not remove real review UI/backend work.
5. Run frontend tests and a normal build; verify no fixture marker or synthetic records are in shipped bundles. No database cleanup is needed: fixtures were never seeded.

---

# Historical report: earlier empty design preview (superseded)

# Responsive UI, role perspectives and notification plan

## Scope (2026-09-28)

This UI phase was explicitly authorized after the backend-only phase. Existing navy/gold colors, Outfit/Noto Sans typography and Feather icons are retained. No Sharegram code, database records, Firebase claims or backend roles were changed in this UI phase.

## Live preview

```sh
npm run preview:build
npm run preview:serve
```

Port 3000, bound to 0.0.0.0; accepts the Arena preview host and iframe embedding. Static build uses relative `/api`, not localhost in the browser and not the existing staging proxy. Build marker prevents accidentally serving the regular app as a preview. All `/api`, `/auth`, `/uploads` requests return 503; there are no fake success responses. Ordinary POSTs have no application handler. This preview has no AuthProvider, session, API client, account/performer fixtures, persistent role changes or authentication bypass. No database or Firebase Emulator is used.

The UI preview is an **isolated design workspace**, not the authenticated app running with demo credentials. Role buttons change presentation only. Real data operations are unavailable. Notification content is labeled as message templates, never a delivered notification or unread count.

Explore:
- Full admin: review controls, people/access, audit placeholder and notification-channel plan.
- Review-only: proposed focused review experience, no people/access or global audit navigation. A visible warning states the role is not enforced by the current backend.
- User: owner-only application perspective and status-message templates. No review controls.
- Access guide: capability matrix with available/proposed/planned distinctions.
- Decision controls: choose approve/correction/final rejection and enter a reason; submission stays disabled.
- Notification templates: approval, correction and final rejection; distinguish them from delivery channels.

## Fixes in the existing authenticated application

- Removed mobile CSS that translated the navigation off-screen even when JSX opened it.
- Drawer now scrolls within the viewport; desktop sidebar no longer shrinks or overlaps its footer.
- Added focus containment, Escape close, focus restoration, scroll-lock restoration and close-on-desktop-resize for navigation. Shared dialog focus behavior used by the document preview and notification information dialog.
- Header menu exposes expanded state; icon-only logout and close controls have accessible labels; long names truncate safely.
- Main layout has min-width:0, controlled padding/max width and a keyboard skip link. Performer rows stack on phones instead of squeezing thumbnails, names and actions into one row.
- Full-admin-only routes now have frontend role guards as well as existing backend authorization. This is UX protection, not a replacement for backend checks.
- Performer list no longer labels every record verified. Status distinguishes pending, correction, rejection and active+verified. Active by itself is not treated as verified KYC.
- Added record-status notices and final decision controls to the real performer detail page. The normal app calls existing admin approve/reject/request-correction APIs. Approval requires the three mandatory verified documents plus explicit confirmation; rejection/correction require a reason. Real API response must confirm a decision ID before showing a saved notice. API remains authoritative for roles/transitions and errors are surfaced.
- The real notification bell opens honest information and a link to record status, not a fabricated unread feed.
- Detail-page required document indicators now match backend agreementFile/idFront/selfie; idBack/selfieWithId are optional. Verification refresh now refreshes performer and metadata, not just stale document flags.
- Fixed the document service's nested `data.documents` parsing. Previously successful document refresh returned an empty list. Network/malformed responses now throw rather than pretend no documents exist. Camel/snake document aliases are normalized for metadata/status rendering. Metadata uses fileSize, not nonexistent size; absent dates/size do not display NaN.
- Document rows/actions wrap on phones. Final-state edit/delete/verification buttons are disabled where applicable. The server remains the final guard.
- User/detail error actions wrap, long emails/names/filenames no longer force wide layouts, and admin badges use gold rather than unrelated purple.
- Document preview has focus handling, label/close semantics, viewport-width containment, larger controls, valid Tailwind size utilities and navy/gold accents.

The normal authenticated application keeps its existing page structure. The preview's overview composition and proposed reviewer perspective are not falsely installed as a real role or populated production dashboard.

## Roles: what exists versus what needs backend work

| Capability | Existing full admin (`admin`) | Proposed reviewer | Existing user |
| --- | --- | --- | --- |
| Own records | Yes | To be specified | Yes |
| Document review / final decisions | Yes | Intended | No |
| List all users / global audit | Yes | No | No |
| Admin invitation / role assignment | Not implemented | No | No |
| Owner resubmission after correction | API exists | No role-based grant intended | API exists |
| Notification inbox / email | Not implemented | Not implemented | Not implemented |

Backend schema currently has admin/user only. Before assigning a reviewer, add and test a capability model (e.g. review:read, review:decide, users:read, admins:invite, audit:read, notifications:own:read). Use server-side enforcement on each endpoint, fail closed for unknown capabilities, and migrate existing admins explicitly. Hiding a link or passing role in a browser query must never grant access. Align the selected namespaced KYC Firebase claim contract and preserve unrelated shared-project claims. Invitation and claim-sync implementation remains pending.

## Notification roadmap

A decision and each channel's delivery are separate records. A successful decision response cannot promise that Sharegram, email or an inbox is already updated.

| Event | Sharegram | In-app notification | Email |
| --- | --- | --- | --- |
| Approval | Existing v2 decision outbox; receiver support unverified | Planned owner-scoped approval + secure record link | Planned minimal approval message + secure link |
| Final rejection | Existing v2 decision outbox; receiver support unverified | Planned final-decision message, distinguish from corrections | Planned generic result; no internal rejection text |
| Correction requested | No outgoing event contract yet | Planned actionable request + upload/resubmit link | Planned action-required email |
| Resubmitted | No outgoing event contract yet | Planned confirmation / authorized reviewer queue update | Optional; avoid duplicate/noisy messages |
| Delivery failure | Internal outbox state | Admin operational alert, not a user's KYC rejection | Escalation policy to be agreed |

Recommended implementation:
1. Version a minimal domain event: stable event ID, owner UID, record ID, review version, action and time. Keep document binaries/paths, addresses, DOB and internal notes out of external events.
2. Separate an owner-safe correction message from internal reviewer notes. Current decision reasons are internal history; do not expose the whole admin history endpoint just to display a user message. An owner-scoped, authorized read API and real user resubmit controls still need implementation.
3. For each destination, persist a durable delivery record atomically with the decision or derive it from the committed outbox using idempotency. Unique `(eventId, channel, recipient)` key, bounded retries/backoff, error redaction and audited retry. Send email after commit; outages must not roll back a saved review.
4. In-app inbox: owner-scoped GET, mark-read with ownership checks, pagination, unread count from actual persisted data, deep link re-checking authorization. Never use global notification fallback.
5. Email: verified recipient, configured provider, SPF/DKIM/DMARC, templates/localization, safe links without credentials, bounce handling and channel delivery telemetry. Don't promise delivery from provider acceptance alone. Transactional notification and marketing preferences are separate policies.
6. Sharegram: negotiate v2 payload/ACK/freshness/deduplication first. Existing worker provides at-least-once, not exactly-once. Enabling the UI does not verify receiver persistence.
7. Expose pending/sent/failed per channel to authorized admins. Do not use notification status as performer/KYC status.

No email, notification inbox, admin invitation or new reviewer privilege was sent/created by this work.

## Validation

- Regular app build succeeds with existing lint warnings (auth hooks, unused values and default exports); preview build succeeds. No build outputs or browser binaries committed.
- Frontend Vitest: **7 files / 53 tests pass**. New coverage includes status truth, JSON metadata, preview submission blocking, real decision input/response handling, pending-not-delivered wording, proposed role navigation, header/drawer behavior and document response parsing. Added explicit per-test DOM cleanup to prevent cross-file pollution in a reused Vitest fork.
- Real Chromium preview checks: **320, 390, 768, 1024, 1440, 1920px**; all three perspectives, access dialog, mobile menu/Escape/focus restoration, decision form and notification view. No horizontal page overflow, no runtime exceptions, no account/record API calls; explicit API POST returns 503.
- Axe WCAG 2 A/AA and 2.1 AA automated scans: no violations in three overview perspectives at 390/1440px and the final-rejection control view. Initial contrast findings were fixed using darker existing navy shades. This is not a claim of full manual accessibility certification or all authenticated-page coverage.
- Unit tests use fixtures/mocked callbacks only; preview itself has no accounts or performer fixtures. Full authenticated browser tests remain blocked by real Firebase/MySQL setup. Firefox/WebKit and real-device testing not performed.

Re-run browser checks: `npm run preview:check` with a running preview and an installed Playwright Chromium. Optional `CHROMIUM_EXECUTABLE_PATH` / `PREVIEW_URL` support local browser installation. In this sandbox the default browser download was unavailable; an isolated Chromium package and its libraries were used outside the repo. No production auth was bypassed to run checks.
