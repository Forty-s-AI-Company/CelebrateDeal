# WP-111 — staging callback source classifier

Date: 2026-07-31 (Asia/Taipei)  
Result: `NO_GO_DEPLOYMENT_ISOLATION_AND_TOOL_BLOCKED`  
Score impact: CAT04 remains **6.0/10**.

## Planned scope and local evidence

Sol selected a minimal Preview-only PayUni callback-source classifier because WP-108 proved Vercel request records omit query parameters, which blocks the later dual-callback Sandbox verification. Terra completed the required Next.js Route Handler documentation review and implemented the classifier only in clean route and route-test paths.

Before the staging boundary, the scoped local implementation passed:

- `npx vitest run src/app/api/webhooks/payments/route.test.ts src/lib/payment-providers/payuni.test.ts`: 44 passed.
- scoped ESLint and TypeScript: pass.

The implementation was then removed with an exact `apply_patch` rollback because staging deployment could not be isolated safely. After rollback, the unchanged baseline route/provider suite passed 37 tests; the two route paths have no remaining WP-111 diff and staged index is empty.

## Fail-closed pre-deployment result

- The workspace has 38 pre-existing modified tracked paths, all `PRESERVE_ONLY`.
- A direct Preview deployment from this workspace would upload those unrelated unreviewed changes together with WP-111; this cannot prove the candidate contains only the owned hunk.
- The local Vercel CLI is unavailable (`vercel` command not found). No installation, browser login, secret access or fallback command was attempted.

No Preview deployment, staging alias change, HEAD probe, Vercel log query, Sandbox payment, callback, provider query, refund, database operation, DNS change, Production action or environment-file read occurred.

## Required remediation / authorization

Before retrying this exact Gate, the Release owner must provide one of:

1. an isolated, reviewable deployment input containing only a stated base revision plus WP-111 owned hunks, together with the approved non-Production staging alias; or
2. explicit authorization to deploy the complete current dirty workspace to staging, including acknowledgement that all 38 existing tracked changes would be externally exposed.

The staging operator also needs a configured Vercel deployment capability that does not require exposing credentials to the agent. On receipt of either safe path, create a fresh Sol plan; do not reuse this local patch as an accepted change.

## Non-claims

WP-108 remains `BLOCKED_QUERY_NOT_OBSERVABLE`. This evidence does not establish callback source observability, Return/Notify POST processing, dual callback reliability, CAT04 7.5, Sandbox readiness or Production readiness.
