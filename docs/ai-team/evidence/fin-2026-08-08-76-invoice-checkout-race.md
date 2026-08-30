# FIN-2026-08-08-76 — Invoice checkout creation race closure

## 結果

`COMPLETE_LOCAL_FINANCE_P1_NO_SCORE_CHANGE`

本輪修正 invoice checkout 的 concurrency 邊界：當另一個 request 已建立 server-owned `pending` payment transaction、但 provider checkout snapshot 尚未寫回時，後續 request 現在 fail closed 為 `checkout_in_progress`，不會再次解析 provider、建立第二個外部 checkout，或覆寫第一個 request 的 transaction。

既有 snapshot 的付款流程仍可直接 replay；只有本 request 新建交易時才會解析 provider。這是本機產品功能修正，不是 PayUni Sandbox 或正式付款證據。

## 驗證

- `src/app/actions/invoice-actions.test.ts`：6/6 PASS。
- regression 明確驗證 pending transaction 缺少 checkout snapshot 時，`getPaymentProvider` 與 transaction create 都不會被呼叫。
- scoped ESLint：PASS。
- TypeScript：PASS。
- `npm.cmd run build`：PASS；Next production compile、post-compile、TypeScript 與 static pages `89/89` PASS。
- `git -c core.autocrlf=false diff --check`：PASS。

## 邊界與安全

- 沒有 schema／migration、staging、PayUni Sandbox、Production、正式資料庫、正式付款、退款、寄信或 deployment。
- 沒有讀取或輸出 `.env*` 內容、credential、Token、Cookie、正式 Secret、正式客戶資料或付款資料。
- 沒有重試 FIN-08AA、WP-196、WP-197，也沒有重試同一個 terminal endpoint/probe/failure command。
- 沒有降低 coverage threshold、source inventory、exclude、skip 或 assertion；本輪沒有重跑 global coverage。
- canonical score 如實維持 `73.5`：CAT04 `6.0`、CAT10 `4.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## 下一步

繼續優先處理尚未完成的販售／財務產品缺口；PayUni 週期扣款不能猜測未驗證的 provider request contract。CAT04 仍需要新的授權 staging／PayUni Sandbox evidence，CAT10 仍需要真人 owner 與外部 monitoring acceptance。
