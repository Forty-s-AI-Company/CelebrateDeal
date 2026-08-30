# WP-171 Corrected Preview Broker External Re-verification

## Verdict boundary

- Terminal receipt: `WP171_CLEANUP_EXACT_NO_GO`.
- External broker attempts: `1`; retries: `0`.
- Corrected absolute TSX CLI plus absolute project tsconfig startup was externally verified.
- Current staging freshness passed for the accepted WP-167 Ready Preview deployment; `/api/health` HEAD returned 200 without redirect.
- The broker child returned one valid sanitized result but stopped before database access.
- Staging DB connection／read-only transaction／application SELECT: `0/0/0`.
- PayUni official Sandbox lookup: `0`.
- DB／provider writes, payment, refund, callback, deployment, DNS／environment mutation and Production operations: all `0`.

The immutable receipt does not retain the broker child's earlier normalized
environment-identity failure because Windows temp cleanup subsequently became
the terminal failure. No raw broker output was persisted or re-read. The exact
pre-DB reason is therefore `UNCLASSIFIED_FAIL_CLOSED`; it must not be guessed.

## Cleanup recovery

The runner could not immediately remove its marker-owned Windows temp directory.
A separate preflight verified the exact directory was a direct child of the
canonical OS temp root and matched `celebratedeal-wp171-*`. That exact directory
was removed and confirmed absent. The terminal receipt remains immutable and was
not rewritten to PASS.

## Deterministic evidence

- WP-171 Node tests through the installed local TSX loader: PASS, 10/10.
- First plain Node discovery attempt failed before test execution because it
  could not resolve the project's TypeScript alias; it did not install a package,
  access a registry or count as passing evidence.
- Scoped local ESLint: PASS.
- Workspace TypeScript no-emit: PASS.
- Static environment-enumeration／env-file／Production PayUni host／SQL mutation
  deny gate: PASS.
- Strict sanitized receipt readback: PASS.
- `git diff --check`: PASS.
- Staged index: empty.
- WP-170 receipt／runner, PayUni adapter／types and Prisma schema protected digests:
  unchanged.

The external runner was launched from a child process in which the seven exact
target variable names were removed without reading their values. The broker
parent therefore recorded target-key presence `0`; only Vercel Preview could
inject the bindings used by the child.

## Score and Gate impact

- CAT04 remains `6.0`; total remains `71.5`.
- `SANDBOX_READY=false`; `PRODUCTION_READY=false`.
- G1 remains CLOSED; G2 remains LOCAL_REHEARSAL_PASS; G3-G6 remain NOT_VERIFIED.
- `CORRECTED_PREVIEW_CHILD_STARTUP=VERIFIED`.
- `STAGING_DATABASE_IDENTITY=NOT_VERIFIED`.
- `PAYUNI_SANDBOX_READ_ONLY_LOOKUP=NOT_RUN`.
- No score or launch Gate is changed by this work package.

## Stop condition applied

WP-171 consumed its only external attempt. It must not be rerun. Any further
progress requires a new Sol-planned work package with new artifacts. A future
runner must preserve both the primary child failure and cleanup failure as
separate sanitized fields so cleanup cannot obscure the earlier fail-closed
classification.

## AGY Fast QA

Both canonical read-only attempts reached `FIRST_OUTPUT_TIMEOUT` with no stdout
or stderr. The saved status is `TOOL_BLOCKED`; it is not a QA pass and does not
replace deterministic evidence.

## Sol High acceptance

- Verdict: `ACCEPT — TERMINAL_FAIL_CLOSED／CORRECTED_STARTUP_EXTERNALLY_VERIFIED／DB_NOT_REACHED`.
- Accepted as an honest safe checkpoint, not as DB or PayUni reconciliation.
- CAT04 remains `6.0`; total remains `71.5`.
- Further work requires a new WP-172 and must not rerun or rewrite WP-171.
