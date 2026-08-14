# FUNC-2026-08-07-40｜Stream 包含分鐘數限制

## 結果

完成 Stream 用量超過方案包含分鐘數時的 server-side fail-closed gate。Live admission 會先讀取當月 immutable `StreamUsageLedgerEntry` 秒數，並以尚在有效 reset window 的 legacy `VendorUsageLimit.streamMinutesUsed` 作保守 fallback；heartbeat 在寫入 ledger 前也會檢查本次秒數，避免超額資料繼續被記錄。

剛好到達包含分鐘數上限仍可使用；跨過上限會拒絕。`/api/stream-usage` 對 quota exhaustion 回傳 429 與 `Cache-Control: private, no-store`，不把內部錯誤碼回傳給瀏覽器。

本輪只完成「包含分鐘數邊界 enforcement」。尚未宣稱付款方式驗證、overage auto-charge、通知、retry、grace period、商家停用或正式方案政策完成；這些需要另行定義產品政策與外部／人工驗收。

## 實作範圍

- `src/lib/stream-quota.ts`
  - 新增共用的包含分鐘數邊界檢查與明確 `stream_minutes_exhausted` error。
  - 非正數 limit 保留既有未設定／legacy unlimited 行為。
- `src/lib/live-quota-admission.ts`
  - 新增 admission-time quota gate；包含已使用 ledger 秒數與 reset-aware legacy counter。
- `src/lib/stream-usage.ts`
  - 在 immutable ledger create 前檢查本次 heartbeat 是否會跨過上限。
- `src/app/api/stream-usage/route.ts`
  - 將 quota exhaustion 映射為安全的 HTTP 429 response。
- 對應 unit／route tests
  - 覆蓋 exact boundary、跨界拒絕、ledger create 不發生、admission fail-closed 與 safe 429 mapping。

## 驗證

- focused quota／usage：4 files／31 tests，31 passed、0 failed、0 skipped。
- related playback／quota regression：9 files／55 tests，55 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- schema／migration：沒有變更；沒有執行 migration。
- staging／PayUni／Production：全部未接觸。

## 分數與限制

- readiness truth：PASS；canonical total 仍為 73.5。
- CAT04=6.0、CAT10=4.5；sandbox_ready=false、production_ready=false。
- current Goal score change：0；本機 quota enforcement 不冒充外部驗收或真人簽核。
- 最新 authoritative global coverage 仍為 statements／branches／functions／lines 42.36／48.07／51.11／61.68，門檻 63／57／60／65，`FAIL_REMAINING_SOURCE_INVENTORY`；本輪沒有重跑 coverage，也沒有降低 threshold、exclude、inventory、skip 或 assertion。
- 沒有讀取或輸出 `.env*`、credential、token、cookie、正式資料或付款資料；沒有重試 FIN-08AA、WP-196、WP-197，也沒有 push、merge 或 production deploy。
