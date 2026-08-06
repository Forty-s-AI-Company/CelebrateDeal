# FIN-05 Affiliate merchant self-payment workflow evidence

## Status

- work package: `FIN-05`
- scope: `src/app/actions.ts` and `src/app/actions.test.ts`
- production access: `NO`
- external service access: `NO`
- decision: `ACCEPT`

## Implemented contract

- Added merchant-scoped `recordAffiliatePayoutOutcomeAction`.
- Requires CSRF validation and `requireVendorFinance("/affiliates/commissions")`.
- Accepts only non-empty bounded id, `paid` or `void`, and a trimmed reason of 1-500 characters.
- Uses one Serializable transaction and vendor-scoped payout lookup.
- Rejects non-null `payoutItemId`, non-positive or inconsistent final amounts, missing commissions, unlocked commissions, ledger mismatch, and claim races.
- `pending -> paid` sets payout and locked commissions to paid with one shared timestamp and writes an in-transaction audit; it does not create a ledger event.
- `pending -> void` writes stable merchant reversal events for positive balances, then voids the payout and matching locked commissions in the same transaction and audits the reason.
- Same terminal status is idempotent without another audit or ledger row; reverse terminal transition fails closed.
- PayoutItem, PayoutBatch, Settlement, bank, KYC and provider paths are not called.

## Verification

- targeted finance cohort: `5 files / 179 tests passed`
- targeted actions tests: `148/148 passed`
- full Vitest: `135 files / 1128 tests passed`
- Node TAP contracts: `490/490 passed`
- lint: `0 errors / 2 existing warnings`
- typecheck: passed
- strict-index typecheck: passed
- `git diff --check`: passed
- AGY fallback: Fast `FIRST_OUTPUT_TIMEOUT`; Deep produced no review output because a headless tool permission was denied; classify `TOOL_BLOCKED`, not QA PASS
- Sol acceptance: `ACCEPT`; checkpoint allowed
- DB/Docker/PayUni/Playwright/staging: not run
- coverage/E2E: deferred until finance functional closure and global coverage gate

## Known boundary

The existing ledger enum has no payout event. Paid outcomes therefore do not fabricate a ledger event; void outcomes use the supported `reversal` event with a stable payout identity.

## Rollback

Remove only the FIN-05 action, imports, mocks and appended test block from the two approved files. Preserve FIN-01/FIN-02/FIN-04 and all other dirty ownership.

## Current revalidation and fallback chain

- `VALUE_CHECK`: this revalidation directly verifies the merchant self-payment product workflow; no coverage-only work was performed.
- targeted finance cohort: `181/181 passed`.
- full Vitest: `165 files / 1230 tests passed`.
- Node TAP contracts: `499/499 passed`.
- lint: `0 errors / 2 existing warnings`.
- typecheck and strict-index typecheck: `PASS`.
- `git diff --check`: `PASS`.
- AGY Fast: two bounded `FIRST_OUTPUT_TIMEOUT` attempts; `TOOL_BLOCKED`.
- AGY Deep fallback: one bounded `FIRST_OUTPUT_TIMEOUT` attempt; `TOOL_BLOCKED`.
- Luna: `FALLBACK_HANDOFF_REQUIRED`; no native-agent Luna runtime was started.
- raw output persisted: `false`.
- external side effects: `false`.
- Sol acceptance remains based on deterministic evidence and the existing FIN-05 contract; AGY tool failure is not represented as QA PASS.
