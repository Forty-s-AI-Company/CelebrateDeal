# Full collection actual PostgreSQL

DB134, scoped runner lint and cleanup PASS at b2948bda1c9332db442d8aa81415034affc14cd1648955fbca5c54041e4301e0. Owned loopback disposable PostgreSQL and synthetic data/key only.

New case creates a separate synthetic public-ready waiting live and correctly fingerprinted enabled version. Calls real collectMetricVisit -> real public context -> real provision/recovery -> real visit writer. Initial result commits one visitor/visit; two concurrent proven retries return the same original timestamp and identity with one stored row. Injects a real PostgreSQL division-by-zero exactly when the final visit INSERT is reached; proves that branch ran and counts remain one visitor/one visit, so the earlier newly inserted identity rolled back. Turns off form activity and confirms subsequent collection denied with unchanged counts. Removes temporary tenant/version in finally; original global fixture counts still pass.

No product source changes this round. Previous source unit/tsc checks remain applicable. No HTTP endpoint activated; first unproven issuance response loss/multitab remains unsolved. Durable coverage, complete metrics pipeline and independent review still incomplete. DB test does not prove all possible publication-resource races or elapsed-time expiry races.

Rollback: remove the added runner export/check only. No deployment or persistent production data touched.
