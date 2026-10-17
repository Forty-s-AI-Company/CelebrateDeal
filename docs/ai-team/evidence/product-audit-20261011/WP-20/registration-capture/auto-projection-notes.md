# Verification post-commit automatic projection

IN_PROGRESS; new-scope independent review NOT_RUN. Revision sha256:2d6e7e461b6c5bf1ae8910e52379be0426ea57890e885523fc3ae115108d9ed4.

verifyFormSubmission now attempts materializeMetricRegistration only after its Serializable verification transaction commits successfully. Scope comes from validated persisted form/live/vendor, never request attribution. Both first verification and authenticated already_verified replay trigger the bounded ReadCommitted projection. Invalid tokens do not. Projection failure cannot reverse committed verification; durable capture remains for reconciliation. No new browser credentials are passed or logs emitted. Existing verification result shape and email behavior are unchanged.

DB141 / migrations100 / token+form+verify targeted / lint / TypeScript / cleanup PASS. Actual DB public-capture integration now asserts the metric registration already exists immediately on return from real verification, BEFORE explicit projection replay. Injected optional projection transaction failure still commits verification; subsequent authenticated replay repairs the missing cohort row exactly once and preserves original verifiedAt. App-clock-skew/AsiaTaipei cases still pass with both required isolation levels.

Incomplete: background reconciliation for users who never replay after failure, explicit pending/terminal evidence coverage, race with playback session issuance, lifecycle/deletion and lock-order review, full metric/report pipeline and independent final acceptance. This is not a claim that all verified users are already covered. Current revision has no independent review receipt.

Scope: src/lib/form-submission-verification-domain.ts; scripts/wp20-metric-persistence-disposable.mjs; evidence/handoff/goal checkpoint. Root sole writer independent worktree; ai-team-pro requested/effective, route-auto-projection.json recommendation, implementation observed unknown; depth0 no new external dispatch automatic_spawn=false. Rollback only post-commit projection/identity handoff and runner cases. No push/deployment/production operations.
