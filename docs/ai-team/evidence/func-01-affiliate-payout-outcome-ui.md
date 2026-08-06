# FUNC-01 Merchant AffiliatePayout outcome UI evidence

## Status

- work package: `FUNC-01`
- decision: `ACCEPT`
- workflow mode: `PRELAUNCH_DEV`
- production or external access: `NO`
- schema, migration, package or lockfile changes: `NO`

## Implemented behavior

- The merchant finance commissions page preserves vendor-scoped commission and payout queries.
- Outcome controls are shown only for the current vendor's pending, standalone AffiliatePayout with no platform payout item, a positive final amount, and an amount identity matching commission plus adjustment.
- Existing `recordAffiliatePayoutOutcomeAction` is used directly for `paid` and `void` outcomes.
- Both forms include server-generated CSRF, payout id, required reason, and a 500-character maximum.
- Fixed allowlisted conflict and invalid-input messages are rendered without reflecting arbitrary query values.
- Void copy explicitly states that the unpaid commission is reversed; settled or inconsistent payouts remain read-only.

## Verification

- targeted page tests: `4/4 passed`
- targeted actions and page tests: `154/154 passed`
- full Vitest: `136 files / 1139 tests passed`
- Node TAP contracts: `490/490 passed`
- full ESLint: `0 errors`, `2 existing warnings`
- TypeScript: `PASS`
- strict-index TypeScript: `PASS`
- `git diff --check`: `PASS`
- AGY Fast: two `FIRST_OUTPUT_TIMEOUT` attempts; classified `TOOL_BLOCKED`; no external side effects
- Sol acceptance: `ACCEPT`

## Known limits

- Global coverage was not run for this UI-only functional package; the known global gate remains below `63/57/60/65`.
- Browser E2E, PayUni Sandbox, staging and production were not exercised.
- The two lint warnings predate this work package and did not increase.

## Rollback

Remove only the FUNC-01 hunk from `src/app/(app)/affiliates/commissions/page.tsx`, the new page test, and this evidence file. Preserve all FIN-01 through FIN-07 changes and unrelated user ownership. Do not use reset, restore, checkout, clean or stash.
