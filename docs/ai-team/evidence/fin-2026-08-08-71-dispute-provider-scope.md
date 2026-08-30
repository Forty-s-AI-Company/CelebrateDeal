# FIN-2026-08-08-71｜Affiliate dispute provider scope

記錄時間：2026-08-08 04:19:37（Asia/Taipei）  
結果：`COMPLETE_LOCAL_FINANCE_P1_NO_SCORE_CHANGE`

## 修正內容

修正 affiliate dispute webhook 的帳務歸屬邊界。舊邏輯以 `vendorId + orderNumber` 找 commission；同一商家若有不同 payment provider 使用相同 order number，dispute 可能寫入錯誤的 commission ledger。現在沿用已解析且由 server 擁有的 `PaymentTransaction.id`，只接受 `sourceType=webhook` 且 `sourceId=transactionId` 的精確 commission。

## Deterministic verification

- `src/lib/payment-webhooks.test.ts`：44/44 PASS，包含同一 vendor、相同 order number、兩個 provider 的 dispute isolation regression；dispute 只新增目標 provider commission 的 `dispute_opened` entry，另一筆維持只有 `accrual`。
- Scoped ESLint：PASS。
- TypeScript：`npx tsc --noEmit` PASS。
- Next production build：PASS，TypeScript PASS、static pages 89/89，包含 payment webhook route。
- `git diff --check`：PASS。

## 邊界與分數

這是實際 finance product P1 修正，沒有 schema／migration 變更；未執行 staging、PayUni Sandbox、Production、正式資料庫、付款、退款、寄信或 deployment。沒有讀取或輸出 secret，沒有重試 FIN-08AA、WP-196、WP-197。

Canonical readiness truth 如實維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。外部 PayUni／staging 與 CAT10 真人 owner／monitoring evidence 仍未完成。
