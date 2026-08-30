# FUNC-2026-08-07-39｜Stream 用量 truth reconciliation

## 結果

修正 billing usage 頁面可能低報 Stream 用量的產品 P1。月結原本已讀取 immutable `StreamUsageLedgerEntry`，但 `/billing/usage` 直接顯示 `VendorUsageLimit.streamMinutesUsed`，兩者可能不同，商家因此會看到和月結不一致的數字。

現在由共用的 `calculateStreamUsageMinutes` 同時處理 legacy usage aggregate 與 immutable ledger seconds；usage 頁面會讀取本月 ledger，並以既有 counter 作 legacy fallback。結算與 usage page 使用同一套分鐘換算與不低報規則。

本輪只完成「用量顯示與結算 truth 一致」。尚未宣稱完成 Stream quota exhaustion、付款方式驗證、overage auto-charge、通知、retry、grace period 或停用政策；這些仍是下一個功能工作包，不能用本機顯示修正代替。

## 實作範圍

- `src/lib/billing.ts`
  - 抽出 `calculateStreamUsageMinutes`，以 stream usage aggregate、immutable ledger seconds 與歷史 `totalWatchMinutes` 取最高可信值。
  - `calculateSettlement` 改用共用換算，避免 usage page 與 settlement 各自計算而漂移。
- `src/app/(app)/billing/usage/page.tsx`
  - 讀取本月 `UsageRecord` 與 `StreamUsageLedgerEntry`，再顯示 reconciled stream minutes。
  - 保留既有 `VendorUsageLimit.streamMinutesUsed` 作 legacy counter fallback，不靜默把歷史 aggregate 當成不存在。
- `src/lib/billing.test.ts`
  - 覆蓋 ledger 秒數進位、legacy aggregate reconciliation、負數輸入 fail-safe 與 settlement regression。
- `src/app/(app)/billing/usage/page.test.tsx`
  - 覆蓋 stale counter=1、ledger=61 秒時，畫面顯示 2 分鐘而非 1 分鐘。

## 驗證

- focused page／billing：2 files／24 tests，24 passed、0 failed、0 skipped。
- playback／quota／billing regression：6 files／60 tests，60 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- schema／migration：沒有變更；沒有執行 migration。
- staging／PayUni／Production：全部未接觸。

## 分數與限制

- readiness truth：PASS；canonical total 仍為 73.5。
- CAT04=6.0、CAT10=4.5；sandbox_ready=false、production_ready=false。
- current Goal score change：0；本機 usage truth 修正不冒充外部驗收或真人簽核。
- 最新 authoritative global coverage 仍為 statements／branches／functions／lines 42.36／48.07／51.11／61.68，門檻 63／57／60／65，`FAIL_REMAINING_SOURCE_INVENTORY`；本輪沒有降低 threshold、exclude、inventory、skip 或 assertion。
- 沒有讀取或輸出 `.env*`、credential、token、cookie、正式資料或付款資料；沒有重試 FIN-08AA、WP-196、WP-197，也沒有 push、merge 或 production deploy。
