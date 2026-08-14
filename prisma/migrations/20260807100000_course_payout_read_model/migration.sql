-- CreateTable
CREATE TABLE "CoursePayout" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "recipientMembershipId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "commissionAmountCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentAmountCents" INTEGER NOT NULL DEFAULT 0,
    "finalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "outcomeReference" TEXT,
    "outcomeReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoursePayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoursePayout_vendorId_id_key" ON "CoursePayout"("vendorId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CoursePayout_vendorId_recipientMembershipId_monthKey_key" ON "CoursePayout"("vendorId", "recipientMembershipId", "monthKey");

-- CreateIndex
CREATE INDEX "CoursePayout_vendorId_monthKey_status_idx" ON "CoursePayout"("vendorId", "monthKey", "status");

-- CreateIndex
CREATE INDEX "CoursePayout_vendorId_recipientMembershipId_createdAt_idx" ON "CoursePayout"("vendorId", "recipientMembershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "CoursePayout" ADD CONSTRAINT "CoursePayout_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePayout" ADD CONSTRAINT "CoursePayout_vendorId_recipientMembershipId_fkey" FOREIGN KEY ("vendorId", "recipientMembershipId") REFERENCES "TeamMembership"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
