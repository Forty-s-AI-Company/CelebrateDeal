# QUAL-03：Global coverage source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`

## 實際結果

`npm run test:coverage` 的 Vitest 階段為 167 files／1241 tests，1241 passed、0 failed；合併 Node TAP 後為 581 passed、0 failed。combined global gate 實際為：

| 指標 | 實際 | 既有門檻 |
| --- | ---: | ---: |
| Statements | 36.76% | 63% |
| Branches | 43.20% | 57% |
| Functions | 44.27% | 60% |
| Lines | 55.69% | 65% |

本輪為 WP134、WP139、WP141、WP155 的 source-attribution deterministic tests，涵蓋路徑／diagnostic mapping、hermetic mirror、synthetic environment、marker metadata、receipt round-trip、cleanup 與 fail-closed preflight。`scripts/**` attribution 提升至 25.24／33.99／29.86／42.61；仍不足以通過 global gate。

## 邊界

沒有修改 coverage include／exclude、threshold、assertion 或 skip，也沒有把 167／1241 或 581 個通過測試誤標成 coverage PASS。新增測試只使用本機 source、OS temp fixture、git read-only preflight；沒有啟動 Browser、資料庫、PayUni、staging 或 production 操作。FIN-08AA、WP-196、WP-197 均未重試。

## Evidence

- `.ai-team/reports/qual03-global-coverage-source-attribution.json`
- `coverage/coverage-summary.json`（本機生成檔，ignored；未作為唯一驗收依據）
- `scripts/run-combined-coverage.mjs`
- `vitest.config.ts`
- `scripts/wp134-next-startup-error-mapper.test.mjs`
- `scripts/wp139-isolated-next-build-runner.test.mjs`
- `scripts/wp141-sanitized-build-boundary-runner.test.mjs`
- `scripts/wp155-public-unavailable-browser-runner.test.mjs`
