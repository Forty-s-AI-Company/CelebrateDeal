# Capture and verified registration services

IN_PROGRESS; NOT_READY. Implemented captureMetricRegistration and standalone ReadCommitted materializeMetricRegistration. Capture retains original authenticated persisted visitor or unknown; materialization requires a scoped verified source and detects immutable identity conflicts. Verification remains Serializable and is not edited. Neither service is wired to public form/verification endpoints yet; scheduler and session/projection race integration remain required.

Validation revision sha256:1ea8911962005af678bf9d667ff42c9edef56bb6797910c879bf3680da6a2935: disposable DB137, migrations100, lint and TypeScript PASS; cleanup PASS. Added actual DB cases: verified non-viewer enters metric registration without any viewing session; unverified and foreign scope excluded; concurrent materialization has one stable receipt; unknown attribution cannot be repaired; verification epoch changes reject rather than inherit history.

Independent review: Claude CLI SUCCESS, observed claude-opus-5-5, effort unknown, supplied-source-only, scope/revision in services-review-snapshot.json. This is provider success, NOT acceptance. Raw findings preserved in services-review.json: 7 MAJOR, 4 MINOR, 2 NIT, no BLOCKER. No findings edited or silently dismissed.

Triage / next fixes:
- MAJOR 1/2: add recoverable capture boundary so optional metric SQL failures or expiry races do not abort a valid submission; retain DB guard, do not introduce expiry grace or bypass.
- MAJOR 3/7: distinguish pending verification, terminal ineligibility and immutable identity conflict for eventual reconciliation; no infinite retry loops or false complete coverage.
- MAJOR 4: app verification clock versus DB capture clock must not silently exclude a valid registration; inspect actual timestamp/epoch semantics and test clock offsets.
- MAJOR 5: precision premise must be checked against actual FormSubmission DateTime column (Prisma defaults millisecond precision); nonetheless avoid unnecessary client timestamp round-trip and test nonUTC. Reviewer lacked complete schema context; not accepted as a proven precision bug yet.
- MAJOR 6: existing registration already uses visitor NO ACTION. Do not silently invent erasure/retention policy or cascade away valid denominator; validate and document permitted lifecycle or implement coordinated anonymization with evidence-loss semantics.
- MINOR: lock order/timeouts, typed failures, post-verification retry boundary; NIT: overlapping indexes and schema drift verification. Existing migration100 proves referenced constraints exist; it is not a schema-diff check.

Scope files: src/lib/live-metric-registration-capture.ts; scripts/wp20-metric-persistence-disposable.mjs; registration-capture evidence/design correction; handoff/goal checkpoint. Root sole writer independent worktree; depth0, external review dispatch1, automatic_spawn=false; requested/effective ai-team-pro; router recommendation route-services.json, observed implementation unknown. Rollback only this new service and runner cases; preserve prior storage/evidence. No deployment, push, production or external data actions.
