# WP-106 — PayUni Sandbox dual payment-callback evidence

Date: 2026-07-31 (Asia/Taipei)  
Result: `PREPAYMENT_DETERMINISTIC_GATE_FAILED`

## What was safely verified

- Staged index was empty and all PayUni-related dirty paths remained `PRESERVE_ONLY`.
- All required Sandbox values were present in the process environment; no value and no `.env*` content was read.
- The explicit host allowlist accepted the existing public staging host and only `sandbox-api.payuni.com.tw` as provider host.
- Read-only Vercel staging request logs are available and include method, path/query, HTTP status, and timestamp. That is sufficient to distinguish future `source=return` and `source=notify` requests before creating a payment.
- Scoped ESLint, TypeScript, and `git diff --check` passed.

## Blocking deterministic result

The required payment-webhook suite stopped before any Sandbox payment:

- 6 test files: 93 passed, 16 failed.
- All failing cases share the same local schema-drift root cause: the current test database lacks `AffiliateCommission.deduplicationKey`.
- The failures include duplicate callback, concurrent callback, refund-ledger, and late-event checks, so they cannot be narrowed away or treated as passing.

## Side-effect boundary

- No Sandbox payment, callback, provider query, refund, deployment, DNS change, Production operation, database migration, or source-code change occurred.
- No callback body, secret, card data, cookie, token, or raw transaction identifier was retained.

## Required remediation

Resolve the existing **local disposable webhook-test schema drift** in a separately planned, safely owned work package. Only after that deterministic suite passes may WP-106 be re-planned or resumed to create its single allowed Sandbox payment.

CAT04 remains **6.0/10**. This receipt is not evidence of a dual callback, a Sandbox payment, or Production readiness.
