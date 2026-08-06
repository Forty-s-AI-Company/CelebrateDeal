# FIN-07 refund reconciliation closure evidence

## Status

- work package: `FIN-07`
- decision: `ACCEPT`
- production access: `NO`
- runtime external service access: `NO`
- schema, migration, package or lockfile changes: `NO`

## Implemented invariants

- PayUni reconciliation accepts verified full and partial provider snapshots.
- Processed local refund totals, pending reservation totals, transaction totals and provider totals must agree.
- A terminal local transaction with an incomplete processed refund ledger fails closed instead of returning `already_reconciled`.
- A matching partial reconciliation can be rerun idempotently without another write or audit.
- Payment webhook callbacks fail closed when a request reservation is pending.
- Duplicate refund callbacks reject partial/full event-type conflicts while preserving exact same-type idempotency.
- PayUni refund completion writes the audit row inside the same Serializable transaction as the local completion; audit failure leaves the reservation pending for reconciliation.

## Verification

- FIN-07 targeted tests: `176/176 passed`
- related provider/webhook/route tests: `91/91 passed`
- full Vitest: `135 files / 1135 tests passed`
- Node TAP contracts: `490/490 passed`
- scoped ESLint: `0 errors`
- typecheck: `PASS`
- strict-index typecheck: `PASS`
- architecture boundary: `PASS` (`src/app/actions.ts` 2292 lines)
- `git diff --check`: `PASS`
- AGY Fast: `FIRST_OUTPUT_TIMEOUT`
- AGY fallback Deep: `SUCCESS`, no external side effect
- Sol acceptance: `ACCEPT`

## Known limits

- global coverage remains a separate known gate and was not run in FIN-07
- E2E remains deferred until global coverage passes
- PayUni Sandbox, staging, production and real callback delivery were not validated
- no schema or database rollback was required

## Rollback

Remove only the FIN-07 hunks from the three approved production sources, their
corresponding FIN-07 test blocks, and this evidence file. Preserve FIN-01
through FIN-06 changes and all unrelated user ownership. Do not use reset,
restore, checkout, clean or stash.
