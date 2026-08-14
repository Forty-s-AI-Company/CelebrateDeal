# G7-09A Merchant onboarding product closure

- Evidence time: `2026-08-08T14:04:10Z`
- Workspace HEAD: `1a8a4bb3acad8aabef30a7d9fbe4dc1488d6a758`
- Mode: `PRELAUNCH_DEV_AUTONOMOUS`, local controlled evidence only
- Verdict: `LOCAL_PRODUCT_CLOSURE_PASS`
- Production/staging/provider/Browser operations: `0`

## Product closure

1. Added authenticated manager route `/onboarding`. Progress is reconstructed from tenant-scoped persisted facts after every refresh; no browser-only draft can falsely complete it.
2. The five core steps cover support contact, verified vendor-level payment method, active fulfillment-confirmed product, active form/interaction role/published script/registration Email, and a genuinely sellable live. Tracking remains optional and non-blocking.
3. Dashboard onboarding is no longer hard-coded incomplete. The checklist links to the executable `/onboarding` flow, and the app shell exposes a manager-only launch-guide entry.
4. Payment readiness accepts only a current `VENDOR` scope reference with no member binding. Member-scoped or expired references cannot complete merchant onboarding.
5. A reviewer-confirmed P1 in the first implementation was fixed. Sellable-live readiness now requires resources on the same vendor and same live: active form, active registration-confirmation Email template, published interaction script, and at least one active fulfillment-confirmed product.
6. Readiness and the public buyer page share the exact visibility boundary: `scheduled`/`live`, or `ended` only when replay is enabled. An ended non-replay live cannot complete onboarding.
7. Candidate forms are parsed with the production registration schema, and Email subject/body are checked for non-empty content and supported variables. Invalid legacy JSON or an undeliverable template fails closed instead of displaying `100%`.
8. The page states explicitly that product-data completion does not replace legal, finance, support SLA, external monitoring or release-owner signatures.

## Deterministic verification

- Final targeted Vitest command covered the onboarding domain/page, sellable-live contract, dashboard/checklist, app shell, public policy page and public live page: `8 files / 42 tests PASS`, exit `0`.
- Scoped ESLint over the G7-09A and shared public-live source/test scope: `PASS`, exit `0`.
- `npx tsc --noEmit`: `PASS`, exit `0`.
- `git diff --check` on all manifest source paths: `PASS`; only Git LF/CRLF notices were emitted.
- Staged paths: `0`.
- No Prisma schema or migration changed, so disposable PostgreSQL was not required for this read-only readiness projection.

## Current-source production build

- The physical dependency mirror contained `0` `.env*` files.
- The first controlled attempt incorrectly iterated the JSON envelope instead of its `environment` node. Repository preflight rejected all missing values and exited `1`; this operator/config-loader failure is preserved as non-PASS and is not a product failure.
- A different corrected command loaded only the repository-controlled synthetic `environment` node, kept telemetry/source-map upload disabled, and made no provider or database request.
- Final build: Next.js `16.2.11` Turbopack compile, TypeScript, page collection and `99/99` static pages `PASS`, exit `0`; `/onboarding` is present as a dynamic authenticated route.

## Review and residual evidence

- Initial read-only reviewer found no P0 and one P1: the first sellable-live count could combine unrelated globally valid resources while the selected live referenced disabled resources.
- After remediation, the same reviewer found no P0/P1 and confirmed Prisma relation-filter semantics, tenant binding, buyer visibility/replay parity, and invalid form/template fail-closed behavior.
- Non-blocking residual: dashboard page test checks only a subset of the shared query on its third `findMany` call; the complete predicate is covered by `sellable-live.test.ts` and the onboarding page test. Both pages call the same helper.
- Chrome/Bombmy was not retried because the existing binding path remains terminal `TOOL_BLOCKED_NOT_RUN`. No visual competitor or staging claim is made.

## Score, blockers and rollback

- Merchant onboarding local functional candidate: `8.0/10`, eligible for the Goal's per-function `>=7` inventory threshold.
- Canonical CAT01-CAT10 total remains `73.5`; this WP has `canonical_delta=0`. CAT10 remains `4.5` until the required human legal/finance/support/release signatures and external monitoring evidence exist.
- No manual action is needed for this local product closure. Human CAT10 items remain explicitly deferred and do not block further product work.
- Rollback is limited to the source paths in the manifest and this evidence set. There is no migration, database-data or external-service rollback.
- Next highest-value work: G7-09B executable merchant support/refund handoff. The current static `/support` readiness draft is not a case intake or merchant operations queue.

## Integrity

- Source manifest: `docs/ai-team/evidence/g7-09a-merchant-onboarding-source-manifest-20260808.txt`
- Source manifest SHA-256: `221380ff33099d113f674bc7580f785148eb044e31c524dbeb417d552ea5351f`
- Source manifest verification: `13 paths`, mismatch count `0`.
- No commit, push, merge or deployment was performed.
