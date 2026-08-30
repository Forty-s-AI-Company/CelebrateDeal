# FUNC-2026-08-07-41｜Billing quota policy UI truth

## 結果

修正方案頁與用量頁對 Stream quota policy 的產品說法。現在頁面會明確顯示：Stream 包含額度用完後暫停新播放，目前沒有自動超額扣款；用量頁在 legacy counter 或 reconciled ledger 超過上限時顯示「已超額」，不再顯示負數剩餘額度。未設定上限時顯示「未設定上限」。

方案頁也補上儲存每 100 分鐘的月結參考單價。這是 UI truth correction，不代表付款方式驗證、auto-charge、通知、retry、grace 或停用政策已經完成。

## 實作範圍

- `src/app/(app)/billing/plans/page.tsx`
  - 說明目前 Stream quota exhaustion policy。
  - 明確標示未啟用自動超額扣款。
  - 顯示儲存超額參考單價。
- `src/app/(app)/billing/usage/page.tsx`
  - quota 有上限且使用量超過時顯示 explicit overage。
  - quota 未設定時顯示未設定狀態，不顯示誤導性的負剩餘。
- 對應 page tests
  - 覆蓋 policy copy、storage overage price、negative remaining prevention 與 existing usage reconciliation。

## 驗證

- billing quota UI regression：7 files／54 tests，54 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- schema／migration：沒有變更；沒有執行 migration。
- staging／PayUni／Production：全部未接觸。

## 分數與限制

- readiness truth：PASS；canonical total 仍為 73.5。
- CAT04=6.0、CAT10=4.5；sandbox_ready=false、production_ready=false。
- current Goal score change：0；UI truth correction 不冒充外部驗收或真人簽核。
- 本輪沒有重跑 global coverage。最新已記錄 gate 為 source changes 前的 statements／branches／functions／lines 42.36／48.07／51.11／61.68，門檻 63／57／60／65，`FAIL_REMAINING_SOURCE_INVENTORY`；此數字不宣稱為包含 WP40／WP41 的 current-tree coverage。
- 沒有讀取或輸出 `.env*`、credential、token、cookie、正式資料或付款資料；沒有重試 FIN-08AA、WP-196、WP-197，也沒有 push、merge 或 production deploy。
