-- WP1: retain the local Video status needed for a reversible soft archive.
-- Provider assets are deliberately untouched; the composite foreign key keeps
-- the archive record tenant-bound to its Video row.
CREATE TABLE "VideoArchiveState" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoArchiveState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoArchiveState_vendorId_videoId_key"
ON "VideoArchiveState"("vendorId", "videoId");

CREATE INDEX "VideoArchiveState_vendorId_previousStatus_idx"
ON "VideoArchiveState"("vendorId", "previousStatus");

ALTER TABLE "VideoArchiveState"
ADD CONSTRAINT "VideoArchiveState_vendorId_videoId_fkey"
FOREIGN KEY ("vendorId", "videoId") REFERENCES "Video"("vendorId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
