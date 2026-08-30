# QUAL-02：Global coverage source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`

## 實際結果

`npm run test:coverage` 的 Vitest 階段為 167 files／1241 tests，1241 passed、0 failed。合併 Node TAP coverage 後，global gate 實際為：

| 指標 | 實際 | 既有門檻 |
| --- | ---: | ---: |
| Statements | 35.89% | 63% |
| Branches | 42.39% | 57% |
| Functions | 43.12% | 60% |
| Lines | 54.39% | 65% |

盤點顯示 `src/**` 已達 82.28／75.43／82.50／84.56；主要缺口在既有 `scripts/**` source inventory，為 24.15／32.94／28.28／40.73。這不是 FIN-09 domain regression，也不是 test failure。

## 邊界

本輪沒有修改 coverage include／exclude、threshold、assertion 或 skip，也沒有把 1241 個通過測試誤標成 coverage PASS。下一個 QUAL work package 只補有產品或驗收價值的 script helper source attribution tests；不可透過移除 inventory 來提高數字。

## Evidence

- `.ai-team/reports/qual02-global-coverage-source-attribution.json`
- `coverage/coverage-summary.json`（本機生成檔，ignored；未作為唯一驗收依據）
- `scripts/run-combined-coverage.mjs`
- `vitest.config.ts`
