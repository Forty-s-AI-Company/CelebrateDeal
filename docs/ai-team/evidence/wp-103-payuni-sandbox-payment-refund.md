# WP-103 PayUni Sandbox payment and Chrome refund evidence

## Scope and boundary

- Environment: official `sandbox-api.payuni.com.tw` and the explicitly allowlisted non-production CelebrateDeal staging host.
- No Production endpoint, Production credential, customer data, deployment, DNS, or production database operation was used.
- The runner no longer requests `PAYUNI_QA_FINANCE_*` or `PLATFORM_ADMIN_*`; it creates only a payment/callback/provider-query handoff.
- Identifiers are represented only as SHA-256 short references in persisted evidence.

## Deterministic verification

- `node --check` passed for both runner and handoff module.
- Targeted Vitest: 30 passed.
- Scoped ESLint: passed.
- `git diff --check`: passed; staged index remained empty.

## Sandbox receipt

The payment runner produced `.ai-team/reports/payuni-payment-handoff/20260730T125451651Z-5f187605a161.json`:

- browser checkout: passed;
- callback matched: passed;
- PayUni payment query reconciliation: passed;
- transaction reference: `5f187605a161`;
- refund work was deliberately handed to the existing authenticated Chrome session.

## Chrome refund observation

- The dashboard contained exactly one refund form whose internal transaction identifier matched the handoff SHA-256 reference.
- A full Sandbox refund completed; the matched dashboard item became `refunded` and exactly one corresponding refund audit record was observed.
- One duplicate-refund attempt was performed. The item remained `refunded` and no second refund audit record was observed. The interface did not surface an explicit rejection result, so this is **not** a complete duplicate-refund rejection receipt.
- A post-refund PayUni provider reconciliation query was not run in this WP; no claim is made for that matrix cell.

## Acceptance boundary

Sol High accepted WP-103 as partial payment/refund evidence and removal of the unnecessary finance-login dependency. This evidence does not satisfy the complete CAT-04 Sandbox 7.5 threshold and does not change the CAT-04 score.
