# Registration attribution read verification

Status: IN_PROGRESS; WP-20 not accepted.

- Session context reuses only stored registration attribution matching vendor/live/version/submission and exact verified epoch. Missing attribution stays unknown; no current-cookie historical backfill.
- Targeted tests, scoped lint and TypeScript: PASS, revision 3e5c49187b9e7d4509908254a2105cc752d4967d3aa40ce7e9a7e4a8212a19f2.
- Disposable DB: 135 checks PASS; 99 migrations PASS; container/temp cleanup PASS. Runner lint PASS. Revision deb4d85794cd25e8a3301d093c40ebce92aca57d74df5b0c771bb7a198f031d0 includes added sanitized browser diagnostics; product TypeScript unchanged between these runs.
- Actual handler/browser/DB integration PASS: two tabs, one visitor, two visits, cached retries unchanged, HttpOnly hidden, cross-origin denied.
- Earlier DB run FAILED in complete visit collection/integrated browser case; differing field versionId. Original receipts retained as initial-db-failure.json and initial-browser-failure.json. Root cause UNCONFIRMED; successful rerun does not establish repair.
- Remote TLS, Next server routing and deployment rate limiter NOT_RUN by this harness. Independent review NOT_RUN. Global lint is not asserted PASS.
- Remaining: first-submission attribution capture, durable coverage/gaps, complete metric pipeline/report UI/reconciliation and independent review/acceptance.
- Scope files: src/lib/live-metric-version.ts; src/lib/live-metric-version.test.ts; scripts/wp20-metric-persistence-disposable.mjs; scripts/wp20-visit-integrated-browser.mjs; this evidence directory; handoff and goal checkpoint.
- Root sole writer, independent worktree, depth 0, dispatch 0, automatic_spawn=false; requested/effective ai-team-pro; router selected sol, observed implementation unknown. No push/deployment or original worktree changes.
- Rollback: reverse only the attribution resolver/call/tests and diagnostic additions from this checkpoint. Preserve other worktree changes; no production or deployed state to roll back.
