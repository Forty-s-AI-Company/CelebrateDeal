# Visitor provisioning checkpoint

Server-only service resolves already-enabled scoped version under a shared lock; clock read occurs after lock acquisition. New identity persisted in transaction before proof can escape; failed insert/commit propagates. Existing proof verified against scope and DB time and existing scoped visitor; no renewal or deleted-identity resurrection. Scope and expiry supplied by trusted server context. Browser digest hashes a random identity, not device attributes.

Validation: targeted visitor/proof tests, scoped lint, full tsc PASS at sha256:3a2bce1b36d5874e6fc1a71fb54b957d0fd8b515c997da244d37aa48476fcc2f. Transaction tests use mocks; actual disposable PostgreSQL integration NOT_RUN for this new service. Auth independent review NOT_RUN. No READY claim.

Remaining: actual DB guard/concurrency tests, public-content resolver, origin/rate limits, secure proof transport, explicit expired-proof recovery, concurrent initial-tab reconciliation, collector wiring and durable coverage. No HTTP endpoint activated. A proof alone is not consent/admission/person identity. Initial issuance without an existing proof creates a new browser identity; lost responses and simultaneous first requests still need lifecycle reconciliation before activation.

Rollback: remove only new live-metric-visitor.ts/test.ts; no migration/deploy state modified.
