# First public form capture wiring

IN_PROGRESS; independent review NOT_RUN on this revision. Revision sha256:51e3d8246e72c7ffb5be9c53a26d6a8fe97b2c7bfac22f584c4189c8ae3ed5dd.

Public form route now captures metric provenance only on a NEW submission and only with configured dedicated metric keyring plus server-selected live/vendor. The scope-specific visit cookie is verified by the existing proof service; body visitor IDs/Funnel marketing hints are not metric identity. Existing duplicate/unique-conflict paths never backfill attribution. No new key is generated or environment setting enabled.

Submission and existing Funnel provenance remain atomic. Public metric context resolution and capture run inside the same bounded savepoint boundary; recoverable metric unavailability leaves business submission usable. Dead connections/expired outer transaction still fail honestly. CapturePublicMetricRegistration uses canonical current public live/version context, not client-provided version. No existing collection gate is bypassed.

Validation: DB140 (expanded existing complete-collection scenario), migrations100, form+visit route targeted tests, lint and TypeScript PASS; cleanup PASS. Route tests prove configured first submit calls capture in transaction, unavailable metrics still returns200, and duplicate skips capture. Actual DB path provisions visitor, resolves public context, captures new submission, executes real verification cryptography/domain, materializes same-visitor metric registration without playback. Actual HTTP form route remains mocked in unit tests; complete browser/form/verification/report E2E NOT_RUN. Verification endpoint auto-projection and reconciliation scheduler are not wired yet.

Remaining: verification/session race and background retries, visitor erasure lifecycle/lock-order findings, full coverage/report pipeline, final independent Auth review and acceptance. No inference that terminal/unavailable capture implies complete coverage.

Scope: src/lib/live-metric-registration-capture.ts; src/app/api/form-submissions/route.ts; src/app/api/form-submissions/route.test.ts; scripts/wp20-metric-persistence-disposable.mjs; evidence/handoff/checkpoint. Root sole writer independent worktree; depth0 no external dispatch; requested/effective ai-team-pro; route-form-wiring.json recommendation, implementation observed unknown. Rollback only new public-capture wiring and helper extraction/tests; preserve previous storage/projection/verification-clock changes. No push/deployment or production access.
