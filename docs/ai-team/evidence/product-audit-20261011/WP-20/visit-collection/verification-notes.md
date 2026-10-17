# Atomic visit collection composition

collectMetricVisit validates scope and eventId-only payload before querying. One READ COMMITTED transaction (10s, maxWait5s, statement5s) resolves current public content, provisions/recovers visitor, then records visit. Existing callback-based persistence services are privately bound to the same transaction; no nested independent commits. Exceptions propagate through the outer transaction and public-safe typed boundary. Returns proof only after outer commit. Client identity/version/timestamp injection rejected.

Validation: targeted collection/context/provision/visit tests, scoped lint and full tsc PASS25dcd2eb4920a2b888ee7e53749749aeec2adbff07eb31fb2bde4834d92769c1. Composition tests use mocks and verify same transaction client, bounds, terminal-write and commit failure rejection, context-denial short circuit. Actual DB combined rollback scenario NOT_RUN. Independent review NOT_RUN.

Remaining: public readiness resource consistency, live/funnel scope coverage, first-browser issuance consistency across retry and tabs, HTTP origin/rate-limit/proof transport boundary, durable collection coverage, full snapshot->metric->UI flow. This service is not an activated collector nor complete coverage proof. Event idempotency is scoped to established visitor; absent-proof retries may create another identity and must be reconciled before activation.

Rollback: remove new collection service/test only; no deployed state or migration changes.
