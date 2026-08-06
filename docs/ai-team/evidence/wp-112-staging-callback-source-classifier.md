# WP-112 — Preview callback source classifier evidence

Date: 2026-07-31 (Asia/Taipei)  
Scope: non-Production Preview observability only.  
Score boundary: CAT04 remains **6.0/10**.

## Authorization and deployment boundary

The user explicitly authorized the current complete workspace, including pre-existing dirty and untracked paths, to be exposed to the linked non-Production staging project for this test. This did not authorize Production, DNS, payments, refunds, provider queries, database operations, secret reads, environment-file reads, or raw-log retention.

Before deployment, the Vercel CLI dry manifest showed an upload set of 3,624 files and a stable SHA-256 manifest reference. The initial dry set included `supabase/.temp` runtime metadata. WP-112 added the single root-anchored `.vercelignore` rule `/supabase/.temp/`; its contents were never read or hashed. The corrected dry set contains no files beneath that directory and no `.env*`, `.git`, `node_modules`, `.next`, cookie-file, or private-key paths. The route and route-test files remain in the upload set.

The previous staging alias and the candidate were each independently inspected as `READY`, `preview`, and belonging to the linked staging project. Only opaque SHA-256 deployment references are retained in the receipt.

## Deterministic evidence

- Next.js Route Handler documentation was read before implementation.
- `npx vitest run src/app/api/webhooks/payments/route.test.ts src/lib/payment-providers/payuni.test.ts`: **45 passed**.
- Scoped ESLint: pass.
- TypeScript: pass.
- `git diff --check`: pass (only pre-existing CRLF warnings were emitted).

The owned route now emits a Preview-only fixed log schema after each explicit response. `HEAD` remains `405` with `Allow: POST`, does not read a body, verify a signature, access the database, or write audit data. The log schema carries only event, method, fixed path, allowlisted source, status, and server timestamp.

## Staging evidence

Exactly two bodyless requests were made, with redirect following disabled:

| Source | Method | Status | Redirect | Application log |
| --- | --- | ---: | --- | --- |
| `return` | `HEAD` | 405 | none | fixed event, `HEAD`, fixed path, `return`, 405, timestamp |
| `notify` | `HEAD` | 405 | none | fixed event, `HEAD`, fixed path, `notify`, 405, timestamp |

The bounded deployment log query returned exactly these two application records. No raw query, body, header, identifier, credential, order/trade/event value, IP, user agent, or raw Vercel log dump was retained.

## Gate and non-claims

If Sol accepts this package, `CALLBACK_SOURCE_OBSERVABILITY` may become `PASS`, resolving WP-108 `BLOCKED_QUERY_NOT_OBSERVABLE` and unblocking a separately planned dual-callback Sandbox package.

This is not evidence of a real PayUni POST callback, payment, refund, reconciliation, CAT04 7.5, `SANDBOX_READY`, or `PRODUCTION_READY`. CAT04 must remain 6.0 in this package.

## Rollback

The original staging alias target was held as an opaque rollback reference during the probes. If any Gate had failed, the alias would have been restored before further work. No such rollback was needed. The Preview artifact is retained for audit; no DNS or Production configuration was changed.
