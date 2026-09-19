-- Tenant-bound viewer Q&A. Participant identity is stored only as a hash.
CREATE TYPE "LiveQuestionStatus" AS ENUM ('pending', 'spotlight', 'answered', 'hidden');

CREATE TABLE "LiveQuestion" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "participantHash" TEXT NOT NULL,
    "displayName" TEXT,
    "body" TEXT NOT NULL,
    "status" "LiveQuestionStatus" NOT NULL DEFAULT 'pending',
    "spotlightedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiveQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveQuestion_vendorId_liveId_status_createdAt_idx"
  ON "LiveQuestion"("vendorId", "liveId", "status", "createdAt");
CREATE INDEX "LiveQuestion_liveId_participantHash_createdAt_idx"
  ON "LiveQuestion"("liveId", "participantHash", "createdAt");

-- Prisma cannot model a partial unique index. This makes concurrent spotlight
-- transitions fail closed: a live can have at most one spotlight row.
CREATE UNIQUE INDEX "LiveQuestion_one_spotlight_per_live_key"
  ON "LiveQuestion"("liveId")
  WHERE "status" = 'spotlight';

ALTER TABLE "LiveQuestion"
  ADD CONSTRAINT "LiveQuestion_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveQuestion"
  ADD CONSTRAINT "LiveQuestion_vendorId_liveId_fkey"
  FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
