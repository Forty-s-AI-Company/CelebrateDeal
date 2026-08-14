# FIN-2026-08-08-73｜Webhook reconciliation provider scope

記錄時間：2026-08-08 04:31:24（Asia/Taipei）  
結果：`COMPLETE_LOCAL_FINANCE_P1_NO_SCORE_CHANGE`

## 修正內容

修正 finance webhook reconciliation read model 的交易／佣金歸屬。舊邏輯只用 `orderNumber` 查詢，可能在同一 vendor 的不同 provider 撞單號時顯示錯誤交易。現在交易查詢要求 `event.vendorId + payload.provider + payload.orderNumber`，affiliate commission 再以查到的 `PaymentTransaction.id` 精確比對；未完成 vendor scope 的 webhook event 直接 fail closed。

## Deterministic verification

- `payment-webhooks.test.ts`：46/46 PASS，包含同一 vendor／相同 order number／不同 provider、不同 gross amount 的 reconciliation isolation regression。
- Webhook reconciliation route regression：2 files、48/48 PASS。
- Scoped ESLint：PASS。
- TypeScript：`npx tsc --noEmit` PASS。
- Next production build：PASS，TypeScript PASS、static pages 89/89。
- `git diff --check`：PASS。

## 邊界與分數

這是實際 finance reconciliation product P1 修正，沒有 schema／migration 變更；未執行 staging、PayUni Sandbox、Production、正式資料庫、付款、退款、寄信或 deployment。沒有讀取或輸出 secret，沒有重試 FIN-08AA、WP-196、WP-197。

Canonical readiness truth 如實維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。外部 PayUni／staging 與 CAT10 真人 owner／monitoring evidence 仍未完成。
