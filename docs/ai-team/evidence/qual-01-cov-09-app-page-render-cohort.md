# QUAL-01 COV-09 app page render cohort

## Scope

- Work package: `COV-09`
- Purpose: deterministic server-render attribution for two existing application pages.
- Production source changes: none.
- Test-only additions:
  - `src/app/(app)/dashboard/page.test.tsx`
  - `src/app/admin/billing/dashboard/page.test.tsx`
- Existing dirty production pages were preserve-only; no existing hunk was rewritten.

## Verification

| Check | Result |
|---|---:|
| Targeted Vitest | 4/4 passed |
| Full Vitest | 138 files / 1,143 tests passed |
| Node TAP contracts | 499/499 passed |
| Targeted ESLint | 0 errors |
| Typecheck | passed |
| `git diff --check` | passed |

## Coverage attribution

Baseline was the post-COV-08 combined report. No threshold, exclude, inventory, skip, or assertion relaxation was changed.

| Metric | COV-08 baseline | COV-09 result | Existing gate |
|---|---:|---:|---:|
| Global statements | 36.25% | 36.45% | 63% |
| Global branches | 41.58% | 41.82% | 57% |
| Global functions | 42.23% | 42.68% | 60% |
| Global lines | 53.58% | 53.89% | 65% |

Attribution evidence:

- `src/app/(app)/dashboard/page.tsx`: statements 20/20, branches 29/38, functions 8/8, lines 20/20.
- `src/app/admin/billing/dashboard/page.tsx`: statements 32/32, branches 21/31, functions 10/10, lines 27/27.

## Classification and next action

The combined coverage gate remains below the existing thresholds. Classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`.

E2E was not run. This is a coverage attribution result, not schema drift. Continue with the next test-only source-inventory cohort after acceptance; do not lower thresholds or change inventory.

## AGY Fast

AGY Fast remains a separate readonly QA evidence source. Any timeout or wrapper failure is recorded as `TOOL_BLOCKED`; deterministic tests above remain authoritative for this cohort.
