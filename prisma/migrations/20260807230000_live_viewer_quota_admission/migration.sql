CREATE TABLE "LiveViewerSession" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveViewerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveViewerSession_tokenHash_key" ON "LiveViewerSession"("tokenHash");
CREATE INDEX "LiveViewerSession_vendorId_liveId_expiresAt_idx" ON "LiveViewerSession"("vendorId", "liveId", "expiresAt");
CREATE INDEX "LiveViewerSession_liveId_expiresAt_idx" ON "LiveViewerSession"("liveId", "expiresAt");

ALTER TABLE "LiveViewerSession" ADD CONSTRAINT "LiveViewerSession_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveViewerSession" ADD CONSTRAINT "LiveViewerSession_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
