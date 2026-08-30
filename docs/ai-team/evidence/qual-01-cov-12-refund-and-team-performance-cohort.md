# QUAL-01 COV-12 refund and team-performance page cohort

## Scope

- Work package: `COV-12`
- Purpose: deterministic server-render attribution for refund reconciliation and team performance pages.
- Production source changes: none.
- Test-only additions:
  - `src/app/admin/billing/refund-reconciliation/[id]/page.test.tsx`
  - `src/app/(app)/team-performance/page.test.tsx`
- Existing dirty production files remained untouched.

## Verification

| Check | Result |
|---|---:|
| Targeted Vitest | 5/5 passed |
| Full Vitest | 144 files / 1,156 tests passed |
| Node TAP contracts | 499/499 passed |
| Lint | 0 errors / 2 existing warnings |
| Typecheck | passed |
| `git diff --check` | passed |

## Coverage attribution

Baseline was the post-COV-11 combined report. No threshold, exclude, inventory, skip, or assertion relaxation was changed.

| Metric | COV-11 baseline | COV-12 result | Existing gate |
|---|---:|---:|---:|
| Global statements | 36.63% | 36.73% | 63% |
| Global branches | 42.16% | 42.30% | 57% |
| Global functions | 43.12% | 43.30% | 60% |
| Global lines | 54.15% | 54.29% | 65% |

Attribution evidence after the combined run:

- `src/app/admin/billing/refund-reconciliation/[id]/page.tsx`: statements 12/34, branches 17/39, functions 3/4, lines 10/32.
- `src/app/(app)/team-performance/page.tsx`: statements 14/20, branches 12/20, functions 4/7, lines 12/16.

## Classification and next action

The global coverage gate remains below the existing thresholds. Classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`.

E2E was not run. This is a coverage attribution result, not schema drift. Continue with the next test-only source-inventory cohort; do not lower thresholds or change inventory.
