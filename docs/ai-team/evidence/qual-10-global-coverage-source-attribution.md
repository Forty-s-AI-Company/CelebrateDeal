# QUAL-10：Global coverage source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`

## 實際結果

`npm run test:coverage` 的 Vitest 階段為 167 files／1243 tests，1243 passed、0 failed；合併 Node TAP 後為 620 passed、0 failed、0 skipped。命令如實因既有 global coverage threshold 未達標而 exit 1，並非測試失敗。

| 指標 | 實際 | 既有門檻 |
| --- | ---: | ---: |
| Statements | 38.14% | 63% |
| Branches | 44.25% | 57% |
| Functions | 46.58% | 60% |
| Lines | 58.38% | 65% |

本輪為 WP136 temp-next type-generation runner 抽出 mirror forbidden-path policy、mirror inspection、OS-temp cleanup、synthetic environment 與 required source-integrity helper，並補上 3 個 deterministic tests。`scripts/**` attribution 為 27.15／35.48／33.23／46.52；`src/**` 為 82.28／75.32／82.50／84.56。相較 QUAL-09，global statements／branches／functions／lines 分別提升 0.10／0.10／0.19／0.16 個百分點；仍未達既有門檻。

## 邊界

沒有修改 coverage include／exclude、threshold、assertion 或 skip，也沒有執行 `next typegen`、Next、Browser、資料庫、PayUni 或 staging orchestration。測試只使用本機 source digest、OS temp fixture 與 synthetic environment；FIN-08AA、WP-196、WP-197 均未重試。

## Evidence

- `.ai-team/reports/qual10-global-coverage-source-attribution.json`
- `coverage/coverage-summary.json`（本機生成檔，ignored；未作為唯一驗收依據）
- `scripts/run-combined-coverage.mjs`
- `vitest.config.ts`
- `scripts/wp136-temp-next-type-generation-runner.mjs`
- `scripts/wp136-temp-next-type-generation-runner.test.mjs`

