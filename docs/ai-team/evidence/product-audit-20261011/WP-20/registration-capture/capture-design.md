# First-registration capture: verified source flow

Status: design only; implementation and all new tests NOT_RUN.

Confirmed against current sources:
- src/app/api/form-submissions/route.ts createPublicSubmission atomically writes only existing Funnel provenance. Duplicate and unique-conflict paths reuse the existing submission.
- src/lib/form-submission-verification-domain.ts verifyFormSubmission uses Serializable transaction and conditional verificationVersion/expiry update. First success writes legacy analyticsEvent; already_verified does not repeat it.
- src/lib/live-metric-session.ts creates LiveMetricRegistration only on viewing. Verified registrants who never watch are therefore missing from this metric cohort. Session visitor lookup alone cannot finish denominator R.
- FormSubmission.attribution is marketing hints, not trusted metric provenance. Funnel visitor IDs are not LiveMetricVisitor IDs.

Implementation contract:
1. Persist immutable scope/version/submission/nullable visitor/DB capturedAt in a dedicated capture record in the FIRST submission transaction. Never store credentials, name or email. Preserve unknown rather than backfill later-device identity. No trustworthy version means no invented historical capture.
2. Resolve visitor only through authenticated scope-bound proof plus matching persisted visitor. No body visitorId/IP/marketing identity substitution. Duplicate requests never rewrite capture.
3. First successful verification materializes LiveMetricRegistration from capture in the same transaction with exact verified epoch, even without playback. Unverified submissions do not enter R. Repeated verification must be idempotent.
4. Acquire locks in version-first order before submission mutation to avoid inversion with ingestion. Disabled/expired versions must respect existing guards; resulting evidence gaps are not full coverage.
5. Define capture retention/deletion with existing lifecycle; visitor erasure must not cascade away valid registration denominator. Session keeps reading immutable attribution; no current-cookie backfill.

Required tests: first submit, duplicate/concurrent submit, foreign tenant/version, different-device verification, verified without viewing, unverified exclusion, epoch changes, rollback atomicity, disabled/expired/version transitions, visitor deletion, RLS/FK/immutability, migration rollback. Then actual form route -> verification -> report reconciliation and independent Auth/Migration review/acceptance.

Ownership: root sole writer, independent worktree, depth0 dispatch0 automatic_spawn=false; requested/effective ai-team-pro; router recommendation in route-planned.json; observed implementation unknown. No product changes, migration execution, deployment or mail sent by this checkpoint.


## Implementation correction after inspecting database guards

The earlier same-verification-transaction proposal is superseded: verifyFormSubmission is Serializable while wp20_metric_registration_guard and evidence invalidation require ReadCommitted. Do not weaken either. Persist capture with first submission; after verification commits, materialize through a bounded ReadCommitted transaction. Capture plus current verified source is a durable replay input. Reconciliation scheduling and report coverage must account for pending projections before claiming completeness. A session racing projection must not install unknown attribution that conflicts with capture; application wiring must address that race before activation.

Services now implemented in src/lib/live-metric-registration-capture.ts. Capture accepts only a verified scoped persisted visitor or null; duplicate captures preserve the first value. Materialization verifies source scope/epoch/timing, never needs a browser, and detects conflicting existing cohort facts. DB137/lint/TypeScript PASS; actual form/verification wiring and scheduler are still absent.
