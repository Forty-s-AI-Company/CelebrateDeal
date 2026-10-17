# Bounded registration reconciliation

IN_PROGRESS; scheduling/HTTP wiring and independent review NOT_RUN. Revision sha256:79a2768b01c0195e793e17c726db936933ffc368a53b82d280dce8358d87db0b.

New internal reconcileMetricRegistrations batches one validated tenant/live/version with strict keyset cursor, take1..20, bounded select transaction and monotonic 20s start-new-work budget. Each materializer also retains its own bounded transaction and rechecks expected version. Results expose processed/retryable/terminal counts, outcomes, next cursor and hasMore; coverage is explicitly unknown. Failures advance within a pass to avoid starvation; a new pass starts from null and revisits pending/failed records. Scheduler must preserve this contract; a completed pass is not a completeness watermark. Already-started projection may finish after the 20s start budget within its own timeout/acquisition bounds.

Updated the undeployed capture migration/schema seek index to vendor/live/version/submissionId instead of redundant three-column prefix. Visitor FK lookup index retained. No new migration applied to persistent/shared DB.

DB143 / migrations100 / lint / TypeScript / cleanup PASS. Five-row actual DB scenario: pending verification, injected transient failure, permanent retention gap and valid rows; paginated continuation proceeds past failures, next pass repairs failed projection, later verification is picked up on fresh pass, terminal gap remains explicit and coverage unknown. Foreign tenant sees no candidates; expected-version mismatch cannot write another version; excessive batch size rejected. These are real DB cases, not a running deployed scheduler. Time-budget exhaustion-specific test and large index-plan test NOT_RUN.

Scope: src/lib/live-metric-registration-reconcile.ts; src/lib/live-metric-registration-capture.ts; prisma/schema.prisma; prisma/migrations/20261015100000_live_metric_registration_capture/migration.sql; scripts/wp20-metric-persistence-disposable.mjs; evidence/handoff/checkpoint. Root sole writer independent worktree; ai-team-pro requested/effective; route-reconcile.json recommendation, implementation observed unknown; depth0 no new external dispatch automatic_spawn=false. Rollback exact new service/expected-version boundary/index delta/tests only. No push/deployment/production access.

Remaining: authenticated job/scheduling adapter, persistent coverage/gaps and worker/report pipeline; visitor lifecycle/global lock-order findings; full reconciliation/UI and final independent review/acceptance.
