# QUAL-01 COV-10 finance page render cohort

## Scope

- Work package: `COV-10`
- Purpose: deterministic server-render attribution for the merchant settlement page and finance-admin payout page.
- Production source changes: none.
- Test-only additions:
  - `src/app/(app)/billing/settlements/page.test.tsx`
  - `src/app/admin/billing/payouts/page.test.tsx`
- Existing dirty production files remained untouched.

## Verification

| Check | Result |
|---|---:|
| Targeted Vitest | 4/4 passed |
| Full Vitest | 140 files / 1,147 tests passed |
| Node TAP contracts | 499/499 passed |
| Targeted ESLint | 0 errors |
| Typecheck | passed |
| `git diff --check` | passed |

## Coverage attribution

Baseline was the post-COV-09 combined report. No threshold, exclude, inventory, skip, or assertion relaxation was changed.

| Metric | COV-09 baseline | COV-10 result | Existing gate |
|---|---:|---:|---:|
| Global statements | 36.45% | 36.53% | 63% |
| Global branches | 41.82% | 42.00% | 57% |
| Global functions | 42.68% | 42.88% | 60% |
| Global lines | 53.89% | 54.00% | 65% |

Attribution evidence after the combined run:

- `src/app/(app)/billing/settlements/page.tsx`: statements 8/13, branches 11/20, functions 4/4, lines 7/10.
- `src/app/admin/billing/payouts/page.tsx`: statements 12/14, branches 26/30, functions 4/4, lines 11/11.

The combined report also preserves existing attribution for related pages; no inventory was reduced to obtain the uplift.

## Classification and next action

The global coverage gate remains below the existing thresholds. Classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`.

E2E was not run. This is a coverage attribution result, not schema drift. Continue with the next test-only source-inventory cohort after acceptance; do not lower thresholds or change inventory.
