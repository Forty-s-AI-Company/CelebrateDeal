ALTER TABLE "PlatformReferralCommissionLedgerEntry"
ADD COLUMN "disputeCaseId" TEXT;

CREATE INDEX "prc_ledger_comm_dispute_idx"
ON "PlatformReferralCommissionLedgerEntry"("platformReferralCommissionId", "disputeCaseId");
