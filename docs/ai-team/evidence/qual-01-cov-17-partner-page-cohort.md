# QUAL-01 COV-17 partner-page page-render cohort

## Scope

本包只新增 deterministic Vitest render/query-boundary tests，未修改 production source、schema、migration、package、lockfile、coverage inventory 或 threshold。

- `src/app/(app)/partner-pages/page.test.tsx`
- `src/app/(app)/partner-pages/[id]/edit/page.test.tsx`

測試只 mock auth、CSRF、Prisma query boundary、actions 與純 render boundary；未呼叫 server、Docker、Prisma runtime、Playwright、PayUni 或外部服務，亦未讀取 dotenv、憑證或正式資料。

## Verification

| Check | Result |
| --- | --- |
| Targeted Vitest | 5/5 passed |
| Full Vitest | 153 files / 1,175 tests passed |
| Node TAP contracts | 499/499 passed |
| Typecheck | passed |
| Lint | 0 errors; 2 pre-existing warnings |
| `git diff --check` | passed |

## Attribution

Coverage attribution after the combined run:

| Source | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `src/app/(app)/partner-pages/page.tsx` | 7/7 (100%) | 16/16 (100%) | 3/3 (100%) | 7/7 (100%) |
| `src/app/(app)/partner-pages/[id]/edit/page.tsx` | 16/16 (100%) | 13/14 (92.85%) | 6/6 (100%) | 12/12 (100%) |

Combined global coverage remains below the unchanged gate:

- statements: 37.17% (9659/25981) < 63%
- branches: 42.77% (8984/21001) < 57%
- functions: 44.26% (1788/4039) < 60%
- lines: 54.94% (8474/15424) < 65%

Classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`.

E2E smoke was not run because the global coverage gate did not pass.

## Rollback

回滾只移除本包新增的兩個 test files 與本證據檔；不使用 reset、clean、stash、checkout 或 restore，也不觸碰既有 dirty files。
