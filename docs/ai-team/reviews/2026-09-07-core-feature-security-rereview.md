# Core Feature Security Re-review — 2026-09-07

## Result

**PASS** — the five blocking findings from the 2026-09-06 review are closed in the current working tree.

## Closed blockers

1. Production ECPay configuration fails closed when credentials are incomplete and cannot fall back to sandbox credentials.
2. ECPay `MerchantTradeNo` is a deterministic 20-character provider reference. The signed `CustomField2` contains the complete internal transaction ID and order number and is normalized before accepting callback identity.
3. ECPay reconciliation performs a signed `QueryTradeInfo/V5` POST, verifies the response `CheckMacValue`, binds merchant/trade/amount identity, and maps only supported payment state.
4. Purchased-only lucky draws bind the server-owned verified form submission to a paid commerce order containing a product from the same live. The same eligibility is revalidated at draw time.
5. Winner claim codes use OS CSPRNG, persist a server-peppered HMAC in the specified `LiveInteractionResponse.claimTokenHash`, use an encrypted winner-only envelope, tenant-scoped verification, and compare-and-set redemption with replay rejection.

During re-review, the reviewer found that combining purchased eligibility with previous-winner exclusion reset the candidate list. The implementation now composes both filters, with a regression test covering the combination.

## Verification evidence

- `npm run test:interactions`: PASS — 11 files, 206 tests.
- `npm run test:contracts`: PASS — 919 tests.
- `npm run typecheck:strict-index`: PASS.
- `npm run typecheck`: PASS.
- `npm run secret:scan`: PASS (`secret_scan_passed`).
- Targeted ESLint reported two existing baseline violations in `live-advanced-interactions.tsx` (function complexity and an unchanged effect state update); neither is introduced by this patch or part of the five security blockers.
- Independent ai-team reviewer verdict after the combination fix: **PASS**.

No Production deployment, payment, refund, database write, or external customer operation was performed.
