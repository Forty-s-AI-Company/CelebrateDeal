# WP-172 Primary Outcome Preserving Reconciliation

## Outcome

- Terminal receipt: `WP172_CLEANUP_EXACT_NO_GO`.
- Preserved primary status: `WP172_DATABASE_IDENTITY_EXACT_NO_GO`.
- Preserved primary failure: `PAYUNI_NOT_SANDBOX`.
- Primary outcome was captured before cleanup and remained intact after cleanup failed.
- Freshness metadata reads: `1`; health HEAD probes: `1`.
- Preview broker attempts: `1`; retries: `0`.
- DB connection／transaction／application SELECT: `0/0/0`.
- PayUni Sandbox lookup: `0`.

The exact current WP-167 staging deployment remained Preview／Ready and the
health HEAD returned 200 without redirect. The broker returned exactly one valid
sanitized child result with no environment autoload or assignment. The child
stopped before DB access because the Preview binding classified `PAYUNI_ENV` as
not equal to `sandbox`. No environment value was read, emitted or persisted.

This evidence proves the configuration classification only. It does not prove
the actual value, who configured it, or that changing it is safe. A future work
package must use a separately authorized Preview-only environment-variable
mutation and a fresh deployment/freshness cycle before retrying reconciliation.

## Outcome preservation contract

The receipt independently retains:

- `primaryOutcome`: normalized child status, normalized failure and DB／PayUni counters.
- `brokerOutcome`: attempt, exit, child validity and startup verification.
- `cleanupOutcome`: initial cleanup result and residual-path state.

Cleanup controls the terminal fail-closed status but cannot erase or rewrite the
primary result. This closes the evidence-loss defect found in WP-171.

## Cleanup recovery

Windows did not release the marker-owned temp directory during the runner's
bounded cleanup. A separate read-only preflight proved the exact path was a
direct child of canonical OS temp and matched `celebratedeal-wp172-*`. That exact
directory was removed and confirmed absent. The immutable terminal receipt was
not rewritten.

## Deterministic evidence

- Outcome-preservation tests: PASS, 11/11.
- Scoped local ESLint: PASS.
- Workspace TypeScript no-emit: PASS.
- Static environment-enumeration／env-file／Production-host／SQL-mutation deny: PASS.
- Strict sanitized receipt readback: PASS.
- `git diff --check`: PASS.
- Staged index: empty.
- WP-170／171 receipts and runners, PayUni adapter／types and Prisma schema protected hashes: unchanged.

The external runner was launched from a short-lived child process that removed
the seven exact target names without reading their values. Persistent user or
machine environment was not changed; broker-parent target-key presence was zero.

## Side effects and score boundary

- DB／provider writes, payment, refund, callback, deployment, DNS, persistent
  environment mutation, Production, package installation and registry fallback:
  all `0`.
- Raw rows, identifiers, URLs, bodies and sensitive values persisted: false.
- CAT04 remains `6.0`; total remains `71.5`.
- `SANDBOX_READY=false`; `PRODUCTION_READY=false`.
- `PREVIEW_PAYUNI_ENVIRONMENT_CLASSIFICATION=PAYUNI_NOT_SANDBOX`.
- `STAGING_DATABASE_IDENTITY=NOT_VERIFIED`.
- `PAYUNI_SANDBOX_READ_ONLY_LOOKUP=NOT_RUN`.

WP-172 consumed its only external attempt and must not be rerun or rewritten.

## AGY Fast QA

Both canonical read-only attempts reached `FIRST_OUTPUT_TIMEOUT` without stdout
or stderr. The saved status is `TOOL_BLOCKED`; it is not a QA pass and does not
replace deterministic evidence.

## Sol High acceptance

- Verdict: `ACCEPT — ROOT_CAUSE_CLASSIFIED／TERMINAL_FAIL_CLOSED／DB_NOT_REACHED`.
- Accepted as an honest safe checkpoint, not as DB or PayUni reconciliation.
- CAT04 remains `6.0`; total remains `71.5`.
- Preview-only `PAYUNI_ENV=sandbox`, a new Preview deployment and alias activation
  require a separate explicit authorization and WP-173.
