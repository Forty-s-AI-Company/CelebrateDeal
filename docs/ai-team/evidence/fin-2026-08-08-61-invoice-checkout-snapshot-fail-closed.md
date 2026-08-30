# FIN-2026-08-08-61｜Invoice checkout snapshot fail-closed

記錄時間：2026-08-08 03:11:12（Asia/Taipei）  
結果：`COMPLETE_LOCAL_FINANCE_P1_NO_SCORE_CHANGE`

## 本輪完成的產品修正

修正帳單付款建立流程的 P1 邊界：provider checkout 已建立、但 server-owned checkout snapshot 寫回 `PaymentTransaction` 失敗時，原流程可能留下 `pending` transaction 與可重用 idempotency key，讓後續重試再次建立外部 checkout。

現在 snapshot persistence failure 會：

- 只對仍為 `pending` 的同一 transaction 做 conditional fail-closed update。
- 將狀態改為 `failed` 並清除 `checkoutIdempotencyKey`。
- 導回該帳單的 `?error=checkout`，不寫入付款 audit success，也不把交易宣稱為已付款。

## Deterministic verification

- 帳單／付款／invoice detail／payment webhook 相關 8 個 test files：124/124 PASS，0 failed／0 skipped。
- 新增 regression：snapshot persistence failure 會執行 bounded failure update，並阻止 audit success。
- targeted ESLint：PASS。
- `npx tsc --noEmit`：PASS。
- `git -c core.autocrlf=false diff --check`：PASS。
- `npm run build`：PASS；route manifest 包含 `/billing/invoices/[invoiceId]`、`/api/payments/checkout`、`/api/webhooks/payments`。

## 分數與未完成邊界

Canonical readiness truth 維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`。本地 fail-closed 修正不冒充 CAT04 PayUni Sandbox／provider reconciliation，也不冒充 CAT10 真人 owner 或 external monitoring acceptance。

本輪沒有 schema／migration、staging、PayUni Sandbox、Production、正式付款／退款／寄信、deployment、push 或 merge；沒有讀取或輸出 secret 內容，沒有重試 FIN-08AA、WP-196、WP-197 或既有 terminal external command。未降低 threshold／inventory／exclude／skip／assertion；global coverage 仍以 QUAL-60 的最新真實 receipt 為準，尚未重新計算。
