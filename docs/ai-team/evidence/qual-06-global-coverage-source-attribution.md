# QUAL-06：Global coverage source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`

## 實際結果

`npm run test:coverage` 的 Vitest 階段為 167 files／1243 tests，1243 passed、0 failed；合併 Node TAP 後為 601 passed、0 failed、0 skipped。命令如實因既有 global coverage threshold 未達標而 exit 1，並非測試失敗。

| 指標 | 實際 | 既有門檻 |
| --- | ---: | ---: |
| Statements | 37.56% | 63% |
| Branches | 43.85% | 57% |
| Functions | 45.44% | 60% |
| Lines | 56.82% | 65% |

本輪補入 WP133 public-unavailable runner 的 mirror filtering、required-input inspection、loopback ephemeral port、synthetic environment、fixture/config 生成、source digest 與 cleanup tests。`scripts/**` attribution 為 26.24／34.85／31.47／44.26；`src/**` 為 82.28／75.32／82.50／84.56。

## 邊界

沒有修改 coverage include／exclude、threshold、assertion 或 skip，也沒有把 167／1243、601 個通過測試誤標成 coverage PASS。新增測試只使用本機 source、OS temp fixture、loopback ephemeral port 與 read-only hashing；沒有啟動 Browser、資料庫、PayUni、staging 或 production 操作。FIN-08AA、WP-196、WP-197 均未重試。

## Evidence

- `.ai-team/reports/qual06-global-coverage-source-attribution.json`
- `coverage/coverage-summary.json`（本機生成檔，ignored；未作為唯一驗收依據）
- `scripts/run-combined-coverage.mjs`
- `vitest.config.ts`
- `scripts/wp133-public-unavailable-browser-runner.test.mjs`
