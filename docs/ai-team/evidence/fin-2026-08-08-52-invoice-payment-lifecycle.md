# FIN-2026-08-08-52｜帳單付款與退款生命週期

## 結果

`COMPLETE_LOCAL_PRODUCT_FIX_NO_SCORE_CHANGE`。本輪完成一個可販售的本機功能閉環：財務角色可從已開立或逾期帳單建立付款交易；金額、tenant 與 invoice identity 由 server 綁定；provider checkout snapshot 只在交易 metadata 中保存可安全呈現的欄位；可信 payment webhook 會把 invoice 更新為已付款、部分退款或已退款。

## 產品修正

- 新增 `payInvoiceAction`，只接受 server 查到的帳單總額，不接受 client 傳入的金額或 vendor identity。
- 以 vendor／invoice 組成 checkout idempotency key，重用相符 pending transaction；狀態或金額不一致時 fail closed。
- 帳單頁提供 CSRF 保護的付款入口，PayUni form-post 只接受 allowlisted UPP action；demo/manual adapter 會明確顯示尚未有外部付款頁，不會誤標記付款完成。
- webhook 只使用既有 server-created transaction 的可信 metadata 找 invoice，驗證 vendor 與 gross amount 後才更新帳單狀態。
- `paid`、`partially_refunded`、`refunded` 會分別同步 invoice 狀態；不接受跨 tenant、金額不一致或錯誤狀態轉換。
- 帳單總覽的未付款統計只計算 `issued`／`overdue`，不再把草稿或退款帳單算成待付款。

## 驗證

- `npx vitest run src/lib/payment-webhooks.test.ts`：42/42 PASS。
- invoice UI／action／export regression：14/14 PASS。
- invoice paid／partial-refund／full-refund lifecycle focused cases：2/2 PASS。
- provider checkout regression：48/48 PASS。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git diff --check`：PASS。
- `npx next build`：PASS；TypeScript、static page generation 與 route generation 完成。

## 分數與邊界

canonical readiness 維持 73.5：CAT01=7.5、CAT02=8.0、CAT03=8.0、CAT04=6.0、CAT05=8.5、CAT06=7.0、CAT07=9.0、CAT08=7.5、CAT09=7.5、CAT10=4.5；`current_goal_score_change=0`。本輪證明 local product correctness，不等於 PayUni Sandbox receipt、staging reconciliation 或真人 release acceptance，因此不能把分數標成上升。

## 安全與回滾

- 未讀取或輸出 `.env*` 內容、credential、token、cookie、正式資料或付款資料。
- 沒有 production DB、正式付款／退款／寄信、staging、部署、push 或 merge 操作。
- 沒有降低 coverage threshold、exclude、skip、assertion 或資料驗證強度；本輪沒有重跑 global coverage gate。
- FIN-08AA、WP-196、WP-197 terminal no-go 路徑沒有重試。
- 本輪回滾範圍限於上述 invoice checkout／webhook／presentation 變更；其他使用者既有 dirty worktree 保留。

## 下一步

繼續處理 provider-neutral recurring／overage 的可上線規則與 fail-closed charging boundary。PayUni setup／recurring 的正式欄位契約、外部 Sandbox／staging evidence 與 CAT10 真人 owner evidence 仍未完成，不能假設已通過。
