# Visitor proof primitive

Scope: server-generated UUID, domain-separated HMAC-SHA256, strict tenant/live/version/lifetime, bounded canonical proof encoding, constant-time signature comparison. Dedicated key injected by caller; no environment or secret reads. Key bytes copied. No HTTP endpoint, cookie access, database provisioning, consent or coverage inference.

Validation: targeted tests, scoped lint, full tsc PASS for sha256:a220654ae7460639f56531b68371cf56f85720228484076347618d28ff293b8f; receipts alongside. Synthetic key only. Independent Auth review NOT_RUN, acceptance NOT_READY.

Integration requirement: trusted server resolves enabled content and lifetime, persists generated visitor before returning proof, verifies request origin and scoped proof before recording visits. Secure transport/HttpOnly cookie and CSRF protections belong to HTTP integration. Proof is a bearer capability, not a person identity or admission credential. Existing database visitor and expiry must still be checked. Signing key rotation invalidates proofs and may affect browser deduplication; do not activate without reviewing the full collector lifecycle.

Rollback: remove only the two new visitor-proof source/test files and their integration if later added. No migration or deployed state changed.
