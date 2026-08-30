# QUAL-01 COV-13 team-template page cohort

## Scope

- Work package: `COV-13`
- Purpose: deterministic server-render attribution for team template listing and creation pages.
- Production source changes: none.
- Test-only additions:
  - `src/app/(app)/team-templates/page.test.tsx`
  - `src/app/(app)/team-templates/new/page.test.tsx`
- Existing dirty production files remained untouched.

## Verification

| Check | Result |
|---|---:|
| Targeted Vitest | 4/4 passed |
| Full Vitest | 146 files / 1,160 tests passed |
| Node TAP contracts | 499/499 passed |
| Lint | 0 errors / 2 existing warnings |
| Typecheck | passed |
| `git diff --check` | passed |

## Coverage attribution

Baseline was the post-COV-12 combined report. No threshold, exclude, inventory, skip, or assertion relaxation was changed.

| Metric | COV-12 baseline | COV-13 result | Existing gate |
|---|---:|---:|---:|
| Global statements | 36.73% | 36.84% | 63% |
| Global branches | 42.30% | 42.36% | 57% |
| Global functions | 43.30% | 43.64% | 60% |
| Global lines | 54.29% | 54.44% | 65% |

Attribution evidence after the combined run:

- `src/app/(app)/team-templates/page.tsx`: statements 18/18, branches 7/10, functions 9/9, lines 15/15.
- `src/app/(app)/team-templates/new/page.tsx`: statements 9/9, branches 2/2, functions 5/5, lines 7/7.

## Classification and next action

The global coverage gate remains below the existing thresholds. Classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`.

E2E was not run. This is a coverage attribution result, not schema drift. Continue with the next test-only source-inventory cohort; do not lower thresholds or change inventory.
