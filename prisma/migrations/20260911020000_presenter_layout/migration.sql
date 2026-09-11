ALTER TABLE "Live" ADD COLUMN "presenterLayout" JSONB;
CREATE TABLE "LiveMediaSession" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "liveId" TEXT NOT NULL,
  "principal" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "resourcePath" TEXT NOT NULL,
  "closing" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveMediaSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LiveMediaSession_live_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LiveMediaSession_vendorId_liveId_principal_idx" ON "LiveMediaSession"("vendorId", "liveId", "principal");
CREATE INDEX "LiveMediaSession_expiresAt_idx" ON "LiveMediaSession"("expiresAt");
CREATE UNIQUE INDEX "LiveMediaSession_scope_key" ON "LiveMediaSession"("vendorId", "liveId", "principal", "direction");
