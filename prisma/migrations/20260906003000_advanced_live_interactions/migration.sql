-- Additive prelaunch schema for draw entries, poll votes, and voucher claims.
CREATE TABLE "LiveInteractionRun" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "winnerResponseId" TEXT,
    "createdByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiveInteractionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveInteractionResponse" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "participantHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "displayName" TEXT,
    "claimTokenHash" TEXT,
    "productId" TEXT,
    "discountAmountCents" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "usedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveInteractionResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveInteractionRun_liveId_sourceEventId_key" ON "LiveInteractionRun"("liveId", "sourceEventId");
CREATE UNIQUE INDEX "LiveInteractionRun_vendorId_id_key" ON "LiveInteractionRun"("vendorId", "id");
CREATE INDEX "LiveInteractionRun_vendorId_liveId_status_endsAt_idx" ON "LiveInteractionRun"("vendorId", "liveId", "status", "endsAt");
CREATE UNIQUE INDEX "LiveInteractionResponse_claimTokenHash_key" ON "LiveInteractionResponse"("claimTokenHash");
CREATE UNIQUE INDEX "LiveInteractionResponse_runId_participantHash_key" ON "LiveInteractionResponse"("runId", "participantHash");
CREATE INDEX "LiveInteractionResponse_vendorId_liveId_eventType_createdAt_idx" ON "LiveInteractionResponse"("vendorId", "liveId", "eventType", "createdAt");
CREATE INDEX "LiveInteractionResponse_usedOrderId_idx" ON "LiveInteractionResponse"("usedOrderId");

ALTER TABLE "LiveInteractionRun" ADD CONSTRAINT "LiveInteractionRun_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveInteractionRun" ADD CONSTRAINT "LiveInteractionRun_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveInteractionResponse" ADD CONSTRAINT "LiveInteractionResponse_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveInteractionResponse" ADD CONSTRAINT "LiveInteractionResponse_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveInteractionResponse" ADD CONSTRAINT "LiveInteractionResponse_vendorId_runId_fkey" FOREIGN KEY ("vendorId", "runId") REFERENCES "LiveInteractionRun"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
