# WP4 buyer order and duplicate callback proof preparation

Date: 2026-09-25. Base source: `origin/master` at `a2969b0523cf6bb15284c669699a5f9b7f76120e`.

Result: `NOT_PROVEN` for external PayUni Sandbox checkout, persisted order and duplicate callback. No provider request, callback replay, deployment or database write was executed in this work package.

The Preview Sandbox only route `/api/admin/ops/payuni/wp4-buyer-order-proof` reads the exact source owned synthetic buyer transaction. It returns a closed state proof only when a single paid PayUni transaction maps to one paid commerce order with the same amount and order number, one committed inventory reservation and exactly one `payment.paid` order event. It returns no transaction, order, buyer or callback identifiers.

The protected WP4 buyer runner now captures the actual browser Return POST body in memory only after the payer reaches the matching paid order page and the Return callback responds with HTTP 303. It reads the fixed persisted order proof, replays that exact signed body once to the fixed Notify endpoint, requires the server's JSON acknowledgement `{ ok: true, duplicate: true, eventId: <nonempty> }`, then reads the proof again. The receipt passes only when the two closed database snapshots match, including synthetic inventory count. A browser success boolean or HTTP 200 alone cannot satisfy this gate. The raw callback body, event ID, card data and order ID stay out of the receipt.

Local verification: 91 WP4 runner/secure wrapper contract tests and 8 focused route/domain Vitest tests passed, including mock capture of the 303 Return response, the same in-memory body on replay, rejection of a forged browser success boolean, rejection of an acknowledgement without `duplicate: true`, and rejection of changed persisted inventory. Focused ESLint and staged `git diff --check` passed. TypeScript project check could not pass with the shared existing Prisma client: unrelated `liveId` errors in `src/lib/automation-workflow.ts` and `salesProject` in `src/lib/landing-page-service.ts`. No schema or generated client was changed here.

External closure still requires exact Preview source/deployment and nonproduction schema binding before one synthetic Sandbox payment. The tests above are mocks; they do not establish that PayUni actually sent the Return body, that the second Notify delivery was accepted, or that a real database snapshot stayed unchanged. Without the guarded external run, this work package remains `NOT_PROVEN`.
