# QUAL-2026-08-07-13：WP174 fresh Preview source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GATE_REMAINS_OPEN`

## 本輪完成

本輪只補 `WP174` fresh Preview PayUni read-only runner 的 deterministic pure-logic coverage，沒有執行 `runLive`、staging、disposable PostgreSQL、Browser 或 PayUni。新增測試涵蓋：

- 全部 WP170 child status mappings。
- canonical 與 digest stability。
- fresh Preview temporary boundary 與 env-name contamination rejection。
- child receipt safety 的 attempt、provider-before-candidate 與 persistence gates。
- primary outcome failure redaction 與 score eligibility predicate。

## 實際驗證

- `node --import tsx --test --experimental-test-coverage scripts/wp174-fresh-preview-payuni-readonly-reconciliation-runner.test.mjs`：`11/11 PASS`、0 failed、0 skipped。
- WP174 source-entry process coverage：lines `73.11%`、branches `83.89%`、functions `80.00%`；相對基線 `63.61% / 56.91% / 68.18%`，分別增加 `9.50 / 26.98 / 11.82` 個百分點。
- scoped ESLint：PASS。
- `git diff --check`：PASS（只有 LF/CRLF normalization warning，沒有 whitespace error）。

Global coverage 本輪沒有重算，最後 authoritative result 仍為 `39.42/45.15/47.80/59.74`，既有門檻仍為 `63/57/60/65`。

## 分數與安全邊界

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。WP174 local attribution 不能取代 fresh Preview deployment、外部 PayUni read-only receipt 或 CAT04 acceptance。

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有執行 staging／PayUni／付款／退款／DB／Browser／Production；沒有重試 FIN-08AA、WP-196、WP-197 或既有失敗 external command；沒有降低 threshold、exclude、skip 或 assertion。
