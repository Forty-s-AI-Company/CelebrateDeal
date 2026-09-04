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
| Merchant invitation, login, MFA | PARTIAL | Local auth, MFA and MFA enrollment tests passed; merchant invitation and current browser journey remain unverified. |
| Product/live creation, registration and viewing | NOT_PROVEN | Existing E2E inventory is not an execution result. |
| Buyer checkout, callback and delivery | NOT_PROVEN | Verify current branch implementation, not another worktree's run. |
| Refund, reconciliation, merchant settlement | NOT_PROVEN | Diagnose existing Sandbox transaction outcome before any repeat refund. |
| Fixed SaaS plan payment and entitlement | NOT_PROVEN | Verify successful/failed/duplicate payment, refund and expiry. |
| Disabled usage billing and commission accrual | PARTIAL | New commission webhook accrual is guarded; default-policy refund delegation and notices pass local tests. Creation/configuration entrypoints and complete DB regression remain pending. Usage billing changes remain under accounting review. |
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
- The same 49 tests passed after the dependency update. Typecheck, strict-index and full lint passed. Changed-file secret scan passed (not a full repository scan).
- Dependency checkpoint `ee9bf92b50d28935267cf7fc5d509cff50301be7` pushed to the approved branch; CI `33852970523` completed with failure at Production dependency audit. Check annotation only reports exit 1, so its cause is not yet proven. A fresh local audit is running; the earlier local zero-vulnerability result does not supersede this CI failure.
- Current branch PayUni query adapter lacked local provider-trade and gross-amount comparison after signature verification. Local commit `ea5f0a3` adds both checks and bounded admission retry backoff. The two suites passed 59 tests; independent read-only review found no blocking query-binding issue. External reconciliation remains pending.
- Current working-tree verification: five scoped suites passed 64 tests covering query binding, admission backoff, default commission policy, mocked webhook transitions and billing notices. Typecheck, strict-index and full lint passed. These are local tests, not remote CI or provider evidence.
- Local checkpoint `8558d86` disables new commission webhook accrual and adds launch notices without removing historical financial pages. The final three policy/webhook/notice suites passed 6 tests, including existing refund delegation; these mocked tests do not replace DB integration. Separately auth, MFA, MFA enrollment and commerce-order unit suites passed 63 tests.
- Accounting review identified duplicate fixed-plan monthly charging and possible platform-payment inclusion in merchant settlement. Both remain core blockers under diagnosis. Terminal invoice regeneration now avoids invoice writes for paid, partially-refunded and refunded states; targeted agent verification passed, integration with the remaining accounting changes is pending.
- The current uncommitted accounting patch excludes platform subscription/invoice collections and their refunds from merchant settlement. Main-agent billing, billing-cycle and usage-policy suites passed 39 tests. Independent review and the fixed-plan double-charge correction are still pending.
- The fresh bounded local audit failed with an npm audit endpoint network timeout. It produced no valid vulnerability result. Remote CI's annotation reports only exit 1; do not infer that the remote failure has the same cause.
- Independent accounting review requires preserving terminal settlement payout snapshots as well as terminal invoices. Fixed-plan credit must match tenant, subscription, plan, currency, amount, paid period and non-refunded state; ambiguous payments must stop billing instead of triggering another charge. These corrections remain in progress.
- Product mutation now rejects new/changed course commission arrangements under the default policy, with a fixed 403 API error. Existing unchanged course settings remain editable for ordinary product fields; new digital delivery remains available. Product action/API/rendered-form suites passed 32 tests, scoped lint and changed-file secret scan passed. This does not prove the whole browser flow.
- Checkpoints through `d7de81e` have been pushed to `codex/one-stop-webinar-flow`; uncommitted billing changes were not included. Affiliate/action suites passed 331 tests, plus existing affiliate edit and live-form suites passed 34 tests. New affiliate creation/rate changes are rejected; ordinary edits omit the rate field entirely. New live affiliate configuration is disabled server-side and in the form; historical settings, quota controls and payout/refund handling remain.
- CI `33855441494` is running for exact SHA `d7de81ef1b39d47250eb3766e998442a2bdc0b9c`; no PASS is claimed until the run completes. Billing review found that unresolved checkout attempts and an existing open invoice can still cause double charging; those local corrections are not part of this pushed SHA.
- Before this push, `vercel.json` still disabled master Git deployment and GitHub deployment metadata for the prior remote SHA showed both Vercel projects as Preview with `production_environment=false`. No Production deployment command was executed.
- Registry ping returned HTTP 200, but the two-package advisory API diagnostic remained unavailable. This distinguishes general connectivity from the audit endpoint; it is not an audit PASS.
- Independent curl POST to the same public advisory endpoint timed out after 20 seconds with zero response bytes. No further local retries are planned without new evidence; required CI audit remains enforced.
- The owned read-only Docker image-inspection CLI hung without a result and was explicitly stopped after checking its PID/name/start time. No container/database was created, modified or removed by this diagnostic; local DB-backed verification remains NOT_PROVEN.
- Read-only comparison confirms the chosen branch lacks master WP4 protected ops routes for fixture, payment-attempt, preflight, reconcile, refund and session. Reusing previous Sandbox execution therefore requires selecting the necessary existing implementation and validating it against this branch, not assuming old receipts apply.
- Latest uncommitted billing integration passed 81 tests across billing, billing-cycle, usage policy, invoice checkout and plan-checkout boundary suites; scoped lint passed. Pending/failed plan payments block new monthly collection; trusted fixed-fee credit preserves other invoice fees and refuses edits when invoice payment already exists. Both checkout directions now check the alternative collection path. Final financial review and DB/browser verification are pending; no external payment was executed.
- CI `33855441494` completed with failure at audit. A fixed audit-summary wrapper retains `npm audit --omit=dev --audit-level=high`, fails closed on absent/invalid results, and emits only fixed error categories/counts as annotations. Its five tests passed; no successful audit is implied. The final independent financial reviewer became unavailable due to model capacity, so financial review remains pending rather than PASS.
- Audit-summary commit `9c5003089cfc243f5d5ceaad40d2176c2d78dc0e` was pushed separately. CI `33856503982` is in progress for that SHA. Billing fixes remain local and uncommitted pending final review.
- Final independent financial review subsequently completed: no blocking issue in the scoped billing and dual-checkout changes; reviewer independently ran 80 tests. Main-agent integration ran 81 tests, then expanded plan-action/job coverage: 8 mocks initially lacked the new invoice delegate, were updated without weakening assertions, and all 21 expanded tests passed. Latest typecheck, strict-index, scoped lint, changed-file secret scan and diff check passed. This supersedes the pending-review note, but not the outstanding DB/browser/provider verification.
- Billing checkpoint `e9dfffc` records those reviewed changes. Local Docker service status was observed as stopped; this alone is not a claim about all Docker Desktop components, and DB-backed verification remains incomplete. The full candidate still needs exact remote CI, DB/browser tests, both actual Sandbox payment/refund/reconciliation purposes and the minimum recovery/operating checks.
- No external resource, payment, refund, database, deployment or alias mutation has been executed in this checkpoint.

## Release decision

`MVP_RELEASE_CANDIDATE_READY=false`

`PAYMENT_RECONCILIATION_READY=false`

`SANDBOX_READY=false`

`PRODUCTION_READY=false`

`releaseDecision=NO_GO`

Post-launch: usage billing, affiliate/team commission activation, non-core integrations, exhaustive governance receipts. Deferral does not permit unsafe residual endpoints or conceal existing financial obligations.
