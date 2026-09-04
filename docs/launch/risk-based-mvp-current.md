# Risk-Based MVP execution checkpoint

Updated: 2026-09-04 (Asia/Taipei). This checkpoint describes the approved launch scope; it does not supersede historical evidence or declare Production readiness.

## Release scope

- Baseline: `codex/one-stop-webinar-flow`, inspected HEAD `54d52b62616b70ec40e7f11ca0a265f9e46ce691`.
- Include managed merchant invitation, authentication/MFA, products/live content, buyer checkout/delivery/support/refunds, fixed SaaS plans, merchant settlement and tenant isolation.
- Disable new usage billing and affiliate/team commission accrual at server boundaries as well as UI. Preserve historical records, liabilities and refund reversals.
- Exhausted quota blocks new usage, not order lookup, refund or support.
- No Production deployment or real transactions are authorized by this plan.

## Functional matrix

| Journey | Current status | Evidence / next check |
| --- | --- | --- |
| Merchant invitation, login, MFA | NOT_PROVEN | Re-run current-source critical tests and merchant browser journey. |
| Product/live creation, registration and viewing | NOT_PROVEN | Existing E2E inventory is not an execution result. |
| Buyer checkout, callback and delivery | NOT_PROVEN | Verify current branch implementation, not another worktree's run. |
| Refund, reconciliation, merchant settlement | NOT_PROVEN | Diagnose existing Sandbox transaction outcome before any repeat refund. |
| Fixed SaaS plan payment and entitlement | NOT_PROVEN | Verify successful/failed/duplicate payment, refund and expiry. |
| Disabled usage billing and commission accrual | NOT_PROVEN | Map action/API/job/webhook entrypoints before implementing guards. |
| Backup, monitoring and deployment recovery | NOT_PROVEN | Assess prior evidence applicability and recheck affected boundaries. |
| Policies and operational responsibility | PENDING_HUMAN | Required decisions and acceptance cannot be signed by an agent. |

## Current blockers and work order

1. P0: CI run `33850245516` failed at Production dependency audit. Reproduce advisory/dependency path; do not assume the old fast-uri finding remains the cause.
2. P0: Compare current branch with remote master `431e4f53df36bcf54f5fdc911175e9e10354f5f3`; selectively restore necessary security/product fixes, not the entire historical WP4 toolchain.
3. P1: Implement first-release server-side exclusions and verify both retained business journeys.
4. P2: Complete actual Sandbox payment/refund/reconciliation for product and fixed SaaS purposes through approved secure tasks only.
5. P3: Verify minimum delivery, recovery, observability and operating responsibility, then audit the exact release candidate.

## Verification and publication

- Working tree was clean before this checkpoint was added.
- `vercel.json` sets Git deployment for master to false. This is configuration evidence only; live provider configuration remains to be verified before publishing.
- Existing CI already contains lint, typecheck, strict-index, tests and controlled build. Do not lower these gates.
- Initial bounded registry queries timed out, but the original audit completed: browserslist and fast-uri were High. Targeted lockfile update moved browserslist 4.28.5 to 4.28.8 and fast-uri 3.1.5 to 3.1.7, plus Browserslist's required dependency data. Post-update `npm audit --omit=dev --audit-level=high` passed with zero vulnerabilities.
- Dependency sync reported a lockfile access error; both installed target versions were independently confirmed to match the lockfile. This is not a claim that the installation command succeeded; clean CI installation remains required.
- Targeted baseline: `stream-quota.test.ts`, `payment-providers/payuni.test.ts`, `platform-referral-commission.test.ts`: 3 files / 49 tests passed on the inspected branch. This proves only the existing local cases, not the new first-release exclusions or external reconciliation.
- The same 49 tests passed after the dependency update. Typecheck and strict-index passed; lint is still running at this checkpoint. Changed-file secret scan passed (not a full repository scan).
- No external resource, payment, refund, database, deployment or alias mutation has been executed in this checkpoint.

## Release decision

`MVP_RELEASE_CANDIDATE_READY=false`

`PAYMENT_RECONCILIATION_READY=false`

`SANDBOX_READY=false`

`PRODUCTION_READY=false`

`releaseDecision=NO_GO`

Post-launch: usage billing, affiliate/team commission activation, non-core integrations, exhaustive governance receipts. Deferral does not permit unsafe residual endpoints or conceal existing financial obligations.
