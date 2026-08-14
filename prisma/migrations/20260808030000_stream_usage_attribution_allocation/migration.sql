-- FUNC-28: preserve provider-level stream usage while adding an immutable,
-- tenant-scoped internal attribution read model.
ALTER TABLE "StreamUsageLedgerEntry"
  ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "attributionMode" TEXT NOT NULL DEFAULT 'PROMOTER';

CREATE UNIQUE INDEX "StreamUsageLedgerEntry_vendorId_id_key"
  ON "StreamUsageLedgerEntry"("vendorId", "id");

CREATE TABLE "StreamUsageAllocationEntry" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "liveId" TEXT NOT NULL,
  "ledgerEntryId" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "recipientType" TEXT NOT NULL,
  "recipientTeamId" TEXT,
  "recipientMembershipId" TEXT,
  "allocationBps" INTEGER NOT NULL,
  "allocatedWatchSeconds" INTEGER NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "attributionMode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StreamUsageAllocationEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StreamUsageAllocationEntry_vendorId_ledgerEntryId_recipientKey_key"
  ON "StreamUsageAllocationEntry"("vendorId", "ledgerEntryId", "recipientKey");
CREATE UNIQUE INDEX "TeamMembership_vendorId_teamId_id_key"
  ON "TeamMembership"("vendorId", "teamId", "id");
CREATE INDEX "StreamUsageAllocationEntry_vendorId_monthKey_recipientKey_idx"
  ON "StreamUsageAllocationEntry"("vendorId", "monthKey", "recipientKey");
CREATE INDEX "StreamUsageAllocationEntry_recipientMembershipId_monthKey_idx"
  ON "StreamUsageAllocationEntry"("recipientMembershipId", "monthKey");

ALTER TABLE "StreamUsageAllocationEntry"
  ADD CONSTRAINT "StreamUsageAllocationEntry_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StreamUsageAllocationEntry_vendorId_liveId_fkey"
    FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StreamUsageAllocationEntry_vendorId_ledgerEntryId_fkey"
    FOREIGN KEY ("vendorId", "ledgerEntryId") REFERENCES "StreamUsageLedgerEntry"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StreamUsageAllocationEntry_vendorId_recipientTeamId_recipientMembershipId_fkey"
    FOREIGN KEY ("vendorId", "recipientTeamId", "recipientMembershipId") REFERENCES "TeamMembership"("vendorId", "teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
