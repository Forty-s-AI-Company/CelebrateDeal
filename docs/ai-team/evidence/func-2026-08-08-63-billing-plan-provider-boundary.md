# FUNC-2026-08-08-63｜Billing-plan provider boundary

記錄時間：2026-08-08 03:23:31（Asia/Taipei）  
結果：`COMPLETE_LOCAL_FUNCTIONAL_P1_NO_SCORE_CHANGE`

## 本輪完成的產品修正

修正商家方案選擇流程的 provider 設定錯誤邊界：

- `selectBillingPlanAction` 取得未知或不可用 payment provider 時，現在 fail closed 導向 `/billing/plans?error=provider_not_configured`。
- provider 不可用時不進入 Serializable transaction，不建立 subscription、payment transaction 或 referral side effect。
- `/billing/plans` 對 `provider_not_configured` 顯示明確的付款服務尚未設定訊息，不再把它誤顯示為一般 conflict。

這讓方案購買在付款服務未完成設定時有可操作、可追蹤的錯誤狀態，不會讓商家看到未捕捉的 server exception，也不會留下半成品訂閱。

## Deterministic verification

- billing plan action／page／source attribution 與 invoice／payment／webhook cohort：8 個 test files、129/129 PASS，0 failed／0 skipped。
- 新增 regression：provider unavailable 時 transaction、subscription create 均為 0；頁面顯示 provider-specific error。
- scoped ESLint：PASS。
- `npx tsc --noEmit`：PASS。
- `git -c core.autocrlf=false diff --check`：PASS。
- `npm run build`：PASS；route manifest 包含 `/billing/plans`、`/billing/invoices/[invoiceId]`、`/api/payments/checkout` 與 `/api/webhooks/payments`。

## 分數與未完成邊界

Canonical readiness truth 維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`。本地 provider boundary 不冒充 CAT04 PayUni Sandbox／provider reconciliation，也不冒充 CAT10 真人 owner 或 external monitoring acceptance。

本輪沒有 schema／migration、staging、PayUni Sandbox、Production、正式付款／退款／寄信、deployment、push 或 merge；沒有讀取或輸出 secret 內容，沒有重試 FIN-08AA、WP-196、WP-197 或既有 terminal external command。未降低 threshold／inventory／exclude／skip／assertion；global coverage 仍以 QUAL-60 的最新真實 receipt 為準，尚未重新計算。
