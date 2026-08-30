# FUNC-2026-08-07-37｜課程 gross／net reference 功能閉環

## 結果

本輪完成一個真實的課程 finance P1，而不是只增加測試數量：課程 payout read model 現在把「按售價計算的 gross sales base」、「退款／費用調整後的 provider-net reference」與「實際 F/G payable」分開保存與顯示。

F/G 同一筆付款會產生兩個 allocation row；reference summary 會依 `paymentTransactionId` 去重，避免同一筆售價與 provider-net 被 F、G 重複加總。已處理退款的 gateway/platform fee refund 依既有 net-reference 規則加回；這個 reference 不會改寫 gross commission base 或 immutable commission ledger。

既有 payout 若在這個 contract 以前建立，gross/net 欄位保持 `null` 並在 UI 顯示未知，不以 0 冒充歷史資料。已完成或人工 paid 的 payout 若新的 source reference 與已保存 snapshot 不一致，系統 fail closed，不會靜默重算。

## 實作範圍

- `src/lib/course-payout-accounting.ts`
  - 依付款交易去重計算 gross sales base 與 net reference。
  - pending payout 同步／退款 reconciliation 保存 reference snapshot。
  - paid／void payout 的金額或已存在 reference 不一致時拒絕重算。
- `src/lib/payment-net-reference.ts`
  - 抽出共用、display-only 的 provider-net reference 計算，避免 payment refund 與 course payout circular import。
- `src/lib/payment-refund-accounting.ts`
  - 保留既有 export contract，改由共用純函式提供 net reference 計算。
- `src/app/admin/billing/course-payouts/page.tsx`
  - 分開顯示 Gross 分潤基礎、Net 參考與 Payable，並標示 net 僅供 provider reference。
- `prisma/schema.prisma`
  - `CoursePayout.grossSalesAmountCents` 與 `CoursePayout.netReferenceAmountCents` 為 nullable，保留舊 payout 的未知狀態。
- `prisma/migrations/20260807220000_course_gross_net_reference/migration.sql`
  - 新增上述兩個 nullable 欄位；沒有回填不存在的歷史 snapshot。

## 驗證

- focused Vitest：4 files／10 tests，10 passed、0 failed、0 skipped。
- 覆蓋案例：F/G allocation 去重、退款本金與可退 fee reference、pending payout 更新、paid payout fail-closed、課程付款 webhook／退款 regression、finance admin page gross/net/payable rendering。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git diff --check`：PASS。
- `npx prisma generate`：PASS。
- migration：PASS，僅對 `127.0.0.1:54329/celebratedeal_test` loopback disposable PostgreSQL deploy；沒有 staging、PayUni、Production 或正式付款／退款操作。

## 分數與限制

- readiness truth：PASS；canonical total 仍為 73.5。
- CAT04=6.0、CAT10=4.5；sandbox_ready=false、production_ready=false。
- current Goal score change：0；本輪本機功能修正不冒充外部驗收或真人簽核。
- 最新 authoritative global coverage 仍為 statements／branches／functions／lines 42.36／48.07／51.11／61.68，門檻 63／57／60／65，`FAIL_REMAINING_SOURCE_INVENTORY`；本輪沒有降低 threshold、exclude、inventory、skip 或 assertion。
- 沒有讀取或輸出 `.env*`、credential、token、cookie、正式資料或付款資料；沒有重試 FIN-08AA、WP-196、WP-197。
