# WP-96 — 背景維護 Job 失敗隔離

日期：2026-07-30  
類別：CAT-08 效能、可靠性、Log、監控與追蹤  
狀態：`ACCEPTED`

## 修正的失敗模式

`POST /api/jobs/webhook-retry` 原本依序執行庫存 reservation cleanup 與 webhook retry；前者一旦丟出例外，後者完全不會被嘗試。此修正維持原本的順序與單一資料庫工作負載，但將兩個子工作隔離：任一個失敗後，另一個仍會執行。

- 兩項工作成功：維持既有 `200` success response。
- 任一工作失敗：回傳 `503`、固定 failure identifier、成功子工作的 bounded 統計與安全空值。
- 失敗 response 不序列化 raw exception、webhook event ID、URL、secret、交易或客戶資料。
- `captureOperationalError` 僅取得固定 allowlisted context；monitoring 自身失敗不會阻止另一個子工作，且 HTTP 仍 fail-closed。

## Deterministic evidence

- `npx vitest run src/app/api/jobs/webhook-retry/route.test.ts src/lib/monitoring.test.ts src/lib/webhook-retry.test.ts`：3 files、25 tests passed。
- `npx eslint src/app/api/jobs/webhook-retry/route.ts src/app/api/jobs/webhook-retry/route.test.ts`：PASS。
- `npx tsc --noEmit`：PASS。
- `npm run lint`：PASS。
- `npm test`：exit code 0。
- `git diff --check`：PASS；staged index 為空。

Route tests 覆蓋：未授權、完整成功、inventory failure、webhook failure、雙重 failure、monitoring failure；每個失敗場景都驗證 webhook recovery 仍被嘗試、HTTP 503、固定 identifier 與序列化結果不含測試 secret 或 event identifier。

## Ownership 與 rollback

唯一產品 owned paths：

- `src/app/api/jobs/webhook-retry/route.ts`
- `src/app/api/jobs/webhook-retry/route.test.ts`

`src/lib/webhook-retry.ts`、inventory、monitoring、API security、Prisma、package 與 dashboard 都是 `PRESERVE_ONLY`；pre/post SHA-256 一致。回滾只可對上述兩個 owned paths 做反向 patch，禁止 reset、checkout、stash 或修改 preserve-only 檔案。

## Score boundary

這是 CAT-08 `5.0 → 5.5` 的候選證據；Sol acceptance 後才正式調分。它不證明 production scheduler、external telemetry delivery、Browser performance 或完整 CAT-08 7.5。

## Acceptance

- Sol High verdict：`ACCEPT`；CAT-08 由 5.0 更新為 5.5。
- AGY Fast：`QA_RECEIPT_UNAVAILABLE_AFTER_2_ATTEMPTS`。它沒有被標示為 PASS，也沒有取代 deterministic tests。
- 這次加分只反映已驗證的 maintenance-job failure isolation；production scheduler、external telemetry delivery、Browser performance 與 CAT-08 7.5 仍為未完成項目。
