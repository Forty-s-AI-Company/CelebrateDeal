# QUAL-01 COV-16 team-template claim cohort

## Scope

- Work package: `COV-16`
- Purpose: deterministic server-render attribution for the shared team-template claim page.
- Production source changes: none.
- Test-only addition:
  - `src/app/team-template/page.test.tsx`
- Existing dirty production files remained untouched.

## Verification

| Check | Result |
|---|---:|
| Targeted Vitest | 3/3 passed |
| Full Vitest | 151 files / 1,170 tests passed |
| Node TAP contracts | 499/499 passed |
| Lint | 0 errors / 2 existing warnings |
| Typecheck | passed |
| `git diff --check` | passed |

## Coverage attribution

Baseline was the post-COV-15 combined report. No threshold, exclude, inventory, skip, or assertion relaxation was changed.

| Metric | COV-15 baseline | COV-16 result | Existing gate |
|---|---:|---:|---:|
| Global statements | 36.97% | 37.08% | 63% |
| Global branches | 42.47% | 42.65% | 57% |
| Global functions | 43.94% | 44.04% | 60% |
| Global lines | 54.63% | 54.81% | 65% |

Attribution evidence after the combined run:

- `src/app/team-template/page.tsx`: statements 30/45, branches 36/54, functions 4/4, lines 28/31.
- Covered states: missing share, unknown share setting, and member-scoped valid share.
- Direct-downline relationship and claim action side effects were not invoked.

## Classification and next action

The global coverage gate remains below the existing thresholds. Classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`.

E2E was not run. This is a coverage attribution result, not schema drift. Continue with the next test-only source-inventory cohort; do not lower thresholds or change inventory.
