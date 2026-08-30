-- FIN-11: introduce a tenant-scoped, immutable course F/G allocation ledger.
-- Existing products remain merchant products. No historical payment is
-- backfilled because doing so would invent a policy snapshot that did not
-- exist at payment time.

ALTER TABLE "Product"
  ADD COLUMN "commerceDomain" TEXT NOT NULL DEFAULT 'merchant',
  ADD COLUMN "courseContentOwnerMembershipId" TEXT,
  ADD COLUMN "coursePromoterShareBps" INTEGER,
  ADD COLUMN "coursePolicyVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_commerceDomain_valid"
  CHECK ("commerceDomain" IN ('merchant', 'course')),
  ADD CONSTRAINT "Product_coursePolicyVersion_positive"
  CHECK ("coursePolicyVersion" > 0),
  ADD CONSTRAINT "Product_coursePromoterShareBps_valid"
  CHECK ("coursePromoterShareBps" IS NULL OR ("coursePromoterShareBps" BETWEEN 1 AND 9999));

CREATE UNIQUE INDEX "TeamMembership_vendorId_id_key"
  ON "TeamMembership"("vendorId", "id");

CREATE UNIQUE INDEX "TeamConversionAttribution_vendorId_id_key"
  ON "TeamConversionAttribution"("vendorId", "id");

CREATE INDEX "Product_vendorId_commerceDomain_isActive_idx"
  ON "Product"("vendorId", "commerceDomain", "isActive");

CREATE TYPE "CourseCommissionLedgerEntryType" AS ENUM (
  'opening_balance',
  'accrual',
  'refund',
  'reversal',
  'dispute_opened',
  'dispute_released',
  'dispute_lost'
);

CREATE TABLE "CourseCommissionAllocation" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "paymentTransactionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "teamConversionAttributionId" TEXT,
  "recipientMembershipId" TEXT NOT NULL,
  "recipientRole" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "grossAmountCents" INTEGER NOT NULL,
  "shareBps" INTEGER NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "deduplicationKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CourseCommissionAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseCommissionAllocation_vendorId_id_key" UNIQUE ("vendorId", "id"),
  CONSTRAINT "CourseCommissionAllocation_vendorId_paymentTransactionId_recipientRole_key" UNIQUE ("vendorId", "paymentTransactionId", "recipientRole"),
  CONSTRAINT "CourseCommissionAllocation_vendorId_deduplicationKey_key" UNIQUE ("vendorId", "deduplicationKey"),
  CONSTRAINT "CourseCommissionAllocation_recipientRole_valid" CHECK ("recipientRole" IN ('content_owner', 'promoter')),
  CONSTRAINT "CourseCommissionAllocation_policyVersion_positive" CHECK ("policyVersion" > 0),
  CONSTRAINT "CourseCommissionAllocation_amounts_valid" CHECK ("grossAmountCents" > 0 AND "shareBps" BETWEEN 1 AND 10000 AND "amountCents" > 0 AND "amountCents" <= "grossAmountCents")
);

CREATE INDEX "CourseCommissionAllocation_vendorId_recipientMembershipId_createdAt_idx"
  ON "CourseCommissionAllocation"("vendorId", "recipientMembershipId", "createdAt");

CREATE INDEX "CourseCommissionAllocation_vendorId_paymentTransactionId_idx"
  ON "CourseCommissionAllocation"("vendorId", "paymentTransactionId");

ALTER TABLE "CourseCommissionAllocation"
  ADD CONSTRAINT "CourseCommissionAllocation_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CourseCommissionAllocation_vendorId_paymentTransactionId_fkey"
  FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CourseCommissionAllocation_vendorId_productId_fkey"
  FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourseCommissionAllocation_vendorId_recipientMembershipId_fkey"
  FOREIGN KEY ("vendorId", "recipientMembershipId") REFERENCES "TeamMembership"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourseCommissionAllocation_vendorId_teamConversionAttributionId_fkey"
  FOREIGN KEY ("vendorId", "teamConversionAttributionId") REFERENCES "TeamConversionAttribution"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_vendorId_courseContentOwnerMembershipId_fkey"
  FOREIGN KEY ("vendorId", "courseContentOwnerMembershipId") REFERENCES "TeamMembership"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CourseCommissionLedgerEntry" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "courseCommissionAllocationId" TEXT NOT NULL,
  "entryType" "CourseCommissionLedgerEntryType" NOT NULL,
  "deduplicationKey" TEXT NOT NULL,
  "providerName" TEXT NOT NULL,
  "eventIdentity" TEXT NOT NULL,
  "disputeCaseId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CourseCommissionLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseCommissionLedgerEntry_vendorId_deduplicationKey_key" UNIQUE ("vendorId", "deduplicationKey"),
  CONSTRAINT "CourseCommissionLedgerEntry_amount_direction_valid" CHECK (
    ("entryType" = 'opening_balance')
    OR ("entryType" = 'accrual' AND "amountCents" > 0)
    OR ("entryType" IN ('refund', 'reversal', 'dispute_lost') AND "amountCents" < 0)
    OR ("entryType" IN ('dispute_opened', 'dispute_released') AND "amountCents" = 0)
  )
);

CREATE INDEX "CourseCommissionLedger_v_c_a_created_idx"
  ON "CourseCommissionLedgerEntry"("vendorId", "courseCommissionAllocationId", "createdAt");

CREATE INDEX "CourseCommissionLedger_v_c_a_case_idx"
  ON "CourseCommissionLedgerEntry"("vendorId", "courseCommissionAllocationId", "disputeCaseId");

ALTER TABLE "CourseCommissionLedgerEntry"
  ADD CONSTRAINT "CourseCommissionLedgerEntry_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourseCommissionLedgerEntry_vendorId_courseCommissionAllocationId_fkey"
  FOREIGN KEY ("vendorId", "courseCommissionAllocationId") REFERENCES "CourseCommissionAllocation"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
