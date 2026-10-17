# Session / verified projection race

IN_PROGRESS; independent follow-up NOT_RUN. Revision sha256:e25ee9390304114b987bd04f381afc037026723a4163bce99d3d518daccccdb4.

resolveMetricRegistrationVisitor now reads immutable first-submission capture only when no metric registration exists for that exact vendor/live/version/submission. It validates current verified status/time, form/live/vendor, visitor/version scope, capture ordering and retention. Existing registration always wins, including NULL attribution or stale verified epoch, so fallback cannot repair/rewrite history. Current cookies, IP or caller visitor IDs are not involved. Canonical runtime/version resolver continues to supply the current version.

DB142 / migrations100 / targeted version+session tests / lint / TypeScript / cleanup PASS. Real DB cases exercise session-first, projection-first and concurrent execution: one registration, same captured visitor, issued session references that same registration. Unverified and foreign vendor/version return no attribution. Existing unknown registration remains unknown despite a known capture; projection returns explicit terminal identity_conflict. Existing guards and assertions remain intact.

Limits: actual DB session cases inject synthetic authorizer and context callback while executing real issueMetricSession, attribution query and materializer; full public admission/HTTP/browser race NOT_RUN. Background reconciliation, durable coverage, erasure lifecycle/global lock order and complete statistics/report pipeline still pending. This snapshot has not passed independent Auth review.

Scope: src/lib/live-metric-version.ts; src/lib/live-metric-version.test.ts; scripts/wp20-metric-persistence-disposable.mjs; evidence/handoff/checkpoint. Root sole writer independent worktree; requested/effective ai-team-pro; route-session-race.json recommendation, implementation observed unknown; depth0 no new external dispatch automatic_spawn=false. Rollback only capture fallback query and corresponding tests. No push/deploy/production access.
