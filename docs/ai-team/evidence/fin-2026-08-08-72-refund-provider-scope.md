# FIN-2026-08-08-72｜Affiliate refund provider scope

記錄時間：2026-08-08 04:26:04（Asia/Taipei）  
結果：`COMPLETE_LOCAL_FINANCE_P1_NO_SCORE_CHANGE`

## 修正內容

修正 affiliate refund reconciliation 的帳務歸屬邊界。舊邏輯以 `vendorId + orderNumber` 找 commission；同一商家若有不同 payment provider 使用相同 order number，partial／full refund 可能回沖錯誤的 commission ledger。現在只接受 `sourceType=webhook` 且 `sourceId=PaymentTransaction.id` 的 server-owned 精確 commission。

## Deterministic verification

- `payment-webhooks.test.ts`：45/45 PASS，包含相同 vendor、相同 order number、兩個 provider 的 partial-refund isolation regression；退款只新增目標 provider commission 的 `refund -4,000` entry，另一筆維持原本 `accrual`。
- `payment-refund-accounting.test.ts`＋`payment-webhooks.test.ts`：47/47 PASS。
- Scoped ESLint：PASS。
- TypeScript：`npx tsc --noEmit` PASS。
- Next production build：PASS，TypeScript PASS、static pages 89/89，包含 payment webhook／refund accounting route。
- `git diff --check`：PASS。

## 邊界與分數

這是實際 finance product P1 修正，沒有 schema／migration 變更；未執行 staging、PayUni Sandbox、Production、正式資料庫、付款、退款、寄信或 deployment。這裡的退款只是在 disposable／deterministic test fixture 內驗證，沒有正式退款。沒有讀取或輸出 secret，沒有重試 FIN-08AA、WP-196、WP-197。

Canonical readiness truth 如實維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。外部 PayUni／staging 與 CAT10 真人 owner／monitoring evidence 仍未完成。
