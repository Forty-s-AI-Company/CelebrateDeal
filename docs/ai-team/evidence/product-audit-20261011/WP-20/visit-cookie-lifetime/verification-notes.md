# Bounded identity cookie retention

Visitor receipts now separate expiresAtMs (effective proof/current content lifetime) from cookieExpiresAtMs (existing version.expiresAt). The route uses cookieExpiresAtMs so an expired proof remains available for same-identity server recovery. No version/schema/retention policy changed. Existing version collection/lifetime and persisted visitor checks still gate every operation. Shortening version retention is reflected in subsequent responses; old browser cookie may persist until original deadline if no response occurs, but server rejects it after current version expiry. Revoked keys/deleted identity/disabled collection still refuse recovery.

Validation targeted visitor/route/collection tests, lint/full tsc PASS904e6569ce60cdb6e9f385fcc176412b90ee3eb0938caaff8c81e071a5da6174. Unit actual proof expires at1200, same identity recovers at1300 within version2000; no DB write on recovery. HTTP test asserts actual Set-Cookie uses retention, not shorter proof validity.

Real fresh Chromium with synthetic loopback server PASS26fd5525a233e86f8cb03167a1b2856d83fc16f14afdc7fc772cc1074a5cdbe5: Secure/HttpOnly/Strict cookie accepted in trusted loopback, not exposed to document.cookie, still sent after synthetic shorter proof timestamp, removed by expired Set-Cookie. Synthetic cookie and Boolean-only evidence; no real browser data. Browser/server cleanup PASS. Harness does not execute the Next route or DB and is not full HTTPS E2E. New receipt DB regression and independent Auth review NOT_RUN.

Remaining: integrated browser/API/DB path, long-lived page version handling, durable coverage/gap tracking, complete metrics pipeline/UI and independent acceptance.

Rollback: revert cookieExpiresAtMs additions and route expiry target plus tests/harness; no deployment performed.
