# WP-130 Cloudflare Stream webhook dirty-batch contract

## Result

WP-130 deterministic validation is `BLOCKED_OR_FAILED`, not a product PASS. The
existing route and import chain stayed read-only; only the new WP-130 contract
artifacts were created.

The contract suite ran 9 tests: 8 passed and 1 failed. The failing assertion is
the required duplicate `ready` delivery invariant: after the first signed
`readyToStream=true` event, the same event returned `updated: 1` again and
invoked the persistence claim a second time. This is a real idempotency gap,
not a test harness or ownership failure.

Other deterministic cases passed: route export/factory shape, missing and
invalid signature rejection, valid signed transition, malformed JSON and
missing-field rejection, unsupported state, ambiguous UID, stale replay
non-regression, contention response, and response redaction.

## Evidence and safety

- `.ai-team/reports/wp130-cloudflare-stream-webhook-contract-receipt.json`
  records sanitized command summaries only.
- `.ai-team/reports/wp130-agy-fast-qa.json` records AGY Fast attempt 1 as
  `OK`; its read-only verdict confirms the duplicate-ready gap and does not
  replace deterministic tests.
- Source/import SHA-256 digests were unchanged before and after.
- Existing 272 `PRESERVE_ONLY` dirty entries were unchanged; staged index was
  empty.
- No raw payload, signature, secret, cookie, token, environment-file content,
  source snippet or raw tool output was persisted.
- No network, database, provider, deployment or Production operation occurred.

## Acceptance boundary

CAT01 remains `7.0/10` and total remains `70.5/100`. The evidence is scoped to
one Cloudflare Stream webhook slice and cannot be extrapolated to all core
flows. Sol High must decide whether this package should remain open for an
authorized remediation or be recorded as `PLAN_REMEDIATION`; no score change
is allowed from this receipt.

## Remediation boundary and rollback

The exact gap is bounded to the existing dirty status-transition source
(`src/lib/cloudflare-video-status.ts`, with convergence behavior in
`src/lib/cloudflare-video-transition.ts`). Both are `PRESERVE_ONLY` for this
WP; no modification was authorized. Rollback for this WP removes only the
manifest, runner, test, receipt and this evidence file. No data rollback is
needed.

## Stop conditions reached

- Required duplicate idempotency invariant failed.
- Existing production source would need modification to remediate.
- Deterministic evidence is therefore fail-closed and score-neutral.
