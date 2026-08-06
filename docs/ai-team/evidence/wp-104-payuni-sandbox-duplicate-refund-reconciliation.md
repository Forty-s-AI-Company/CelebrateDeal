# WP-104 — PayUni Sandbox duplicate-refund rejection and reconciliation evidence

Date: 2026-07-31 (Asia/Taipei)  
Scope: CAT04 Sandbox-only evidence; no Production endpoint, credential, transaction, or deployment target.

## Sanitized provider reconciliation receipt

- Synthetic sandbox order: `CD-20260730125435-…`
- PayUni transaction reference: `…47382`
- Original payment: NT$1,680 — successful.
- Provider refund: NT$1,680 — successful.
- Provider transaction detail showed one successful refund after the successful payment.

The source was a user-operated, logged-in PayUni official Sandbox detail page. No card data, email address, IP address, signature, token, cookie, or secret is retained in this evidence file.

## Duplicate refund rejection receipt

- Staging target: `https://celebrate-deal-staging.carry-digital-nomad.in.net`
- Verified route result: `/admin/billing/dashboard?error=refund_already_processed`
- Visible message: `此交易已完成退款，系統沒有再次送出退款請求。`
- The same synthetic transaction remained `refunded` in the CelebrateDeal finance dashboard.
- The rejected form used the terminal transaction's blank refund fields. The Server Action now checks terminal PayUni status before generic amount validation, so no provider refund request, refund record, or audit record is created for this duplicate attempt.

## Deterministic and deployment evidence

- `npx vitest run src/app/actions.test.ts`: 106 passed.
- Scoped ESLint, `npx tsc --noEmit`, and `git diff --check`: passed.
- Vercel staging preview build: passed TypeScript and generated 72 pages; the staging alias was moved to the resulting READY preview deployment.

## Limits

This closes only the WP-104 duplicate-refund explicit-rejection and post-refund provider-reconciliation evidence gap. It does not claim that the full CAT04 sandbox matrix is complete, does not change CAT04 score, and does not establish Production readiness.
