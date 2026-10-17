# Actual DB live to replay transition

Expanded complete collector case changes the synthetic live from scheduled/waiting to ended replay with a matching newly enabled replay metric version. Real old-proof collect rejects PROOF_INVALID. Real prepare authenticates old proof and returns new version/identity; new event records in replay. Old live version remains two prepared identities/one actual visit; replay has one actual visit. Foreign tenant preparation rejected. No old facts rewritten, original retries/rollback/form-disable regressions still pass.

Validation DB134/runner lint/cleanup PASS da8b3991cd9aab9fab7ed60eac5b2e5ca8e83053f4fae4778d3dd194d8fbdb07. No product code edits in this round. Earlier corresponding unit/tsc evidence remains applicable. Browser cookie replacement and complete Next/browser/DB E2E NOT_RUN; independent review pending.

Remaining: cookie retention must not discard identity before intended server recovery; long-lived page transition needs a new logical event without replaying old event, durable coverage/gaps, full report pipeline and independent acceptance. WP20 remains NOT_READY.

Rollback: remove precise runner transition assertions/fixture steps only; no deployed state.
