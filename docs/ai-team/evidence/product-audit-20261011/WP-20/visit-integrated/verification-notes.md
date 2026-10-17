# Integrated Chromium -> actual visits handler -> PostgreSQL

Owned fresh Chromium two tabs share actual browser-managed Secure HttpOnly cookie and real navigator.locks. Calls actual bundled visits POST handler, canonical same-origin check, actual context/provision/proof/visit services and owned disposable PostgreSQL. Actual NextRequest/NextResponse used by loopback HTTP adapter. Synthetic DB/key dependency injection only; no .env or real credentials/cookies read. One scoped version: delta2 visit facts, delta1 distinct visitor. Repeated client collect returns cached receipt with no extra fact. Browser JS cannot read cookie. Cross-origin synthetic Node request rejected403, counts unchanged.

Explicit exclusions: deployment rate limiter is stubbed to null; Next web-server routing and remote TLS are not running. This is integrated handler/browser/DB validation, not staging deployment acceptance. Browser traffic blocked outside127.0.0.1. No raw cookie/header/identity evidence logged. Global injected test handles deleted and browser/server/container/tempRoot cleaned.

Validation integrated DB134/browser and runner/harness lint PASS449f222809b47c0b2192861d2466e7ca1ee1fb09454ae96b9d5afdecdcc75e22. Browser checks in browser-result.json; full DB/schema/migration receipts retained. Product sources unchanged this round. Independent review NOT_RUN.

Remaining: long-lived page/content transitions, collection failure gaps and durable coverage, visitor->registration/session attribution, full statistics pipeline/report/UI reconciliation and independent Auth/Migration review. WP20 NOT_READY.

Rollback: remove integration helper import/call and helper script; no deployed state.
