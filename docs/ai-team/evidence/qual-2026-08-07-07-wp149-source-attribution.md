# QUAL-2026-08-07-07：WP149 source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GATE_REMAINS_OPEN`

## 本輪完成

在不執行 WP149 live runner、不建立 disposable schema、不啟動 Browser 或 provider 的前提下，補上：

- `runQuiet` subprocess result 的 bounded exit／stdout／stderr normalization。
- `waitForServer` child pre-readiness exit fail-closed。
- `waitForServer` loopback HTTP 204 readiness success。

## 實際驗證

- `node --test --experimental-test-coverage scripts/wp149-public-unavailable-browser-runner.test.mjs`：`12/12 PASS`、0 failed、0 skipped。
- WP149 source-entry process coverage：lines `65.29%`、branches `70.33%`、functions `80.77%`。
- scoped ESLint：PASS。
- `git diff --check`：PASS。

Browser orchestration 與 `main` 仍未執行，沒有把未跑的畫面驗收標成 PASS。上一個 authoritative global coverage result 仍為 `39.42/45.15/47.80/59.74`，門檻 `63/57/60/65`。

## 分數與安全邊界

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。Coverage 測試不能取代 CAT04 PayUni provider receipt，也不能取代 CAT10 真人法律、客服、財務與 release owner sign-off。

本輪沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有執行付款／退款、Production、部署、DB、Browser 或外部 provider；沒有重試 FIN-08AA、WP-196、WP-197 或既有失敗 PayUni command；沒有降低 threshold、exclude、skip 或 assertion。
