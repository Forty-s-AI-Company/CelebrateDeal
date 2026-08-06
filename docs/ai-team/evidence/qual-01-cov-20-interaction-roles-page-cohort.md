# QUAL-01 COV-20 interaction-roles page-render cohort

## Scope

本包只新增 deterministic Vitest page tests，未修改 production source、schema、migration、package、lockfile、coverage inventory 或 threshold。

- `src/app/(app)/interaction-roles/page.test.tsx`
- `src/app/(app)/interaction-roles/new/page.test.tsx`
- `src/app/(app)/interaction-roles/[id]/edit/page.test.tsx`

測試只 mock vendor auth、CSRF、Prisma query boundary、action 與純 workbench/page-header render boundary；未呼叫 server、Docker、Prisma runtime、Playwright、PayUni 或外部服務，亦未讀取 dotenv、憑證或正式資料。

## Verification

| Check | Result |
| --- | --- |
| Targeted Vitest | 6/6 passed |
| Full Vitest | 164 files / 1,197 tests passed |
| Node TAP contracts | 499/499 passed |
| Typecheck | passed |
| Lint | 0 errors; 2 pre-existing warnings |
| `git diff --check` | passed |

## Attribution

| Source | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `src/app/(app)/interaction-roles/page.tsx` | 3/3 (100%) | 0/0 (100%) | 1/1 (100%) | 3/3 (100%) |
| `src/app/(app)/interaction-roles/new/page.tsx` | 3/3 (100%) | 0/0 (100%) | 1/1 (100%) | 3/3 (100%) |
| `src/app/(app)/interaction-roles/[id]/edit/page.tsx` | 6/6 (100%) | 2/2 (100%) | 1/1 (100%) | 5/5 (100%) |

Combined global coverage remains below the unchanged gate:

- statements: 37.41% (9720/25981) < 63%
- branches: 42.99% (9030/21001) < 57%
- functions: 44.68% (1805/4039) < 60%
- lines: 55.30% (8531/15424) < 65%

Classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`.

E2E smoke was not run because the global coverage gate did not pass.

## Rollback

回滾只移除本包新增的三個 test files 與本證據檔；不使用 reset、clean、stash、checkout 或 restore，也不觸碰既有 dirty files。
