# QUAL-2026-08-07-14：FIN-08R deterministic source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GATE_REMAINS_OPEN`

## 本輪完成

本輪只補 `FIN-08R` staging PayUni reconciliation runner 的 deterministic pure-logic coverage，沒有執行 `--execute-once`、`--sterile-coordinator`、`--live-child`、staging、disposable PostgreSQL 或外部 PayUni。新增測試涵蓋：

- canonical 與 digest stability。
- inspect identity 與 marker digest rejection matrix。
- malformed、mismatch、production environment classification boundaries。
- receipt isolation、side-effect、replay、sensitive-text 與 score-overclaim rejection。
- synthetic provider transaction projection。
- provider URL allowlist、redirect 與 one-attempt budget。
- bounded disposable marker cleanup 與 idempotent cleanup。

## 實際驗證

- `node --import tsx --test --experimental-test-coverage scripts/fin08r-staging-payuni-reconciliation-runner.test.mjs`：`11/11 PASS`、0 failed、0 skipped。
- FIN-08R source-entry process coverage：lines `51.65%`、branches `91.49%`、functions `64.00%`；相對基線 `41.21% / 56.25% / 40.91%`，分別增加 `10.44 / 35.24 / 23.09` 個百分點。
- scoped ESLint：PASS。
- `git diff --check`：PASS（只有 LF/CRLF normalization warning，沒有 whitespace error）。

中途 cleanup fixture 使用了不符合 FIN-08R hex suffix contract 的 mkdtemp leaf，產品 guard 正確拒絕；已改用明確符合 contract 的 synthetic directory 並重新取得 `11/11`。這不是 production bug，也沒有弱化 assertion。

Global coverage 本輪沒有重算，最後 authoritative result 仍為 `39.42/45.15/47.80/59.74`，既有門檻仍為 `63/57/60/65`。

## 分數與安全邊界

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。FIN-08R local source attribution 不能取代 terminal external reconciliation path 或新的、獲授權的 PayUni Sandbox receipt。

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有執行 staging／PayUni／付款／退款／DB／Browser／Production；沒有重試 FIN-08AA、WP-196、WP-197 或既有失敗 external command；沒有降低 threshold、exclude、skip 或 assertion。
