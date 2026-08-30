# QUAL-07：Global coverage source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`

## 實際結果

`npm run test:coverage` 的 Vitest 階段為 167 files／1243 tests，1243 passed、0 failed；合併 Node TAP 後為 609 passed、0 failed、0 skipped。命令如實因既有 global coverage threshold 未達標而 exit 1，並非測試失敗。

| 指標 | 實際 | 既有門檻 |
| --- | ---: | ---: |
| Statements | 37.78% | 63% |
| Branches | 43.94% | 57% |
| Functions | 45.88% | 60% |
| Lines | 57.65% | 65% |

本輪補入 WP124／125／126 no-dotenv/build-boundary runner 的 main guard、allowlist／排除規則、artifact parser、digest／status、synthetic environment、diagnostic summary、path metadata 與 OS-temp fixture tests。main guard 保留 direct CLI invocation 行為，測試 import 不會意外啟動 build。`scripts/**` attribution 為 26.64／35.04／32.23／45.46；`src/**` 為 82.28／75.32／82.50／84.56。

## 邊界

沒有修改 coverage include／exclude、threshold、assertion 或 skip，也沒有把 167／1243、609 個通過測試誤標成 coverage PASS。新增測試只使用本機 source、OS temp fixture、read-only git metadata 與 synthetic diagnostics；沒有啟動 build、Browser、資料庫、PayUni、staging 或 production 操作。FIN-08AA、WP-196、WP-197 均未重試。

## Evidence

- `.ai-team/reports/qual07-global-coverage-source-attribution.json`
- `coverage/coverage-summary.json`（本機生成檔，ignored；未作為唯一驗收依據）
- `scripts/run-combined-coverage.mjs`
- `vitest.config.ts`
- `scripts/wp124-no-dotenv-build-runner.mjs`
- `scripts/wp124-no-dotenv-build-runner.test.mjs`
- `scripts/wp125-no-dotenv-diagnostic-runner.mjs`
- `scripts/wp125-no-dotenv-diagnostic-runner.test.mjs`
- `scripts/wp126-build-boundary-audit-runner.mjs`
- `scripts/wp126-build-boundary-audit-runner.test.mjs`
