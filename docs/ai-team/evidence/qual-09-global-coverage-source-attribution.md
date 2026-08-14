# QUAL-09：Global coverage source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`

## 實際結果

`npm run test:coverage` 的 Vitest 階段為 167 files／1243 tests，1243 passed、0 failed；合併 Node TAP 後為 617 passed、0 failed、0 skipped。命令如實因既有 global coverage threshold 未達標而 exit 1，並非測試失敗。

| 指標 | 實際 | 既有門檻 |
| --- | ---: | ---: |
| Statements | 38.04% | 63% |
| Branches | 44.15% | 57% |
| Functions | 46.39% | 60% |
| Lines | 58.22% | 65% |

本輪為 WP128 public partner unavailable-state runner 抽出 import-safe 的 `run`、synthetic `environment` 與 create／cleanup `fixtureScript` helper，並補上 offline／loopback boundary、fixture lifecycle shape 與 bounded child-process success/failure tests。`scripts/**` attribution 為 27.02／35.34／32.96／46.30；`src/**` 為 82.28／75.32／82.50／84.56。由於 WP128 原本未被 attribution，新增完整 source inventory 後 global statements 由上一輪 38.12% 變為 38.04%；此下降如實保留，未以測試數量冒充 coverage gate 通過。

## 邊界

沒有修改 coverage include／exclude、threshold、assertion 或 skip，也沒有啟動 WP128 的 PostgreSQL、Next、Playwright、PayUni 或 staging orchestration。新增測試只使用本機 child process、synthetic environment 與字串 fixture；FIN-08AA、WP-196、WP-197 均未重試。

## Evidence

- `.ai-team/reports/qual09-global-coverage-source-attribution.json`
- `coverage/coverage-summary.json`（本機生成檔，ignored；未作為唯一驗收依據）
- `scripts/run-combined-coverage.mjs`
- `vitest.config.ts`
- `scripts/wp128-public-partner-unavailable-state-runner.mjs`
- `scripts/wp128-public-partner-unavailable-state-runner.test.mjs`

