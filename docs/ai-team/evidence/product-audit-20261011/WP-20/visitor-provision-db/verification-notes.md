# Visitor provisioning actual PostgreSQL

132 DB checks PASS; runner lint PASS at sha256:fd577877351a59a4613b6d925f4415c42df5e3277071191ae7e730483c21e407. Owned disposable PostgreSQL only, synthetic data/key. Container/tempRoot cleanup PASS. Receipts retained here.

New case executes actual provisionMetricVisitor and proof service against actual schema/triggers. Verifies persisted scope/hash, proof matching persisted server timestamp, simultaneous proven revisits returning the same receipt, one identity row, foreign scope/invalid proof refusal, disabled version refusal for both issuance and reuse, and deleted visitor refusal without resurrection.

Not tested: simultaneous first issuance without proof, response loss recovery, real HTTP transport/browser lifecycle, full metric pipeline. No product source changes this round; prior targeted/tsc results remain source-applicable. Independent Auth review NOT_RUN; no acceptance PASS claimed. Initial routing call used invalid task_type test and failed before edits; corrected implement route saved.

Rollback: remove new runner exports/check only; no deployed DB state changed.
