# WP-128 Public partner unavailable-state accessibility/RWD

## Result

- Sol scope selected one LOCAL public `/p/[slug]` unavailable-state recovery slice.
- `PublicPageState` now exposes an accessible `返回首頁` recovery link for the six known unavailable states; existing dirty files remain untouched.
- Deterministic component tests: 11/11 PASS.
- Scoped ESLint: PASS. TypeScript no-emit, non-incremental: PASS.
- Browser runner: `BLOCKED_OR_FAILED` before the local Next dev server became ready; no browser assertions are counted as passed.
- The marker-owned loopback disposable schema was cleaned successfully; no external request, production operation, or generated artifact write occurred.

## Ownership and safety

- Modified tracked paths were clean at preflight and limited to the planned component recovery hunk and its focused unit assertions.
- New browser spec, runner and receipts are WP-owned additive files.
- `tests/e2e/accessibility.spec.ts`, route resolver files, billing, payment, smoke and all other existing dirty paths remain `PRESERVE_ONLY`.
- Staged index remained empty.
- No environment-file contents, credentials, cookies, tokens, PII, raw logs or provider data were saved.

## Acceptance boundary

The unit contract is proven, but the required real-browser desktop/mobile route evidence is not. CAT06 remains `7.0/10`; no score increase or Gate closure is claimed. The server-start failure must be remediated in a separately owned local runner or accepted as an infrastructure boundary before any score review.

## Rollback and stop

Rollback is limited to removing the WP-128-owned runner, spec, receipt and evidence and reverting the small recovery-link hunk with an explicit patch. Do not reset, clean, stash, checkout or modify existing dirty files. Do not rerun the Browser suite until the same server-start boundary has a new owner-approved remediation scope.
