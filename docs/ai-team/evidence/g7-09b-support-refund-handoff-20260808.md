# G7-09B Support case and refund handoff checkpoint

- Evidence time: `2026-08-08T14:39:31Z`
- Workspace HEAD: `1a8a4bb3acad8aabef30a7d9fbe4dc1488d6a758`
- Mode: `PRELAUNCH_DEV_AUTONOMOUS`, local/loopback/disposable evidence only
- Verdict: `LOCAL_MERCHANT_SUPPORT_HANDOFF_PASS`
- Production/staging/provider/Email/Browser operations: `0`

## Product work completed

1. Added tenant-scoped `SupportCase`, append-only `SupportCaseEvent`, and `SupportRefundHandoff` projections tied to canonical `CommerceOrder`, `PaymentTransaction`, and `CommerceOrderRefund` records.
2. Added manager-MFA merchant case creation, queue, assignment, internal notes, lifecycle transitions and refund handoff. Case summaries, notes and refund reasons use purpose-bound AES-GCM envelopes; list views expose only masked buyer/order metadata.
3. Added finance-admin handoff queue and review detail. Merchant actions never call a payment provider. A handoff can become `completed` only after finance selects a same-vendor, same-order, same-amount, `processed` canonical refund.
4. Added optimistic revision claims, UUID request/dedup keys, unique event constraints, immutable refund commercial identity, adjacent lifecycle rules and exact tenant composite foreign keys.
5. Added pending/disabled feedback through the shared form submit control, success/error notices, accessible loading route, bounded filters and explicit messaging that handoff is not a provider refund.
6. Added manager and platform navigation entries and integrated support cases into canonical order detail/read model.
7. Public `/support` remains a policy/contact entrypoint. This WP intentionally did not add an unsafe order-number lookup. A buyer-authenticated or capability-token intake/reply journey remains a separate residual.

## Deterministic verification

- Final targeted Vitest: `8 files / 27 tests PASS`, skipped `0`, exit `0`.
- Scoped ESLint over domain, actions, merchant/admin pages, order detail/read model and navigation: `PASS`, exit `0`.
- `npx tsc --noEmit`: `PASS`, exit `0`.
- `npx prisma validate`: `PASS`, exit `0`.
- `git diff --check` on all 21 source-manifest paths: `PASS`; only Git LF/CRLF notices were emitted.
- Staged paths: `0`.

## Disposable PostgreSQL evidence

- Receipt: `.ai-team/reports/g7-09b-support-disposable-20260808.json`.
- Receipt SHA-256: `5352ab7d86d4e8fe101721dea9b37e6cbd362a67b9bd3615202d1dd868db63a2`.
- PostgreSQL `16-alpine`, loopback-only random port, tmpfs data directory, synthetic fixtures, unique marker/schema and no source env-file read.
- All `39` canonical migrations deployed and `prisma migrate status` passed.
- Ten assertions passed: cross-tenant order/member rejection, one-winner revision CAS, event dedup, immutable handoff identity, primary-payment match, remaining balance at intake, pending/wrong-amount refund rejection, and exact processed refund completion after the order refund projection had already advanced.
- Cleanup verified container absent and temporary root absent: both `PASS`.
- An earlier run reached migrations but failed the synthetic constraint fixture because its test identity hash violated an existing 43-character invariant. That was a fixture failure, not a product PASS; it was corrected before the final receipt.
- A later attempt stopped before migration validation at the database-marker write because the ephemeral server was not fully ready. It cleaned up successfully. The harness now uses a bounded readiness retry; no assertion was weakened.

## Controlled current-source build

- Physical dependency mirror: `C:/Users/eden/AppData/Local/Temp/celebratedeal-g707-physical-1786194458574-63925`.
- The mirror contained `0` `.env*` files before sync.
- Only repository-controlled synthetic values from `config/build-env.controlled.json` → `environment` were loaded into the build process. No values are included in this evidence.
- Next.js `16.2.11` Turbopack compile, TypeScript, page collection and static generation `101/101 PASS`, exit `0`.
- `/support-cases`, `/support-cases/[id]`, `/admin/support-cases`, and `/admin/support-cases/[id]` are present as dynamic routes.
- Optional external monitoring/Cloudflare/Email smoke configuration warnings remained warnings; no upload, provider request, deployment or external smoke test was performed.

## Review and remediation

- Initial independent reviewer found no P0 and one P1: completion rechecked the remaining refundable amount after the canonical order had already included the refund, which could reject a legitimate full refund.
- Remediation limits remaining-balance validation to handoff insertion, freezes the commercial identity on update, and uses the exact processed refund ledger row for completion.
- Disposable QA now advances `CommerceOrder.refundedAmountCents` before completing the handoff, reproducing the real projection order.
- Final reviewer confirmed the P1 closed and found no new P0/P1 in tenant isolation, auth/MFA, PII, lifecycle, database trigger, provider boundary or fail-closed UI behavior.

## Score, residuals and rollback

- Merchant support operations/refund-handoff slice local candidate: `8.0/10`.
- Fixed inventory item `退款／客服` remains conservatively below closure at `6.8/10` because public buyer intake/reply with safe ownership proof and a least-privilege support role are not implemented. This evidence does not claim those capabilities.
- Canonical CAT01-CAT10 total remains `73.5`; `canonical_delta=0`. CAT10 remains `4.5` until human support-SLA owner, legal/finance/release signatures and external monitoring evidence exist.
- No manual action is required for this local merchant/finance handoff slice. Human CAT10 items remain deferred.
- Rollback is limited to the 21 source-manifest paths and this evidence set. The migration has not been applied to production; no production database, payment, refund, Email, deployment or external data rollback exists.
- Next highest-value work: `G7-09C`, a safe buyer support intake/reply capability linked to an order without order-number-only lookup, plus a least-privilege merchant support role and SLA timestamps/escalation UI.

## Integrity

- Source manifest: `docs/ai-team/evidence/g7-09b-support-refund-handoff-source-manifest-20260808.txt`.
- Source manifest SHA-256: `be3b6de581cd0303408b2cbf1cd6167e54cf32c6e17fe0ae9d378bf9caef08d6`.
- Source manifest verification: `21 paths`, mismatch count `0`.
- No commit, push, merge or deployment was performed.
