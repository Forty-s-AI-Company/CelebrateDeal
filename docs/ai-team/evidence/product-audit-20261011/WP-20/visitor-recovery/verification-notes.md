# Identity-preserving recovery

Authentic expired proof retains authenticated visitor ID in inspect result; verify still rejects expired proofs. Internal recover accepts only expired proofs validated under a retained key and exact scope, signs same visitor with current key and explicit future lifetime. Provisioner checks current enabled version/context and existing scoped visitor under key-share lock before recovery. No new visitor, no fact rewrite, no admission granted, no version retention extension. Valid proofs unchanged. Removed/deleted visitor, disabled scope, forged/foreign/unknown-key/not-yet-valid proof cannot recover. Prior checkpoint's typed-expired rejection is superseded by same-identity recovery, not new identity issuance.

Security boundary: a retained expired bearer proof remains identity-recovery evidence while its scoped version and persisted visitor remain eligible. Revoke by removing key, deleting identity or disabling scope; no standalone elapsed-age recovery limit invented. HTTP must not use this as admission/access authorization. Independent review of this recovery policy NOT_RUN.

Validation: targeted/lint/full tsc PASS4e4d4f71ee99219c459a47aef38e1047f07f51f3d948102a935978e7fd7b9ebe; actual DB133/runner lint/cleanup PASS26ae2b5152b83767a01d5dba323ed35d606b53936b44989d110f67cc905db85b. New actual DB case tests same persisted identity recovery in Asia/Tokyo and America/Los_Angeles and deleted-identity refusal. Uses synthetic pre-expired proof; real time advancing across expiry boundary not separately tested. First issuance multi-tab/response loss and HTTP collector remain incomplete.

Rollback: precise inspect expired metadata/recover/provisioner branch/test changes only, no deployed state.
