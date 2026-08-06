# QUAL-01 COV-15 affiliate form page cohort

## Scope

- Work package: `COV-15`
- Purpose: deterministic server-render attribution for affiliate creation and edit pages.
- Production source changes: none.
- Test-only additions:
  - `src/app/(app)/affiliates/new/page.test.tsx`
  - `src/app/(app)/affiliates/[id]/edit/page.test.tsx`
- Existing dirty production files remained untouched.

## Verification

| Check | Result |
|---|---:|
| Targeted Vitest | 3/3 passed |
| Full Vitest | 150 files / 1,167 tests passed |
| Node TAP contracts | 499/499 passed |
| Lint | 0 errors / 2 existing warnings |
| Typecheck | passed |
| `git diff --check` | passed |

## Coverage attribution

Baseline was the post-COV-14 combined report. No threshold, exclude, inventory, skip, or assertion relaxation was changed.

| Metric | COV-14 baseline | COV-15 result | Existing gate |
|---|---:|---:|---:|
| Global statements | 36.93% | 36.97% | 63% |
| Global branches | 42.47% | 42.47% | 57% |
| Global functions | 43.87% | 43.94% | 60% |
| Global lines | 54.58% | 54.63% | 65% |

Attribution evidence after the combined run:

- `src/app/(app)/affiliates/[id]/edit/page.tsx`: statements 7/7, branches 3/4, functions 2/2, lines 6/6.
- `src/app/(app)/affiliates/new/page.tsx`: statements 2/2, branches 0/0, functions 1/1, lines 2/2.

## Classification and next action

The global coverage gate remains below the existing thresholds. Classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`.

E2E was not run. This is a coverage attribution result, not schema drift. Continue with the next test-only source-inventory cohort; do not lower thresholds or change inventory.
