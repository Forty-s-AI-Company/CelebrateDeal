# FIN-2026-08-08-75｜Invoice checkout lazy provider resolution

記錄時間：2026-08-08 04:44:10（Asia/Taipei）  
結果：`COMPLETE_LOCAL_FINANCE_P1_NO_SCORE_CHANGE`

## 修正內容

修正 invoice payment checkout replay 的 provider resolution 順序。已有 server-owned pending checkout snapshot 時，`payInvoiceAction` 現在直接回放既有交易，不解析目前 provider；只有建立新交易，或 pending transaction 尚未有 checkout snapshot 時，才解析 provider 並建立外部 checkout session。provider 暫時不可用不會阻擋已建立的可回放付款流程。

## Deterministic verification

- `src/app/actions/invoice-actions.test.ts`：5/5 PASS。
- 回放 regression 明確讓 `getPaymentProvider` throw；既有 checkout snapshot 仍成功導向原 transaction，provider 解析呼叫次數為 0。
- Scoped ESLint：PASS。
- TypeScript：`npx tsc --noEmit` PASS。
- Next production build：PASS，TypeScript PASS、static pages 89/89。
- `git diff --check`：PASS。

## 邊界與分數

這是實際 finance product P1 修正，沒有 schema／migration 變更；未執行 staging、PayUni Sandbox、Production、正式資料庫、付款、退款、寄信或 deployment。沒有讀取或輸出 secret，沒有重試 FIN-08AA、WP-196、WP-197。

Canonical readiness truth 如實維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。外部 PayUni／staging 與 CAT10 真人 owner／monitoring evidence 仍未完成。
