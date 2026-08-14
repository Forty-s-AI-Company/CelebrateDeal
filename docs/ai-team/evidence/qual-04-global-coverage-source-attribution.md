# QUAL-04：Global coverage source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`

## 實際結果

`npm run test:coverage` 的 Vitest 階段為 167 files／1243 tests，1243 passed、0 failed；合併 Node TAP 後為 584 passed、0 failed、0 skipped。命令如實因既有 global coverage threshold 未達標而 exit 1，並非測試失敗。

| 指標 | 實際 | 既有門檻 |
| --- | ---: | ---: |
| Statements | 36.91% | 63% |
| Branches | 43.36% | 57% |
| Functions | 44.40% | 60% |
| Lines | 55.90% | 65% |

本輪補入可追溯的 source-attribution deterministic tests，涵蓋 WP134 的 startup/path attribution、WP139 的 hermetic mirror 與 marker metadata、WP141 的 sanitized build boundary、WP153／WP155 的 public-unavailable receipt／stream／preflight helper，以及 PayUni Sandbox QA runner 的 closed enums、diagnostic mapping、provider disposition 與 bounded query timeout。`scripts/**` attribution 為 25.43／34.20／30.04／42.91；`src/**` 為 82.28／75.37／82.50／84.56。

## 邊界

沒有修改 coverage include／exclude、threshold、assertion 或 skip，也沒有把 167／1243、584 個通過測試誤標成 coverage PASS。新增測試只使用本機 source、OS temp fixture、EventEmitter synthetic stream 與 read-only preflight；沒有啟動 Browser、資料庫、PayUni、staging 或 production 操作。FIN-08AA、WP-196、WP-197 均未重試。

## Evidence

- `.ai-team/reports/qual04-global-coverage-source-attribution.json`
- `coverage/coverage-summary.json`（本機生成檔，ignored；未作為唯一驗收依據）
- `scripts/run-combined-coverage.mjs`
- `vitest.config.ts`
- `scripts/wp134-next-startup-error-mapper.test.mjs`
- `scripts/wp139-isolated-next-build-runner.test.mjs`
- `scripts/wp141-sanitized-build-boundary-runner.test.mjs`
- `scripts/wp153-public-unavailable-browser-runner.test.mjs`
- `scripts/wp155-public-unavailable-browser-runner.test.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
