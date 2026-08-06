# QUAL-01 COV-18 interaction-scripts page-render cohort

## Scope

本包只新增 deterministic Vitest page tests，未修改 production source、schema、migration、package、lockfile、coverage inventory 或 threshold。

- `src/app/(app)/interaction-scripts/page.test.tsx`
- `src/app/(app)/interaction-scripts/new/page.test.tsx`
- `src/app/(app)/interaction-scripts/[id]/edit/page.test.tsx`

測試只 mock vendor auth、CSRF、Prisma query boundary、server actions、Next image/link 與純 render boundary；未呼叫 server、Docker、Prisma runtime、Playwright、PayUni 或外部服務，亦未讀取 dotenv、憑證或正式資料。

## Verification

| Check | Result |
| --- | --- |
| Targeted Vitest | 6/6 passed |
| Full Vitest | 156 files / 1,181 tests passed |
| Node TAP contracts | 499/499 passed |
| Typecheck | passed |
| Lint | 0 errors; 2 pre-existing warnings |
| `git diff --check` | pending final checkpoint |

## Attribution

Coverage attribution after the combined run:

| Source | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `src/app/(app)/interaction-scripts/page.tsx` | 14/14 (100%) | 17/20 (85%) | 5/5 (100%) | 14/14 (100%) |
| `src/app/(app)/interaction-scripts/new/page.tsx` | 4/4 (100%) | 0/0 (100%) | 1/1 (100%) | 4/4 (100%) |
| `src/app/(app)/interaction-scripts/[id]/edit/page.tsx` | 8/8 (100%) | 2/2 (100%) | 1/1 (100%) | 7/7 (100%) |

Combined global coverage remains below the unchanged gate:

- statements: 37.27% (9685/25981) < 63%
- branches: 42.89% (9009/21001) < 57%
- functions: 44.44% (1795/4039) < 60%
- lines: 55.10% (8499/15424) < 65%

Classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`.

E2E smoke was not run because the global coverage gate did not pass.

## Rollback

回滾只移除本包新增的三個 test files 與本證據檔；不使用 reset、clean、stash、checkout 或 restore，也不觸碰既有 dirty files。
