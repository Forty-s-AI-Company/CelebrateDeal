# Projection classification and timestamp integrity

IN_PROGRESS; not final acceptance. Revision sha256:b6eb851170e16fa18b7926aa00be262774fc10e15680ba33cfe28e09f26ab472. DB139 (expanded existing service case), migrations100, lint, TypeScript and container/temp cleanup PASS.

Projection now returns explicit pending_verification/pending_clock with retryable=true; missing_capture/scope_changed/missing_verified_time/clock_order_conflict/outside_retention/identity_conflict with retryable=false. Recorded has retryable=false. Terminal does NOT mean evidence complete: consumers must retain/report the gap, not silently drain it into complete coverage. DB runtime failures still throw typed errors. Scheduler is not implemented.

Verification time now goes directly from FormSubmission through SQL AT TIME ZONE UTC into metric registration and is compared in SQL. It no longer round-trips through a JavaScript Date. Actual DB test materializes concurrently under default UTC and Asia/Taipei and receives the same single registration. Tests also verify unverified/future-clock are pending, retention/clock-order/identity conflicts are nonretryable, and ineligible states create zero metric registration rows.

Review responses: MAJOR3 and MAJOR7 classification implemented; MAJOR5 timestamp transport eliminated with nonUTC regression. These changes await independent follow-up. MAJOR4 app/DB clock ordering is only exposed explicitly, not resolved; a valid verification could still be excluded if its clock precedes capture. MAJOR6 deletion lifecycle and other lock-order/schema/index findings remain open. Do not claim all seven issues fixed. Source review services-review.json predates current revision.

Changed files: src/lib/live-metric-registration-capture.ts; scripts/wp20-metric-persistence-disposable.mjs; evidence/handoff/goal checkpoint. Next: establish coherent verification timestamp source and lifecycle, reconcile session/projection race, then form/verification/scheduler integration and full reporting reconciliation. Public wiring remains absent.

Root sole writer in independent worktree; depth0, no new external dispatch, automatic_spawn=false; requested/effective ai-team-pro, route-projection-status.json recommendation, observed implementation unknown. No push/deployment. Rollback only projection classification/SQL timestamp changes and corresponding runner assertions, retaining previous savepoint/storage work.
