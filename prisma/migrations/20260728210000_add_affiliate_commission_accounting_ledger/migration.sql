-- WP-14 is forward-only. Existing commission rows receive a cutover snapshot,
-- not reconstructed historical refund or dispute events.
CREATE TYPE "AffiliateCommissionLedgerEntryType" AS ENUM (
  'opening_balance', 'accrual', 'refund', 'reversal',
  'dispute_opened', 'dispute_released', 'dispute_lost'
);

-- The composite tenant key must exist before the ledger FK is declared.
CREATE UNIQUE INDEX "AffiliateCommission_vendorId_id_key"
  ON "AffiliateCommission"("vendorId", "id");

CREATE TABLE "AffiliateCommissionLedgerEntry" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "affiliateCommissionId" TEXT NOT NULL,
  "entryType" "AffiliateCommissionLedgerEntryType" NOT NULL,
  "deduplicationKey" TEXT NOT NULL,
  "providerName" TEXT NOT NULL,
  "eventIdentity" TEXT NOT NULL,
  "disputeCaseId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateCommissionLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateCommissionLedgerEntry_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateCommissionLedgerEntry_vendorId_affiliateCommissionId_fkey"
    FOREIGN KEY ("vendorId", "affiliateCommissionId")
    REFERENCES "AffiliateCommission"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AffiliateCommissionLedgerEntry_deduplicationKey_nonblank"
    CHECK (btrim("deduplicationKey") <> ''),
  CONSTRAINT "AffiliateCommissionLedgerEntry_providerName_nonblank"
    CHECK (btrim("providerName") <> ''),
  CONSTRAINT "AffiliateCommissionLedgerEntry_eventIdentity_nonblank"
    CHECK (btrim("eventIdentity") <> ''),
  CONSTRAINT "AffiliateCommissionLedgerEntry_dispute_case_required"
    CHECK (
      ("entryType" IN ('dispute_opened', 'dispute_released', 'dispute_lost') AND btrim(coalesce("disputeCaseId", '')) <> '')
      OR "entryType" NOT IN ('dispute_opened', 'dispute_released', 'dispute_lost')
    ),
  CONSTRAINT "AffiliateCommissionLedgerEntry_amount_direction"
    CHECK (
      ("entryType" = 'opening_balance')
      OR ("entryType" = 'accrual' AND "amountCents" > 0)
      OR ("entryType" IN ('refund', 'reversal', 'dispute_lost') AND "amountCents" < 0)
      OR ("entryType" IN ('dispute_opened', 'dispute_released') AND "amountCents" = 0)
    )
);

CREATE UNIQUE INDEX "AffiliateCommissionLedgerEntry_vendorId_deduplicationKey_key"
  ON "AffiliateCommissionLedgerEntry"("vendorId", "deduplicationKey");
CREATE INDEX "AffiliateCommissionLedger_v_c_created_idx"
  ON "AffiliateCommissionLedgerEntry"("vendorId", "affiliateCommissionId", "createdAt");
CREATE INDEX "AffiliateCommissionLedger_v_c_case_idx"
  ON "AffiliateCommissionLedgerEntry"("vendorId", "affiliateCommissionId", "disputeCaseId");

-- Snapshot the exact cutover balance. A NOT EXISTS guard makes an interrupted
-- backfill safe to re-run without inventing a second opening balance.
INSERT INTO "AffiliateCommissionLedgerEntry" (
  "id", "vendorId", "affiliateCommissionId", "entryType", "deduplicationKey",
  "providerName", "eventIdentity", "amountCents", "occurredAt"
)
SELECT
  'opening_' || "id", "vendorId", "id", 'opening_balance',
  'commission-ledger:v1|opening:' || "id", 'migration', 'opening:' || "id",
  "commissionAmountCents", "attributedAt"
FROM "AffiliateCommission" commission
WHERE NOT EXISTS (
  SELECT 1 FROM "AffiliateCommissionLedgerEntry" entry
  WHERE entry."vendorId" = commission."vendorId"
    AND entry."deduplicationKey" = 'commission-ledger:v1|opening:' || commission."id"
);

CREATE OR REPLACE FUNCTION "AffiliateCommissionLedgerEntry_reject_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AffiliateCommissionLedgerEntry is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AffiliateCommissionLedgerEntry_reject_update"
BEFORE UPDATE ON "AffiliateCommissionLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "AffiliateCommissionLedgerEntry_reject_mutation"();

CREATE TRIGGER "AffiliateCommissionLedgerEntry_reject_delete"
BEFORE DELETE ON "AffiliateCommissionLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "AffiliateCommissionLedgerEntry_reject_mutation"();
