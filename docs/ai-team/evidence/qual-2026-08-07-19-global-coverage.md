# QUAL-2026-08-07-19：最新 source 的 global coverage 重算

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_GLOBAL_GATE_REMAINS_OPEN`

## 實際結果

- `npm run test:coverage` 的 Vitest：`187 files / 1340 passed / 0 failed / 0 skipped`。
- Node contract：`679/679 passed / 0 failed / 0 skipped`。
- combined global coverage：statements `40.73%`、branches `46.56%`、functions `49.25%`、lines `61.16%`。
- 既有 gate：statements `63%`、branches `57%`、functions `60%`、lines `65%`；命令 exit `1`，保留為 `FAIL_REMAINING_SOURCE_INVENTORY`。
- 相較 QUAL-18：`+0.08 / +0.10 / +0.09 / +0.08` 個百分點。這是 FUNC-19／FUNC-20 最新 source 被重新計入的品質變化，不是 launch score 計分事件。

## 分數判定

CAT04 `6.0`、CAT06 `7.0`、CAT10 `4.5`、總分 `73.5` 維持不變。coverage gate 不能取代 CAT04 所需的 fresh staging reconciliation／PayUni Sandbox provider receipt，也不能取代 CAT10 的真人 owner 與外部 monitoring acceptance。

## 安全與範圍

本輪只執行本機測試與 coverage merge；沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料，沒有啟動 server／Browser／DB，沒有執行 staging、PayUni、Production、付款或退款，也沒有重試 FIN-08AA、FIN-08AB、WP-196、WP-197 或既有 terminal external command。沒有修改 threshold、inventory、exclude、skip 或 assertion。
