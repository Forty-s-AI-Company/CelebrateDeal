# Payment Ledger Idempotency Migration

## Preflight

在 staging migration 前先確認沒有既有重複資料：

```sql
SELECT "providerName", "orderNumber", COUNT(*)
FROM "PaymentTransaction"
WHERE "orderNumber" IS NOT NULL
GROUP BY 1, 2 HAVING COUNT(*) > 1;

SELECT "paymentTransactionId", "providerEventId", COUNT(*)
FROM "RefundRecord"
WHERE "providerEventId" IS NOT NULL
GROUP BY 1, 2 HAVING COUNT(*) > 1;

SELECT "vendorId", "sourceType", "sourceId", COUNT(*)
FROM "AffiliateCommission"
WHERE "sourceId" IS NOT NULL
GROUP BY 1, 2, 3 HAVING COUNT(*) > 1;

SELECT pt.id, pt."orderNumber", pt."grossAmountCents", pt."refundedAmountCents",
       COALESCE(SUM(rr."refundAmountCents"), 0) AS refund_record_total
FROM "PaymentTransaction" pt
LEFT JOIN "RefundRecord" rr ON rr."paymentTransactionId" = pt.id
GROUP BY pt.id
HAVING pt."refundedAmountCents" > pt."grossAmountCents"
    OR pt."refundedAmountCents" <> COALESCE(SUM(rr."refundAmountCents"), 0);

SELECT legacy.id AS legacy_id, current.id AS current_id, legacy."sourceId"
FROM "AffiliateCommission" legacy
JOIN "AffiliateCommission" current
  ON current."vendorId" = legacy."vendorId"
 AND current."sourceId" = legacy."sourceId"
 AND current."sourceType" = 'payment'
WHERE legacy."sourceType" = 'webhook';
```

任一查詢有結果時停止 migration，先由財務人員依 webhook、refund 與 audit evidence 合併資料，不得自動刪除。

## Rollback

Rollback 只移除約束，不回滾或刪除交易資料：

```sql
ALTER TABLE "PaymentTransaction" DROP CONSTRAINT IF EXISTS "PaymentTransaction_refund_not_over_gross";
DROP INDEX IF EXISTS "AffiliateCommission_vendorId_sourceType_sourceId_key";
DROP INDEX IF EXISTS "RefundRecord_paymentTransactionId_providerEventId_key";
DROP INDEX IF EXISTS "PaymentTransaction_providerName_orderNumber_key";
```
