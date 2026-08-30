# WP-170 — Staging DB and PayUni Sandbox read-only reconciliation

## Outcome

- Terminal receipt: `WP170_CLEANUP_EXACT_NO_GO`.
- Freshness: PASS. The custom staging route still resolved to the WP-167
  deployment, target Preview, state Ready, HEAD 200, with no redirect.
- Preview broker attempts: 1; retries: 0.
- DB connection／transaction／application SELECT: `0/0/0`.
- PayUni Sandbox query: `0`.
- DB／provider write, payment, refund, callback, deployment, DNS／environment
  mutation and Production operation: all `0`.
- CAT04 remains `6.0`; total remains `71.5`.

The sanitized terminal receipt is immutable and was not rewritten after the
attempt.

## Root cause

The Vercel Preview broker itself reached the child-command launch boundary, but
the child produced no structured result. A no-external-side-effect local
diagnostic reproduced two Windows OS-temp startup-contract defects:

1. Node's `--import` requires a `file:` URL rather than a bare Windows absolute
   path.
2. Once the loader could start, the OS-temp cwd could not resolve the project's
   `@/` aliases without an explicit project `tsconfig.json`.

The runner was corrected after the consumed external attempt to invoke the
absolute TSX CLI with an absolute project tsconfig. A local child diagnostic from
the same OS-temp cwd then produced exactly one sanitized child result and stopped
before DB access because no broker bindings were supplied. This proves the
startup-chain remediation only; it is not external DB or PayUni evidence.

The external broker was not rerun.

## Cleanup recovery

The terminal runner could not immediately remove its marker-owned Windows temp
directory. A read-only preflight verified the exact path was a direct child of
the canonical OS temp root and matched `celebratedeal-wp170-*`. The exact
directory was then removed; a subsequent check confirmed it no longer exists.

## Deterministic evidence

- Runner self-tests: PASS, 9/9.
- Windows TSX CLI plus absolute tsconfig regression: PASS.
- Scoped local ESLint: PASS.
- TypeScript no-emit: PASS.
- Static environment-enumeration／env-spread／env-file-read／Production-endpoint／
  SQL-mutation deny gate: PASS.
- `git diff --check`: PASS.
- Staged index: empty.
- Marker-owned temp cleanup recovery: PASS.

One local diagnostic command was launched from the OS-temp cwd with relative
test／lint paths. Those paths failed to resolve, and `npx` attempted an ESLint
package resolution before failing because the temp directory had no
`package.json`. This may have caused an npm registry read or local npm-cache
write. It did not modify the workspace, package manifest or lockfile, and its
output is not counted as test evidence. All canonical checks were subsequently
rerun from the workspace with the already-installed local toolchain.

## Acceptance boundary

WP-170 truthfully proves current staging freshness and the corrected local
OS-temp child startup contract. It does not prove staging DB identity, a unique
synthetic pending reservation, or a PayUni Sandbox reconciliation result.
No score, Sandbox readiness label, Production readiness label, or launch gate may
change from this work package.

## AGY Fast QA

Both allowed AGY Fast attempts ended in the local wrapper's empty-line
parameter-binding failure before any QA output was produced. The terminal QA
status is `TOOL_BLOCKED`; it is not treated as a pass and does not replace the
deterministic evidence.

## Sol High acceptance

- Verdict: `ACCEPT — TERMINAL_FAIL_CLOSED／ROOT_CAUSE_REMEDIATED_NOT_EXTERNALLY_REVERIFIED`.
- Accepted: staging freshness, safe one-attempt failure containment, exact temp
  cleanup recovery, and the deterministic child-startup remediation.
- Not accepted: Preview broker re-verification after the fix, staging DB
  identity, a unique pending candidate, or PayUni Sandbox reconciliation.
- CAT04 remains `6.0`; total readiness remains `71.5`.
- The next package must use new WP-171 artifacts and one new bounded attempt;
  WP-170's receipt remains immutable.
- Acceptance addendum: `NPM_REGISTRY_OR_CACHE_SIDE_EFFECT_POSSIBLE` is disclosed;
  Sol confirmed the verdict remains `ACCEPT`. No claim is made that every
  non-product external side effect was zero.
