# Uncounted preparation then proven collection

prepareMetricVisit resolves public context and commits identity/proof only; no LiveMetricVisit is inserted. collectPreparedMetricVisit requires a nonempty bounded retained proof and delegates atomic collection. No new signing protocol/schema needed. Browser must persist the preparation response before event submission. Existing collectMetricVisit is internal composition and permits unprepared creation for internal tests; HTTP must exclusively use collectPreparedMetricVisit.

Actual DB simulates discarded first preparation response, prepares again, verifies zero visit facts, refuses proofless public collection, then records one visit tied to retained proof. Two persisted identities exist but only one counted visit; unused preparation identities must NEVER be used as the visitor denominator. Concurrent proven event retries still one visit; final write failure rollback and disabled-form refusal remain verified. Preparation idempotency is not claimed: lost responses may leave uncounted identities. Rate-limit/retention and browser multi-tab serialization remain required before HTTP activation.

Validation targeted/lint/tsc PASScf78ba55a6c88a316de0abe9a7b7e3999090c1f2c4c713add545ce966ad9faf7. DB134/runner lint/cleanup PASSbfe4a0449582d24b855ed1de9cd424a5fbe0b05c9e93637996a3a4e3eb010fbb. Independent review and browser transport NOT_RUN. WP20 NOT_READY.

Rollback: remove prepare/public wrapper/tests and precise runner changes. No deployed state changed.
