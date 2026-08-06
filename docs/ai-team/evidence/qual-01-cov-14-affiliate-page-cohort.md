# QUAL-01 COV-14 affiliate page cohort

## Scope

- Work package: `COV-14`
- Purpose: deterministic server-render attribution for vendor affiliate list and detail pages.
- Production source changes: none.
- Test-only additions:
  - `src/app/(app)/affiliates/page.test.tsx`
  - `src/app/(app)/affiliates/[id]/page.test.tsx`
- Existing dirty production files remained untouched.
- No AffiliatePayout create/upsert behavior was invented or invoked.

## Verification

| Check | Result |
|---|---:|
| Targeted Vitest | 4/4 passed |
| Full Vitest | 148 files / 1,164 tests passed |
| Node TAP contracts | 499/499 passed |
| Lint | 0 errors / 2 existing warnings |
| Typecheck | passed |
| `git diff --check` | passed |

## Coverage attribution

Baseline was the post-COV-13 combined report. No threshold, exclude, inventory, skip, or assertion relaxation was changed.

| Metric | COV-13 baseline | COV-14 result | Existing gate |
|---|---:|---:|---:|
| Global statements | 36.84% | 36.93% | 63% |
| Global branches | 42.36% | 42.47% | 57% |
| Global functions | 43.64% | 43.87% | 60% |
| Global lines | 54.44% | 54.58% | 65% |

Attribution evidence after the combined run:

- `src/app/(app)/affiliates/page.tsx`: statements 11/11, branches 11/12, functions 4/4, lines 11/11.
- `src/app/(app)/affiliates/[id]/page.tsx`: statements 14/14, branches 12/20, functions 5/5, lines 11/11.

## Classification and next action

The global coverage gate remains below the existing thresholds. Classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`.

E2E was not run. This is a coverage attribution result, not schema drift. Continue with the next test-only source-inventory cohort; do not lower thresholds or change inventory.
