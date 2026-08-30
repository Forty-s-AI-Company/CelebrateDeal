# QUAL-2026-08-07-03：WP153 loopback source attribution

日期：2026-08-07（Asia/Taipei）  
狀態：`PARTIAL_CLOSURE_COVERAGE_GATE_REMAINS_OPEN`

## 本輪修正

`scripts/wp153-public-unavailable-browser-runner.mjs` 的 `isAllowedLoopbackUrl` 原本只檢查 scheme 與 hostname，帶 username／password 的 loopback authority 仍會被接受。本輪改為明確拒絕 userinfo，再由 deterministic tests 鎖定 fail-closed 行為。

這是本機 runner 的安全邊界修正，沒有重新呼叫任何 endpoint，也沒有重試 FIN-08AA、WP-196、WP-197 或既有 PayUni Sandbox command。

## 驗證結果

- WP153 targeted：18/18 passed、0 failed、0 skipped。
- Full Vitest：186 files／1327 passed、0 failed、0 skipped。
- Node contracts：625/625 passed。
- Combined coverage：statements `39.42%`、branches `45.15%`、functions `47.80%`、lines `59.74%`。
- 既有 coverage gate：`63/57/60/65`；仍為 `FAIL_REMAINING_SOURCE_INVENTORY`。
- 未修改 threshold、include／exclude、inventory、skip 或 assertion；未偽造 PASS。

## 評分與 Goal 邊界

CAT04 維持 `6.0`、CAT06 維持 `7.0`、CAT10 維持 `4.5`、總分維持 `73.5`。本機 coverage 改善不代表外部付款、staging、真人法律／客服／商家／release acceptance，因此沒有套用分數提升。

本輪未讀取 `.env*`、憑證、Token、Cookie、正式 Secret、正式客戶資料或付款資料；未操作正式資料庫、正式付款、正式退款、寄信、外部網路或 Production。Goal 維持 `IN_PROGRESS`。
