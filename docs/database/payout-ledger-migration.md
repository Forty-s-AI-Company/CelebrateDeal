# Payout Ledger Migration Preflight and Rollback

適用 migrations：

- `20260710171500_payout_settlement_uniqueness`
- `20260711053000_affiliate_payout_ledger`
- `20260711060000_financial_integrity_hardening`
- `20260711063000_payment_booking_period`
- `20260711064500_settlement_carry_ledger`
- `20260711065500_fee_refund_caps_and_legacy_preflight`
- `20260711070000_refund_counter_trigger`
- `20260711071000_refund_counter_status_semantics`
- `20260711072000_historical_fee_snapshot_preflight`
- `20260711073000_refund_record_tenant_fk`

## Preflight

在 staging／production migration 前，以 read-only SQL 執行：

```sql
SELECT "settlementId", COUNT(*)
FROM "PayoutItem"
WHERE "settlementId" IS NOT NULL
GROUP BY "settlementId"
HAVING COUNT(*) > 1;

SELECT "vendorId", "affiliateId", "monthKey", COUNT(*)
FROM "AffiliatePayout"
WHERE "affiliateId" IS NOT NULL
GROUP BY "vendorId", "affiliateId", "monthKey"
HAVING COUNT(*) > 1;

SELECT commission."id"
FROM "AffiliateCommission" commission
JOIN "Affiliate" affiliate ON affiliate."id" = commission."affiliateId"
WHERE commission."affiliateId" IS NOT NULL
  AND commission."vendorId" <> affiliate."vendorId";

SELECT payout."id"
FROM "AffiliatePayout" payout
JOIN "Affiliate" affiliate ON affiliate."id" = payout."affiliateId"
WHERE payout."affiliateId" IS NOT NULL
  AND payout."vendorId" <> affiliate."vendorId";
```

兩個查詢都必須回傳 0 rows。`affiliate_payout_ledger` migration 本身也包含第二個檢查，遇到重複會中止，不會自動刪除或合併財務資料。

執行 migration 前必須建立 Supabase snapshot，記錄 row counts：

```sql
SELECT COUNT(*) FROM "Settlement";
SELECT COUNT(*) FROM "PayoutItem";
SELECT COUNT(*) FROM "AffiliateCommission";
SELECT COUNT(*) FROM "AffiliatePayout";
```

## Safe Rollback Boundary

若 migration 已套用，但新版 app 尚未寫入 `affiliatePayoutId`、`approvedAt`、`reversedAt`：

```sql
ALTER TABLE "AffiliateCommission" DROP CONSTRAINT IF EXISTS "AffiliateCommission_affiliatePayoutId_vendorId_fkey";
ALTER TABLE "AffiliateCommission" DROP CONSTRAINT IF EXISTS "AffiliateCommission_affiliateId_vendorId_fkey";
ALTER TABLE "AffiliatePayout" DROP CONSTRAINT IF EXISTS "AffiliatePayout_affiliateId_vendorId_fkey";
ALTER TABLE "TrackingSetting" DROP CONSTRAINT IF EXISTS "TrackingSetting_attributionPolicy_check";
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
DROP INDEX IF EXISTS "AffiliateCommission_affiliatePayoutId_idx";
DROP INDEX IF EXISTS "AffiliatePayout_vendorId_affiliateId_monthKey_key";
DROP INDEX IF EXISTS "AffiliatePayout_id_vendorId_key";
ALTER TABLE "AffiliateCommission" DROP COLUMN IF EXISTS "affiliatePayoutId", DROP COLUMN IF EXISTS "reversedAt";
ALTER TABLE "AffiliatePayout" DROP COLUMN IF EXISTS "approvedAt", DROP COLUMN IF EXISTS "reversedAt";
DROP INDEX IF EXISTS "PayoutItem_settlementId_key";
```

注意：`void → reversed` 的狀態更新不是可無損反轉；如需回到舊 app，可讓舊 app 將 `reversed` 視為終態，或由 snapshot restore。

## After New Ledger Writes

只要已有 AffiliatePayout 或 commission relation 被新版 app 寫入，禁止直接 drop columns/index。處理順序：

1. 停止財務 mutation job 與 admin 操作。
2. 優先 rollback app deployment，但保留 additive DB schema。
3. 以 audit log 和 payout relation 執行 forward fix。
4. 只有資料不可修復時，依 snapshot restore drill 還原整個 database。

任何 duplicate reconciliation、paid/reversed 狀態修改或 snapshot restore 都需要平台財務負責人人工簽核。

## Payment Booking 與退款 Carry Ledger

`payment_booking_period` 新增 nullable `PaymentTransaction.bookingMonthKey` 與索引；`settlement_carry_ledger` 新增 non-null、default 0 的 `carryInAmountCents`／`carryForwardAmountCents`。兩者均為 additive schema，app rollback 時保留欄位，舊版程式會忽略它們，不應直接 drop column。

carry migration 會在發現既有 locked settlement 的 `finalPayoutAmountCents < 0` 時中止。這類資料必須先依 payment、refund、commission 與 payout audit 做人工 reconciliation，不可用 migration 自動歸零。

新版寫入後的負餘額處理：

1. 當期 signed payout balance 小於 0 時，`finalPayoutAmountCents` 固定為 0，負值寫入 `carryForwardAmountCents`。
2. 下一期只能按月份順序 lock，並在 lock transaction 內重新計算 `carryInAmountCents`。
3. payout batch 只接受 `finalPayoutAmountCents > 0`，不會把負餘額當成出款。
4. 如需移除 carry 欄位，必須先證明所有 settlement 的 carry in/out 都為 0 且尚未由新版 app 寫入；否則只能 app rollback、forward fix 或 snapshot restore。

`fee_refund_caps_and_legacy_preflight` 使用明確 `BEGIN/COMMIT`，對任何「已鎖期間 + processed refund」的舊資料 fail closed，要求先做 signed-ledger reconciliation；同時由 server-side 方案費率回填 immutable platform fee snapshot、backfill gateway/platform fee refund 累計值，並以 DB CHECK 保證本金與累計退款費用不超過原交易實收快照。

`refund_counter_trigger` 與後續 status semantics migration 讓 `RefundRecord` 成為退款帳本真相來源。INSERT／UPDATE／DELETE trigger 只計入 `processed` 記錄，並同步 PaymentTransaction 的 principal/gateway/platform counters；即使直接 SQL、Prisma 寫入或切換狀態，也無法繞過 transaction CHECK。

### Read-only Reconciliation

```sql
SELECT transaction."id", transaction."orderNumber",
       transaction."refundedAmountCents", COALESCE(SUM(refund."refundAmountCents"), 0) AS ledger_principal,
       transaction."refundedGatewayFeeCents", COALESCE(SUM(refund."gatewayFeeRefundCents"), 0) AS ledger_gateway,
       transaction."refundedPlatformFeeCents", COALESCE(SUM(refund."platformFeeRefundCents"), 0) AS ledger_platform
FROM "PaymentTransaction" transaction
LEFT JOIN "RefundRecord" refund
  ON refund."paymentTransactionId" = transaction."id" AND refund."status" = 'processed'
GROUP BY transaction."id"
HAVING transaction."refundedAmountCents" <> COALESCE(SUM(refund."refundAmountCents"), 0)
    OR transaction."refundedGatewayFeeCents" <> COALESCE(SUM(refund."gatewayFeeRefundCents"), 0)
    OR transaction."refundedPlatformFeeCents" <> COALESCE(SUM(refund."platformFeeRefundCents"), 0);
```

必須回傳 0 rows。另行檢查 refund aggregate 不得超過 gross/gateway/platform snapshots。

### Failed Migration Recovery

1. 保持 app maintenance mode，不接受 payment/refund webhook。
2. 確認 snapshot 可用，保存 `prisma migrate status` 與 migration error。
3. 因 0655 為 atomic transaction，失敗後 counter columns、snapshot backfill、constraints 與 trigger 都不應存在；先以 `information_schema` 驗證，不可猜測。
4. 修正 legacy ledger 需平台財務簽核；禁止直接改 locked settlement。使用 append-only adjustment 或 snapshot restore。
5. 確認資料一致後執行 `prisma migrate resolve --rolled-back 20260711065500_fee_refund_caps_and_legacy_preflight`，再重跑 deploy。
6. deploy 後執行上方 reconciliation、constraint/trigger existence check 與 sandbox refund replay。

## 2026-07-11 Disposable PostgreSQL Drill

- 從空白暫存 DB 成功套用 25 筆 migrations；status semantics migration 為 trigger 的 additive replacement。
- `npm run db:migrate:status` 回報 schema up to date。
- payout rollback SQL 成功恢復 baseline `AffiliateCommission_affiliateId_fkey` 與 `AffiliatePayout_affiliateId_fkey`。
- additive carry 欄位在 app rollback 邊界保留並驗證存在。
- 暫存 DB `celebratedeal_rollback_drill_20260711` 已移除，未碰觸本機開發 DB。
- 負向 drill 模擬舊版 locked settlement 含 processed refund；deploy 如預期以 `P3018 / P0001` 中止並輸出 reconciliation 錯誤，暫存 DB `celebratedeal_legacy_preflight_drill_20260711` 已移除。
- atomic failure drill 模擬歷史 fee aggregate 超額；0655 在 backfill 後失敗，驗證 counter columns 數量為 0、platform fee snapshot 保持原值，證明 transaction 完整 rollback；暫存 DB `celebratedeal_atomic_migration_drill_20260711` 已移除。
- 0630 atomic drill 刻意製造 index name conflict；ADD COLUMN／backfill 後 CREATE INDEX 失敗，驗證 `bookingMonthKey` 欄位數量為 0，可安全重跑；暫存 DB 已移除。
- missing-subscription drill 植入沒有有效歷史訂閱的 platform paid transaction；0720 如預期 fail closed，原 `platformFeeCents=777` 保持不變；暫存 DB 已移除。
- 0730 以 composite `(paymentTransactionId, vendorId)` FK 封閉 RefundRecord 跨租戶關聯，migration 前會先中止既有 mismatch。
