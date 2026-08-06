# FIN-04 AffiliatePayout writer evidence

## Status

- decision: `ACCEPT`
- work package: `FIN-04`
- scope: `src/app/actions.ts` (`lockSettlementAction`) and `src/app/actions.test.ts`
- production access: `NO`
- external service access: `NO`

## Implemented contract

- Affiliate commissions are locked and AffiliatePayout rows are created in the same transaction.
- Payout amounts are derived from `commissionLedgerBalance` for locked commissions and aggregated by affiliate.
- The database composite identity `vendorId + affiliateId + monthKey` is used for idempotent lookup.
- Matching existing payout rows are preserved; mismatched amounts and negative ledger balances fail closed with a conflict redirect.
- Zero ledger balances do not create payable rows.
- No fake ledger event was emitted. The existing `AffiliateCommissionLedgerEntryType` union has no payout event; `appendCommissionLedgerEntry` was therefore not called for this writer. Payment/void ledger mutations remain governed by their existing supported event types.

## Verification

- targeted actions tests: `130/130 passed`
- full Vitest: `135 files / 1110 tests passed`
- Node TAP contracts: `490/490 passed`
- lint: `0 errors / 2 existing warnings`
- typecheck: passed
- strict index typecheck: passed
- `git diff --check`: passed
- AGY Fast: `TOOL_BLOCKED` (`FIRST_OUTPUT_TIMEOUT`, two attempts)
- disposable DB concurrency: `BLOCKED_ENVIRONMENT / NOT_SCHEMA_DRIFT`; the synthetic config stopped before database access because required WP17 environment variables were absent
- coverage and E2E: deferred by the long-goal sequence; no E2E was run while the global coverage gate remains below `63/57/60/65`

## Rollback

Remove only the FIN-04 hunks in the two approved files. Preserve all unrelated dirty and untracked ownership. No schema or migration rollback is required.

## Superseding concurrency evidence

The earlier environment-blocked concurrency line is historical. FIN-06 reran
the WP17/WP18 disposable schemas with canonical migrations and recorded
`137 files / 1130 tests passed`, with marker-owned cleanup verified. See
`fin-06-finance-disposable-concurrency.md` for the sanitized receipt.

## Direct writer-race closure

The FIN-04-owned WP18 disposable run was rerun after adding a direct race
assertion to `src/app/actions.payout-db.test.ts`. Two concurrent
`lockSettlementAction` calls used the same marker-owned PostgreSQL schema and
the same settlement version predicate. The targeted WP18 suite passed `153/153`
tests, including the new writer race: one normal redirect, one conflict
redirect, exactly one AffiliatePayout row for the vendor/affiliate/month key,
one locked commission, and no duplicate payout. Canonical migration validate,
deploy and status passed for both WP17 and WP18; marker cleanup passed for both
schemas and source/protected manifests were unchanged.

The runner's later combined coverage command exited non-zero because the
existing global coverage gate and historical snapshot-only evidence fixtures
remain incomplete. This is recorded as `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`,
not schema drift; it does not invalidate the preceding targeted concurrency
result. No raw output, URL, credential or dotenv content was persisted.

## AI_TEAM_HANDOFF

```yaml
CURRENT_TASK_STATUS: COMPLETE
COMPLETED_ITEM: FIN-04 AffiliatePayout writer
CURRENT_WORK_ITEM: FIN-04 checkpoint complete
DECISION: ACCEPT
NEXT_TASK_TITLE: Terra Execute | FIN-05 Affiliate payment workflow
NEXT_ROLE: TERRA
NEXT_MODEL: gpt-5.6-terra/High
NEXT_ACTION: Sol readonly plan, then one bounded Terra work package
WORKFLOW_MODE: PRELAUNCH_DEV
ROOT_CAUSE_CATEGORY: FINANCE_AFFILIATE_PAYOUT_WRITER_CLOSURE
APPROVED_FILES:
  - src/app/actions.ts (lockSettlementAction only)
  - src/app/actions.test.ts
PRODUCTION_ACCESS_REQUIRED: NO
SCHEMA_CHANGE_AUTHORIZED: NO
EXTERNAL_SERVICE_ACCESS: NO
COVERAGE_STATUS: DEFERRED_GLOBAL_GATE_BELOW_63_57_60_65
E2E_STATUS: DEFERRED_UNTIL_GLOBAL_COVERAGE_GATE
AGY_FAST_STATUS: TOOL_BLOCKED_FIRST_OUTPUT_TIMEOUT_TWO_ATTEMPTS
DISPOSABLE_CONCURRENCY_STATUS: BLOCKED_ENVIRONMENT_NOT_SCHEMA_DRIFT
KNOWN_LIMITATION: AffiliateCommissionLedgerEntryType has no payout event; no unsupported ledger entry was fabricated
NEXT_WP_AUTOSTART: NO
```

## Post-policy AGY fallback verification

- `VALUE_CHECK`: this fallback review directly validates the FIN-04 product contract; it does not pursue coverage percentage.
- AGY Fast historical status: `TOOL_BLOCKED_FIRST_OUTPUT_TIMEOUT_TWO_ATTEMPTS`.
- AGY Deep fallback: one bounded read-only wrapper invocation returned process `SUCCESS` / exit `0` for `gemini-3.1-pro-high`.
- raw model output persisted: `false`.
- external side effects: `false`.
- Deep output was supplementary QA evidence only; existing deterministic tests, disposable WP18 race evidence and Sol `ACCEPT` remain the authoritative functional acceptance.
- Luna handoff: `NOT_REQUIRED` because Deep produced a structured wrapper result.
