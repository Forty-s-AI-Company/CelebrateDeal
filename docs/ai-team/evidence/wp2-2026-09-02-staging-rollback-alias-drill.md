# WP2 — current-source staging rollback alias drill (2026-09-02)

## Scope

- Environment: `Preview` only; project: `celebrate-deal-staging`.
- Current source: `23fdee6d3027ffaa8fbb0bfb947517c8c4b6b980`.
- Verified rollback source: `22c166d0f338d406d14ca4d2b4218f6a702b3d0a`.
- No Production deployment, database write, migration, payment, refund, Git mutation, or environment-variable change.

## Result

- Dedicated staging-only rollback alias: `PASS`.
- Rollback assignment: `PASS`.
- Rollback `/login` and `/api/health`: HTTP `200`, no redirect: `PASS`.
- Forward restore assignment: `PASS`.
- Restored `/login` and `/api/health`: HTTP `200`, no redirect: `PASS`.
- Final alias points to the current Preview deployment: `PASS`.

## Sanitized operational receipt

- DNS CNAME was verified before the assignments; no DNS value is retained here.
- Alias mutation 1/3: create the dedicated Preview alias in `celebrate-deal-staging`.
- Alias mutation 2/3: assign exact rollback Preview deployment (`22c166d`).
- Alias mutation 3/3: restore exact current Preview deployment (`23fdee6`).
- Each Vercel assignment returned success; deployment URLs, certificate identifiers, query strings, credentials, and raw provider output were discarded.

## Evidence limits

- Deployment identity comes from the Vercel assignment receipt plus the exact Git source associated with each ready Preview deployment.
- Health verification is bounded to HTTP status and redirect classification; response bodies were not retained.
