# QUAL-08：Global coverage source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`

## 實際結果

`npm run test:coverage` 的 Vitest 階段為 167 files／1243 tests，1243 passed、0 failed；合併 Node TAP 後為 614 passed、0 failed、0 skipped。命令如實因既有 global coverage threshold 未達標而 exit 1，並非測試失敗。

| 指標 | 實際 | 既有門檻 |
| --- | ---: | ---: |
| Statements | 38.12% | 63% |
| Branches | 44.22% | 57% |
| Functions | 46.40% | 60% |
| Lines | 58.13% | 65% |

本輪新增 WP137／WP138 temp-next route lineage、generated-target reference resolver 的 deterministic source-attribution tests，涵蓋 normalized path policy、OS-temp mirror copy／cleanup、digest、sanitized inventory 與 forbidden mirror boundary。`scripts/**` attribution 為 27.07／35.40／32.95／46.17；`src/**` 為 82.28／75.32／82.50／84.56。

## 邊界

沒有修改 coverage include／exclude、threshold、assertion 或 skip，也沒有把 167／1243、614 個通過測試誤標成 coverage PASS。新增測試只使用本機 source、OS temp fixture、read-only digest／inventory 與 synthetic diagnostics；沒有啟動 staging、Browser、資料庫、PayUni 或 production 操作。FIN-08AA、WP-196、WP-197 均未重試。

## Evidence

- `.ai-team/reports/qual08-global-coverage-source-attribution.json`
- `coverage/coverage-summary.json`（本機生成檔，ignored；未作為唯一驗收依據）
- `scripts/run-combined-coverage.mjs`
- `vitest.config.ts`
- `scripts/wp137-temp-next-route-lineage-runner.mjs`
- `scripts/wp137-temp-next-route-lineage-runner.test.mjs`
- `scripts/wp138-generated-target-reference-resolver.mjs`
- `scripts/wp138-generated-target-reference-resolver.test.mjs`

