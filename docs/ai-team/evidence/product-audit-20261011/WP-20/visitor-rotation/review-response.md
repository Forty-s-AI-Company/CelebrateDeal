# Visitor key rotation and error contract

Addresses original visitor-provision-db review findings 3/4/6: current plus at most two retained keys, unique bounded key IDs in authenticated payload, sign current only, key-byte snapshot, no automatic identity rotation. Unknown key is explicitly unauthenticated metadata and must never authorize recovery. Raw-key compatibility uses default key ID for isolated callers. Pre-keyId format has never been activated and is intentionally rejected; no deployed credentials migrated.

Proof errors and scope/missing/lifetime now typed. Any unrecognized persistence failure becomes PERSISTENCE_UNAVAILABLE with fixed message and no raw cause/meta. This does not guess that every SQL23514 means a particular lifecycle race. Caller must treat it as unavailable, not authorize/rotate. Added tests for sanitizing23514/57014/23505 and lock/transaction assertions. Browser hash remains scoped random-ID digest, not deduplication proof.

Validation: targeted/lint/full tsc PASS aed35374393811431b26cc13d6add30c4be7b46e12f6cc890475289e7adac432. Initial tsc tuple-index assertion failed; corrected to toHaveBeenCalledWith without weakening expected transaction options; failure retained. Actual DB 132 checks and cleanup PASS af3a344e8c3a4518c93cd792db921b30d4369166ea884328931365ba853b2ff3. DB suite exercises current source but does not yet contain requested nonUTC/time-advancing expiry/key-rotation scenarios; those specific cases NOT_RUN. Independent re-review NOT_RUN.

Still required: recovery retaining identity after legitimate expiry, initial multi-tab/request retry reconciliation, public collector/version activation, durable coverage, full metrics pipeline and acceptance. No HTTP route activated. WP20 NOT_READY.

Rollback: exact keyring/payload/error/test differences only; no schema or deployment change.
