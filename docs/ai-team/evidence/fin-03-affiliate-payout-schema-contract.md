# FIN-03 AffiliatePayout schema contract

## Scope

- Work package: FIN-03
- Mode: PRELAUNCH_DEV
- Production/shared services: not accessed
- dotenv, credentials, provider data: not read or persisted
- Product writer: reserved for FIN-04; no AffiliatePayout writer was added
- Payment policy: merchant self-pay; AffiliatePayout remains separate from merchant PayoutBatch, bank data, and KYC

## Contract changes

- `AffiliatePayout.affiliateId` is required.
- The Affiliate relation is required and remains tenant-bound by `[vendorId, affiliateId]`.
- `[vendorId, affiliateId, monthKey]` is unique.
- Migration preflight fails closed for NULL affiliate IDs, duplicate monthly identity, or negative final amounts.
- Migration performs no data cleanup and adds a database check for non-negative final amounts.

## Deterministic evidence

| Check | Result |
|---|---|
| Prisma validate | PASS |
| Contract tests | 4/4 PASS |
| Full Vitest | 135 files / 1,106 tests PASS |
| Node TAP contracts | 490/490 PASS |
| Lint | 0 errors / 2 pre-existing warnings |
| Typecheck | PASS |
| Strict index typecheck | PASS |
| Disposable migration validate/deploy/status | 14/14 PASS |
| Disposable cleanup | container PASS; temp root PASS; zero persistent volume |
| Receipt verification | PASS |
| Git diff check | PASS |
| Staged files | none |

## External QA boundary

AGY Fast made two bounded attempts and received `FIRST_OUTPUT_TIMEOUT` with zero output; classified as `TOOL_BLOCKED`. This does not replace deterministic evidence and does not authorize external access.

## Acceptance

Sol acceptance: `ACCEPT`.

This evidence does not claim that FIN-04 AffiliatePayout writing, payment workflow, PayUni Sandbox, staging, or production readiness is complete.
