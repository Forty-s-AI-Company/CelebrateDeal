# QUAL-2026-08-07-05：WP153 source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GATE_REMAINS_OPEN`

## 本輪完成

在不執行 WP153 live runner、不碰 staging／PayUni 的前提下，補上兩類 deterministic
source-attribution cases：

- `runQuiet` subprocess result 的 bounded exit／stdout／stderr normalization。
- `waitForServer` child early exit fail-closed，以及 loopback HTTP 204 readiness success。

## 實際驗證

- `node --test --experimental-test-coverage scripts/wp153-public-unavailable-browser-runner.test.mjs`：`21/21 PASS`、0 failed、0 skipped。
- WP153 targeted coverage：lines `64.62%`、branches `81.94%`、functions `78.57%`。
- scoped ESLint：PASS。
- `git diff --check`：PASS。

這是 source attribution 的局部進展，不是 global gate PASS；本輪沒有重算 global coverage。上一個 authoritative global result 仍為 statements／branches／functions／lines `39.42/45.15/47.80/59.74`，門檻 `63/57/60/65`。

## 分數與安全邊界

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。Coverage 測試不能取代 CAT04 PayUni provider receipt，也不能取代 CAT10 真人法律、客服、財務與 release owner sign-off。

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有執行付款／退款、Production、部署或外部 provider；沒有重試 FIN-08AA、WP-196、WP-197 或既有失敗 PayUni command；沒有降低 threshold、exclude、skip 或 assertion。
