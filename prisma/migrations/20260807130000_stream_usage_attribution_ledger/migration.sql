CREATE TABLE "StreamUsageLedgerEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "sourcePageId" TEXT,
    "teamId" TEXT,
    "templateVersionId" TEXT,
    "promoterMembershipId" TEXT,
    "contentOwnerMembershipId" TEXT,
    "eventId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "watchSeconds" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DIRECT_PLAYBACK',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamUsageLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StreamUsageLedgerEntry_eventId_key" ON "StreamUsageLedgerEntry"("eventId");
CREATE INDEX "StreamUsageLedgerEntry_vendorId_monthKey_idx" ON "StreamUsageLedgerEntry"("vendorId", "monthKey");
CREATE INDEX "StreamUsageLedgerEntry_sourcePageId_monthKey_idx" ON "StreamUsageLedgerEntry"("sourcePageId", "monthKey");
CREATE INDEX "StreamUsageLedgerEntry_promoterMembershipId_monthKey_idx" ON "StreamUsageLedgerEntry"("promoterMembershipId", "monthKey");
CREATE INDEX "StreamUsageLedgerEntry_liveId_capturedAt_idx" ON "StreamUsageLedgerEntry"("liveId", "capturedAt");

ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "PartnerFunnelPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TeamFunnelTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_promoterMembershipId_fkey" FOREIGN KEY ("promoterMembershipId") REFERENCES "TeamMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_contentOwnerMembershipId_fkey" FOREIGN KEY ("contentOwnerMembershipId") REFERENCES "TeamMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
