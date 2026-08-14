# QUAL-2026-08-07-06：WP155 source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GATE_REMAINS_OPEN`

## 本輪完成

在不執行 WP155 live runner、不建立 disposable schema、不啟動 Browser 或 provider 的前提下，補上：

- `runQuiet` subprocess result 的 bounded exit／stdout／stderr normalization。
- `waitForServer` child early exit fail-closed。
- `waitForServer` loopback HTTP 204 response 進入 `READY` 的 deterministic path。

## 實際驗證

- `node --test --experimental-test-coverage scripts/wp155-public-unavailable-browser-runner.test.mjs`：`18/18 PASS`、0 failed、0 skipped。
- WP155 source entry targeted process coverage：lines `55.79%`、branches `73.24%`、functions `71.43%`。
- scoped ESLint：PASS。
- `git diff --check`：PASS。

此 process 也會 import WP153 shared helpers，因此報告中的 coverage 明確標註為 WP155 source entry，不宣稱 global gate 已通過。上一個 authoritative global result 仍為 `39.42/45.15/47.80/59.74`，門檻 `63/57/60/65`。

## 分數與安全邊界

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。Coverage 測試不能取代 CAT04 PayUni provider receipt，也不能取代 CAT10 真人法律、客服、財務與 release owner sign-off。

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有執行付款／退款、Production、部署、DB、Browser 或外部 provider；沒有重試 FIN-08AA、WP-196、WP-197 或既有失敗 PayUni command；沒有降低 threshold、exclude、skip 或 assertion。
