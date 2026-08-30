# FIN-2026-08-08-81｜Invoice payment reconciliation closure

記錄時間：2026-08-08（Asia/Taipei）  
結果：`COMPLETE_LOCAL_FINANCE_P1_NO_SCORE_CHANGE`

## 本輪完成的產品功能

財務 webhook reconciliation artifact 現在會針對 server-owned 的 invoice payment 交易補齊三項可操作檢查：

- `invoice_identity`：trusted checkout metadata 的 invoiceId 必須解析到同一商家的 invoice。
- `invoice_amount`：invoice total 與 payment transaction gross amount 必須一致。
- `invoice_status`：已付款／部分退款／全額退款交易必須與 invoice 狀態一致；未結算交易只接受 issued／overdue。

非 invoice payment 不會被錯誤套用 invoice 檢查。錯誤會以 reconciliation fail／warning 呈現，不會被標成成功，也不會讀取跨商家的 invoice。

## Deterministic verification

- `src/lib/reconciliation.test.ts`：3/3 PASS，涵蓋 invoice identity／amount／status 通過、金額或狀態不一致 fail closed、非 invoice payment 維持原流程。
- `src/lib/payment-webhooks.test.ts`：46/46 PASS。
- `src/app/admin/billing/webhooks/[id]/reconciliation/route.test.ts`：2/2 PASS。
- 本輪 focus cohort：3 files、51/51 PASS，0 failed、0 skipped。
- scoped ESLint：PASS，0 errors／0 warnings。
- `npx tsc --noEmit`：PASS。
- `npm run build`：PASS；Next production build static pages 89/89。
- `git -c core.autocrlf=false diff --check`：PASS。

## 分數與未完成邊界

Canonical readiness truth 維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。本地 reconciliation artifact 不冒充 CAT04 所需的 authorized staging／PayUni Sandbox provider receipt，也不冒充 CAT10 真人 owner／external monitoring acceptance。

本輪沒有 schema／migration、staging、PayUni Sandbox、Production、正式資料庫、正式付款／退款／寄信、外部 payout、deployment、push 或 merge；沒有讀取或輸出 secrets、正式客戶資料或付款資料。沒有重試 FIN-08AA、WP-196 或 WP-197。

沒有降低 coverage threshold、source inventory、exclude、skip、assertion 或資料驗證強度；global coverage 未在本 WP 重算，且不阻擋本輪功能測試。

## 回滾與下一步

回滾範圍限於本輪 `src/lib/reconciliation.ts`、`src/lib/reconciliation.test.ts` 與本輪 evidence／control-plane metadata；其他既有 dirty worktree 變更保留。下一步繼續選擇尚未完成的產品功能或 CAT06／CAT10 必要驗收證據，不把本地測試誤當成外部／真人簽核。
