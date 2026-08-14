# FIN-2026-08-07-38｜平台推薦佣金首購限定閉環

## 結果

本輪完成一個真實的 finance／販售規則 P1：同一個新訂閱只在首次成功付款時產生平台推薦佣金；續費付款不會再次產生推薦佣金。退款、拒付與 dispute 仍沿用既有 commission ledger reversal／dispute lifecycle，不以第二筆續費佣金抵銷或掩蓋帳務狀態。

產品頁已明確顯示首購限定規則，避免商家把續費誤解為新的推薦銷售。服務層先以 subscription identity 做冪等檢查，並以資料庫 unique constraint 作為競態條件下的最後保護；既有 payment transaction idempotency 仍保留。

## 實作範圍

- `src/lib/platform-referral-commission.ts`
  - 同一 `subscriptionId` 已有 commission 時 fail-closed，不再累積續費 commission。
- `prisma/schema.prisma`
  - `PlatformReferralCommission.subscriptionId` 新增唯一約束。
- `prisma/migrations/20260807221000_platform_referral_initial_only/migration.sql`
  - 新增首購限定的資料庫唯一索引；若既有資料已存在重複 subscription rows，migration 會失敗而不靜默刪除或合併歷史資料。
- `prisma/migrations/20260807222000_affiliate_payout_gross_net_reference/migration.sql`
  - 回歸測試發現 `AffiliatePayout` schema 已使用 gross/net reference 欄位，但既有 migration 尚未建立欄位；以 additive、nullable migration 修正 disposable schema drift，保留 legacy payout 的未知狀態且不回填虛構歷史值。
- `src/app/(app)/billing/plans/page.tsx`
  - 顯示「每個新訂閱只計首次成功付款；續費不重複計算」產品規則。
- `src/lib/platform-referral-commission.test.ts`、`src/lib/payment-webhooks.test.ts` 與方案頁 source test
  - 覆蓋 domain、paid webhook renewal、頁面規則顯示與退款／dispute regression。

## 驗證

- focused domain／page：2 files／12 tests，12 passed、0 failed、0 skipped。
- platform referral payment webhook integration：2 tests passed，包含同一 subscription 的 renewal commission count 維持 1。
- broader finance regression：5 files／65 tests，65 passed、0 failed、0 skipped。
- `npx prisma validate`：PASS。
- `npx prisma generate`：PASS。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git diff --check`：未發現 whitespace error；Git 僅輸出既有 LF／CRLF conversion warnings。
- migration：PASS，兩個新 migration 僅部署至 `127.0.0.1:54329/celebratedeal_test` loopback disposable PostgreSQL；沒有 staging、PayUni、Production 或正式付款／退款操作。

## 分數與限制

- readiness truth：PASS；canonical total 仍為 73.5。
- CAT04=6.0、CAT10=4.5；sandbox_ready=false、production_ready=false。
- current Goal score change：0；本輪本機產品修正不冒充 staging、PayUni 或真人簽核證據。
- 最新 authoritative global coverage 仍為 statements／branches／functions／lines 42.36／48.07／51.11／61.68，門檻 63／57／60／65，`FAIL_REMAINING_SOURCE_INVENTORY`；本輪沒有降低 threshold、exclude、inventory、skip 或 assertion。
- 沒有讀取或輸出 `.env*`、credential、token、cookie、正式資料或付款資料；沒有重試 FIN-08AA、WP-196、WP-197，也沒有 push、merge 或 production deploy。
