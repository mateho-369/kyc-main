# Backend delta inventory against original upload

Original: `9e5e7aff1c0e9c5cfdb4f73d940c0d27861bd641`. Comparison: staged security follow-up on `arena/01a0e712-kyc-main`.

This inventory enumerates changed paths; it is not a claim that every dormant module has been penetration-tested. See the companion security report for runtime reachability, findings, evidence and limits.

| Status | Path | Review group |
|---|---|---|
| M | `server/.env.auth.example` | Runtime / configuration |
| A | `server/.env.example` | Runtime / configuration |
| A | `server/config/config.js` | Runtime / configuration |
| D | `server/config/database.js` | Runtime / configuration |
| D | `server/config/db-secure.js` | Runtime / configuration |
| M | `server/config/firebase-admin.js` | Runtime / configuration |
| M | `server/config/sso.js` | Runtime / configuration |
| D | `server/controllers/documentController.js` | Runtime / configuration |
| D | `server/debug-audit-route.js` | Runtime / configuration |
| D | `server/firebase-session-api.js` | Runtime / configuration |
| D | `server/middleware/api-protection.js` | Authentication / authorization / request protections |
| D | `server/middleware/auditLogger.js` | Authentication / authorization / request protections |
| M | `server/middleware/auth-enhanced.js` | Authentication / authorization / request protections |
| D | `server/middleware/auth-unified.js` | Authentication / authorization / request protections |
| M | `server/middleware/auth.js` | Authentication / authorization / request protections |
| D | `server/middleware/cache.js` | Authentication / authorization / request protections |
| M | `server/middleware/checkRole.js` | Authentication / authorization / request protections |
| D | `server/middleware/csrf-interceptor.js.backup.20250806_120935` | Authentication / authorization / request protections |
| D | `server/middleware/errorHandler.js` | Authentication / authorization / request protections |
| D | `server/middleware/firebase-security.js` | Authentication / authorization / request protections |
| M | `server/middleware/firebaseAuth.js` | Authentication / authorization / request protections |
| M | `server/middleware/hybrid-auth.js` | Authentication / authorization / request protections |
| D | `server/middleware/permission-manager.js` | Authentication / authorization / request protections |
| A | `server/middleware/requireReviewer.js` | Authentication / authorization / request protections |
| D | `server/middleware/security-enhanced.js` | Authentication / authorization / request protections |
| M | `server/middleware/security.js` | Authentication / authorization / request protections |
| D | `server/middleware/security.js.backup.20250806_120932` | Authentication / authorization / request protections |
| D | `server/middleware/security/rateLimit.js` | Authentication / authorization / request protections |
| D | `server/middleware/security/sqlInjection.js` | Authentication / authorization / request protections |
| D | `server/middleware/security/xss.js` | Authentication / authorization / request protections |
| M | `server/middleware/sharegram-auth.js` | Authentication / authorization / request protections |
| A | `server/migrations/20240101000000-create-base-tables.js` | Schema / preservation |
| M | `server/migrations/20240101000001-add-firebase-integration-columns.js` | Schema / preservation |
| M | `server/migrations/20240101000002-create-sharegram-integrations.js` | Schema / preservation |
| M | `server/migrations/20240101000003-create-firebase-users.js` | Schema / preservation |
| M | `server/migrations/20240101000004-create-api-logs.js` | Schema / preservation |
| M | `server/migrations/20240101000005-create-webhooks.js` | Schema / preservation |
| M | `server/migrations/20240101000006-create-batch-jobs.js` | Schema / preservation |
| M | `server/migrations/20240101000007-create-kyc-requests.js` | Schema / preservation |
| M | `server/migrations/20240101000008-create-kyc-documents.js` | Schema / preservation |
| M | `server/migrations/20240101000009-create-kyc-verification-steps.js` | Schema / preservation |
| M | `server/migrations/20240101000010-extend-performer-kyc-fields.js` | Schema / preservation |
| M | `server/migrations/20240101000011-add-performer-external-id.js` | Schema / preservation |
| M | `server/migrations/20240101000012-extend-sharegram-integration-fields.js` | Schema / preservation |
| M | `server/migrations/20240101000013-add-performance-indexes.js` | Schema / preservation |
| A | `server/migrations/20240101000014-add-user-profile-picture.js` | Schema / preservation |
| A | `server/migrations/20240101000015-create-review-decisions-outbox.js` | Schema / preservation |
| A | `server/migrations/20240101000016-unique-sharegram-owner.js` | Schema / preservation |
| A | `server/models/DecisionOutbox.js` | Identity / state / persistence |
| A | `server/models/PerformerDecision.js` | Identity / state / persistence |
| M | `server/models/User.js` | Identity / state / persistence |
| D | `server/models/UserMapping.js` | Identity / state / persistence |
| M | `server/models/index.js` | Identity / state / persistence |
| D | `server/monitoring/prometheus-metrics.js` | Runtime / configuration |
| M | `server/package-lock.json` | Runtime / configuration |
| M | `server/package.json` | Runtime / configuration |
| D | `server/route-order-test.js` | Runtime / configuration |
| M | `server/routes/admin-users.js` | Route exposure / ownership / compatibility |
| M | `server/routes/api/documents.js` | Route exposure / ownership / compatibility |
| D | `server/routes/api/performers.js` | Route exposure / ownership / compatibility |
| M | `server/routes/auth-custom-token-simple.js` | Route exposure / ownership / compatibility |
| D | `server/routes/auth-custom-token.js` | Route exposure / ownership / compatibility |
| M | `server/routes/auth-firebase-sso.js` | Route exposure / ownership / compatibility |
| D | `server/routes/auth-firebase-standard-fixed.js` | Route exposure / ownership / compatibility |
| D | `server/routes/auth-firebase-standard-server-fix.js` | Route exposure / ownership / compatibility |
| D | `server/routes/auth-firebase-standard-simple.js` | Route exposure / ownership / compatibility |
| M | `server/routes/auth-firebase-standard.js` | Route exposure / ownership / compatibility |
| M | `server/routes/auth-firebase.js` | Route exposure / ownership / compatibility |
| D | `server/routes/auth-sharegram-sso-minimal.js` | Route exposure / ownership / compatibility |
| M | `server/routes/auth-sharegram-sso.js` | Route exposure / ownership / compatibility |
| D | `server/routes/auth-sharegram-sso.js.backup-20251016-201714` | Route exposure / ownership / compatibility |
| M | `server/routes/auth-sso.js` | Route exposure / ownership / compatibility |
| M | `server/routes/auth.js` | Route exposure / ownership / compatibility |
| D | `server/routes/documents.js` | Route exposure / ownership / compatibility |
| D | `server/routes/monitoring.js` | Route exposure / ownership / compatibility |
| M | `server/routes/performers.js` | Route exposure / ownership / compatibility |
| M | `server/routes/sharegram-performers.js` | Route exposure / ownership / compatibility |
| M | `server/routes/sharegram.js` | Route exposure / ownership / compatibility |
| D | `server/routes/test-mode.js` | Route exposure / ownership / compatibility |
| D | `server/routes/videos.js` | Route exposure / ownership / compatibility |
| A | `server/scripts/backfill-performer-sharegram-owner.js` | Operator-only tooling |
| A | `server/scripts/check-user-schema.js` | Operator-only tooling |
| A | `server/scripts/decision-outbox-worker.js` | Operator-only tooling |
| A | `server/scripts/diagnose-sso-token.js` | Operator-only tooling |
| A | `server/seeders/20240101000001-seed-accounts.js` | Provisioning / seed safety |
| A | `server/seeders/20240101000002-promote-sso-admin.js` | Provisioning / seed safety |
| M | `server/server.js` | Runtime / configuration |
| D | `server/server.js.backup-20250923-141054` | Runtime / configuration |
| D | `server/server.js.backup-before-firebase-deploy` | Runtime / configuration |
| D | `server/server.js.backup.20250812_141442` | Runtime / configuration |
| D | `server/server.js.backup.20250904_153137` | Runtime / configuration |
| D | `server/services/cache/cacheService.js` | Decision / delivery / session logic |
| D | `server/services/cacheStrategy.js` | Decision / delivery / session logic |
| A | `server/services/documentSecurity.js` | Decision / delivery / session logic |
| D | `server/services/errorLogging.example.js` | Decision / delivery / session logic |
| D | `server/services/errorLogging.js` | Decision / delivery / session logic |
| A | `server/services/externalOwnerScope.js` | Decision / delivery / session logic |
| A | `server/services/firebaseSessionPolicy.js` | Decision / delivery / session logic |
| A | `server/services/performerReview.js` | Decision / delivery / session logic |
| D | `server/services/queryOptimizer.js` | Decision / delivery / session logic |
| D | `server/services/recoveryService.js` | Decision / delivery / session logic |
| A | `server/services/sharegram/decisionDelivery.js` | Decision / delivery / session logic |
| A | `server/services/sharegram/decisionOutbox.js` | Decision / delivery / session logic |
| A | `server/services/sharegram/sharegramAccountService.js` | Decision / delivery / session logic |
| A | `server/services/sharegram/sharegramWebhook.js` | Decision / delivery / session logic |
| D | `server/services/sharegramBatchService.js` | Decision / delivery / session logic |
| M | `server/services/tokenService.js` | Decision / delivery / session logic |
| M | `server/services/webhookService.js` | Decision / delivery / session logic |
| D | `server/session-endpoints-patch.js` | Runtime / configuration |
| D | `server/simple-test.js` | Runtime / configuration |
| D | `server/test-api-security.js` | Runtime / configuration |
| D | `server/test-auth.js` | Runtime / configuration |
| D | `server/test-env-firebase.js` | Runtime / configuration |
| D | `server/test-firebase-init.js` | Runtime / configuration |
| D | `server/test-security-fix-isolated.js` | Runtime / configuration |
| D | `server/test-security-fix.js` | Runtime / configuration |
| D | `server/test-server.js` | Runtime / configuration |
| D | `server/test.js` | Runtime / configuration |
| A | `server/tests/sso/admin-seeder.test.js` | Automated regression evidence |
| A | `server/tests/sso/base-tables-migration.test.js` | Automated regression evidence |
| A | `server/tests/sso/custom-token-security.test.js` | Automated regression evidence |
| A | `server/tests/sso/decision-outbox.test.js` | Automated regression evidence |
| A | `server/tests/sso/external-access-security.test.js` | Automated regression evidence |
| A | `server/tests/sso/firebase-not-configured.test.js` | Automated regression evidence |
| A | `server/tests/sso/firebase-session-policy.test.js` | Automated regression evidence |
| A | `server/tests/sso/helpers/sharegramReceiver.js` | Automated regression evidence |
| A | `server/tests/sso/jest.config.js` | Automated regression evidence |
| A | `server/tests/sso/log-redaction.test.js` | Automated regression evidence |
| A | `server/tests/sso/migration-column-references.test.js` | Automated regression evidence |
| A | `server/tests/sso/migration-coverage.test.js` | Automated regression evidence |
| A | `server/tests/sso/migration-idempotency.test.js` | Automated regression evidence |
| A | `server/tests/sso/no-fake-identity.test.js` | Automated regression evidence |
| A | `server/tests/sso/owner-identity-migration.test.js` | Automated regression evidence |
| A | `server/tests/sso/performer-document-routes.test.js` | Automated regression evidence |
| A | `server/tests/sso/performer-ownership.test.js` | Automated regression evidence |
| A | `server/tests/sso/platform-security.test.js` | Automated regression evidence |
| A | `server/tests/sso/protected-api-auth.test.js` | Automated regression evidence |
| A | `server/tests/sso/seed-accounts.test.js` | Automated regression evidence |
| A | `server/tests/sso/sharegram-auth-security.test.js` | Automated regression evidence |
| A | `server/tests/sso/sharegram-sso-flow.test.js` | Automated regression evidence |
| A | `server/tests/sso/sharegram-webhook.test.js` | Automated regression evidence |
| M | `server/utils/logger/logger.js` | Runtime / configuration |
| A | `server/utils/migrationGuard.js` | Runtime / configuration |
| A | `server/utils/requestToken.js` | Runtime / configuration |
| A | `server/utils/seedGuard.js` | Provisioning / seed safety |
