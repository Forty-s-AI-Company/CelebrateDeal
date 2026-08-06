# WP-105 — PayUni Sandbox partial-refund and reconciliation evidence

Date: 2026-07-31 (Asia/Taipei)  
Scope: CAT04 Sandbox-only evidence. No Production endpoint, credential, customer data, deployment, DNS, or Production database operation was used.

## Sanitized Sandbox receipt

- CelebrateDeal staging host: `celebrate-deal-staging.carry-digital-nomad.in.net`
- PayUni allowlisted host: `sandbox-api.payuni.com.tw`
- Synthetic order reference: `sha256:aab2ef195a70`
- Original successful payment: NT$1,680.
- One successful partial refund: NT$840.
- PayUni provider query #1 returned `SUCCESS`, paid trade status, refund status `2`, refunded amount NT$840, and remaining refundable amount NT$840.

## Over-refund rejection and re-query

- A single NT$841 request was made only after the NT$840 partial refund; it exceeds the remaining NT$840 by NT$1.
- CelebrateDeal returned to `/admin/billing/dashboard?error=refund`. It did not report a completed refund.
- PayUni provider query #2 returned the same sanitized values as query #1: original NT$1,680, refunded NT$840, remaining NT$840, with no additional provider refund recorded.
- This establishes the scoped invariant that the rejected over-refund did not change the provider-side refund total.

## Staging read-only projection after rejection

- The existing, authenticated finance-dashboard read model located the hashed target transaction and displayed `partially_refunded` with `已退 NT$840`.
- The same target had exactly one visible `refund_payment_transaction` audit projection after both requests.
- The dashboard deliberately has no `RefundRecord` read projection; no direct staging database, Supabase console, credential, or hidden endpoint was used to infer one.

## Deterministic evidence

- Preflight passed: empty staged index and `git diff --check`.
- `node --check scripts/payuni-sandbox-external-qa.mjs` and `node --check scripts/payuni-sandbox-payment-handoff.mjs`: passed.
- `npx vitest run src/app/actions.test.ts src/lib/payment-providers/payuni.test.ts src/lib/payment-webhook-invariants.test.ts scripts/payuni-sandbox-external-qa.test.mjs scripts/payuni-sandbox-payment-handoff.test.mjs`: 170 passed.
- Scoped ESLint and `npx tsc --noEmit`: passed.

## Limits

This adds only the partial-refund and over-refund reconciliation evidence for WP-105. It does not establish the complete CAT04 Sandbox matrix, change the CAT04 score by itself, or establish Production readiness.
