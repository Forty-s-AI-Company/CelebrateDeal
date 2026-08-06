# WP-108 — staging callback log observability

Date: 2026-07-31 (Asia/Taipei)  
Result: `BLOCKED_QUERY_NOT_OBSERVABLE`

## Safe preflight

- The staged index was empty. Existing dirty content remained `PRESERVE_ONLY`.
- The staging alias was uniquely found and deployment inspection did not identify a Production target.
- Static route inspection found only a `POST` payment-webhook handler; the two probes therefore did not enter body parsing, signature verification, webhook handling, audit writes, or database work.

## Performed bounded probes

Exactly two stateless requests were sent, one second apart:

1. `HEAD /api/webhooks/payments?provider=payuni&source=return` → `405`, no redirect.
2. `HEAD /api/webhooks/payments?provider=payuni&source=notify` → `405`, no redirect.

Vercel returned two machine-readable serverless request records with the expected method, path, status, timestamps, and same hashed deployment reference. However, the structured `requestPath` field contained only `/api/webhooks/payments`; query data was not present in either record.

## Fail-closed consequence

The records cannot prove which record belongs to `return` versus `notify`. Timestamp ordering is not a valid substitute, so WP-108 cannot close the WP-106 log blocker.

No POST, Sandbox payment, refund, provider query, callback processing, database mutation, deployment, DNS, Production operation, or environment-file read occurred. CAT04 remains **6.0/10**.

Sanitized receipt: `.ai-team/reports/wp108-staging-callback-log-observability/20260731-head-query-redaction-blocked.json`.
