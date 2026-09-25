# WP4 buyer order and duplicate callback proof preparation

Date: 2026-09-25. Base source: `origin/master` at `a2969b0523cf6bb15284c669699a5f9b7f76120e`.

Result: `NOT_PROVEN` for external PayUni Sandbox checkout, persisted order and duplicate callback. No provider request, callback replay, deployment or database write was executed in this work package.

The Preview Sandbox only route `/api/admin/ops/payuni/wp4-buyer-order-proof` now reads the exact source owned synthetic buyer transaction. It returns a closed state proof only when a single paid PayUni transaction maps to one paid commerce order with the same amount and order number, one committed inventory reservation and exactly one `payment.paid` order event. It returns no transaction, order, buyer or callback identifiers. The pure duplicate proof gate requires two verified state snapshots, the same acknowledged callback event, a duplicate acknowledgement on the second delivery and unchanged persisted state including remaining synthetic product inventory. An HTTP 200 alone cannot satisfy this gate.

Local verification: 9 focused Vitest tests passed; focused ESLint passed; `git diff --check` passed after exact files were staged. TypeScript project check could not pass with the shared existing Prisma client: unrelated `liveId` errors in `src/lib/automation-workflow.ts` and `salesProject` in `src/lib/landing-page-service.ts`. No schema or generated client was changed here.

External closure still requires exact Preview source/deployment and nonproduction schema binding, one synthetic Sandbox payment, capture of the same signed callback for a bounded second delivery, and two actual database snapshots around that delivery. The second acknowledgement must identify the same event and report `duplicate: true`. Without that sequence, this work package remains `NOT_PROVEN`.
