# FUNC-2026-08-08-55｜Server-owned monthly usage estimation and idempotent snapshot

## 結果

`COMPLETE_LOCAL_PRODUCT_FIX_NO_SCORE_CHANGE`。本輪關閉 code review 指出的產品 P1：`UsageRecord` 原本只有 seed／read path，production 沒有把既有 server-owned usage sources 寫成月度快照，造成月結與 billing usage page 可能依賴過時或不存在的 aggregate。

本輪新增 provider-neutral usage estimator 與 deterministic monthly snapshot。月結會直接讀取最新 server-owned estimate 並與 legacy record／immutable stream ledger 做保守 reconciliation；重跑同一 vendor／month 只更新固定 snapshot row，不會產生重複 billable record。

## 實際產品修正

- 新增 `src/lib/usage-estimation.ts`：嚴格驗證月份，從同一 vendor scope 的 server-owned records 估算：
  - delivered minutes：`StreamUsageLedgerEntry.watchSeconds`。
  - tracked events：月度 `AnalyticsEvent` count。
  - affiliates：在月份結束前建立且目前 active 的 `Affiliate` rows。
  - stored minutes：月份結束前建立且有正值 `Video.estimatedMinutes` 的總和。
- 新增固定 hash-based `UsageRecord` id 與 `monthly_usage_snapshot` record type；metadata 保存 schema version、產生時間與 source attribution。沒有新增 schema／migration，也沒有把 provider dashboard 數字冒充本機證據。
- `calculateSettlement` 將當前 estimate 與 legacy aggregate、immutable stream ledger 取保守最高值，避免新 read model 寫入後低報超額用量。
- `generateSettlementForVendor` 在產生月結前 upsert snapshot；billing usage page 也以本月 records 的 reconciled event／storage totals 顯示，而不是只取最新一筆可能較低的 record。

## 驗證結果

- usage estimation、billing settlement、billing-cycle 與 billing usage page：4 test files、39/39 PASS，0 failed、0 skipped。
- `src/app/actions.test.ts`：153/153 PASS，包含 settlement action 與原有 finance mutation regression。
- finance regression cohort：5 test files、60/60 PASS（payment webhook、invoice action、platform payout、platform payout action、tenant ledger invariants）。
- `npx tsc --noEmit`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS。
- `npx next build`：PASS；route manifest 包含 `/billing/usage` 與 `/api/jobs/billing-cycle`。

## 分數與未完成邊界

canonical readiness 維持 73.5：CAT01=7.5、CAT02=8.0、CAT03=8.0、CAT04=6.0、CAT05=8.5、CAT06=7.0、CAT07=9.0、CAT08=7.5、CAT09=7.5、CAT10=4.5；`current_goal_score_change=0`。

本輪沒有執行 Cloudflare provider query、PayUni Sandbox、staging、Production、正式付款／退款／寄信、deployment 或真人簽核；沒有重新計算 global coverage。CAT04 仍需要新的 authorized staging／PayUni Sandbox reconciliation receipt；CAT10 仍需要真人 merchant、客服、法務／隱私／退款、財務、release owner 與 external monitoring evidence。

## 安全與回滾

- 沒有讀取或輸出 `.env*` 內容、credential、token、cookie、正式 secret、正式客戶資料或付款資料。
- 沒有操作正式服務、正式資料庫、正式付款／退款、外部 payout 或不可逆操作。
- 沒有降低 coverage threshold、縮減 inventory、擴大 exclude、新增 skip、弱化 assertion 或資料驗證。
- FIN-08AA、WP-196、WP-197 terminal no-go 路徑沒有重試。
- 回滾限於本輪 usage estimation、billing integration、billing usage display、對應 tests 與本輪 evidence／control-plane metadata；既有 dirty worktree 變更全部保留。

## 下一步

繼續 FUNC-CLOSURE，選擇下一個尚未關閉且能改善販售流程的 P1；之後處理 CAT06 staging browser matrix、CAT10 operational／human evidence 與 QUAL coverage gate。外部與真人 evidence 仍依授權與 owner 提供，不以本機測試替代。
