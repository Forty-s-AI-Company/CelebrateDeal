-- Additive server-side Live Studio recovery snapshots with optimistic revision.
CREATE TABLE "LiveStudioDraft" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT,
    "payload" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedByMemberId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveStudioDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveStudioDraft_vendorId_id_key" ON "LiveStudioDraft"("vendorId", "id");
CREATE UNIQUE INDEX "LiveStudioDraft_vendorId_liveId_key" ON "LiveStudioDraft"("vendorId", "liveId");
CREATE INDEX "LiveStudioDraft_vendorId_consumedAt_expiresAt_updatedAt_idx"
  ON "LiveStudioDraft"("vendorId", "consumedAt", "expiresAt", "updatedAt");

ALTER TABLE "LiveStudioDraft" ADD CONSTRAINT "LiveStudioDraft_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveStudioDraft" ADD CONSTRAINT "LiveStudioDraft_liveId_fkey"
  FOREIGN KEY ("liveId") REFERENCES "Live"("id") ON DELETE SET NULL ON UPDATE CASCADE;
