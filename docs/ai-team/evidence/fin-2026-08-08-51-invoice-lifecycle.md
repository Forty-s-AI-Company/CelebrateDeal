# FIN-2026-08-08-51｜月結 invoice lifecycle 修正

## 結果

`COMPLETE_LOCAL_PRODUCT_FIX_NO_SCORE_CHANGE`。本輪修正一個實際 finance P1：重新產生同一月份月結時，原本的 invoice upsert update 會把既有 status 強制改回 `issued`，可能讓已付款發票在重算後倒退。現在重算只更新金額與 `dueAt`，保留既有 invoice status／paidAt；新 invoice 會依 subscription billing cycle 產生到期日。

## 產品修正

- `invoiceDueAt(monthKey, billingCycleDay)` 以月結月份的下一個月份計算到期日。
- billing cycle day 超過該月份天數時，會 clamp 到該月最後一天，避免 31 日落到錯誤月份。
- settlement invoice create path 寫入 `dueAt` 與 `status: issued`。
- settlement invoice update path 寫入新的金額與 `dueAt`，不再寫入 `status` 或 `paidAt`，因此已付款 invoice 不會因重算倒退。

## 驗證

- `npx vitest run src/lib/billing.test.ts`：19/19 PASS。
- `npx vitest run src/app/actions.test.ts -t generateSettlementAction`：2 PASS、150 skipped（test-name filter，沒有新增 skip）。
- `npx vitest run src/app/actions.test.ts`：152/152 PASS。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git diff --check`：PASS。
- `npx next build`：PASS；TypeScript、88 static pages 與完整 route generation 完成。

## 分數與邊界

canonical readiness 維持 73.5：CAT01=7.5、CAT02=8.0、CAT03=8.0、CAT04=6.0、CAT05=8.5、CAT06=7.0、CAT07=9.0、CAT08=7.5、CAT09=7.5、CAT10=4.5；`current_goal_score_change=0`。本輪是本機 finance correctness 修正，沒有取得 PayUni Sandbox、staging reconciliation 或 CAT10 真人 acceptance，因此不宣稱分數增加。

## 安全與回滾

- 未讀取或輸出 `.env*` 內容、credential、token、cookie、正式資料或付款資料。
- 沒有 production DB、正式付款／退款／寄信、staging、部署、push 或 merge 操作。
- 沒有降低 coverage threshold、exclude、skip、assertion 或資料驗證強度。
- 回滾範圍為 `src/lib/billing.ts`、`src/lib/billing.test.ts`、`src/app/actions.ts` 與 `src/app/actions.test.ts` 中本輪 invoice due-date／status-preservation 變更；其他使用者既有變更保留。

## 下一步

繼續處理 provider-neutral recurring／overage 的可上線規則與 fail-closed charging boundary；PayUni setup 欄位契約未知時不猜測、不呼叫外部 endpoint。CAT04／CAT10 仍等待授權外部證據與真人 owner evidence。
