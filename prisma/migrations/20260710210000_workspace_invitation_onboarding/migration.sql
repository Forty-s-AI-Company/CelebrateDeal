-- Add persisted onboarding state and one-time, hashed workspace invitations.
-- Existing vendors are backfilled as completed so this additive migration does not
-- interrupt established workspaces.
ALTER TABLE "Vendor"
ADD COLUMN "onboardingStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

UPDATE "Vendor"
SET
  "onboardingStatus" = 'completed',
  "onboardingCompletedAt" = COALESCE("onboardingCompletedAt", CURRENT_TIMESTAMP);

CREATE TABLE "VendorInvitation" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "invitedByUserId" TEXT NOT NULL,
  "acceptedByUserId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VendorInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorInvitation_tokenHash_key" ON "VendorInvitation"("tokenHash");
CREATE UNIQUE INDEX "VendorInvitation_vendorId_email_key" ON "VendorInvitation"("vendorId", "email");
CREATE INDEX "VendorInvitation_vendorId_acceptedAt_revokedAt_idx" ON "VendorInvitation"("vendorId", "acceptedAt", "revokedAt");
CREATE INDEX "VendorInvitation_expiresAt_idx" ON "VendorInvitation"("expiresAt");

ALTER TABLE "VendorInvitation"
ADD CONSTRAINT "VendorInvitation_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorInvitation"
ADD CONSTRAINT "VendorInvitation_invitedByUserId_fkey"
FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendorInvitation"
ADD CONSTRAINT "VendorInvitation_acceptedByUserId_fkey"
FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rollback (only before downstream data depends on these fields):
-- DROP TABLE "VendorInvitation";
-- ALTER TABLE "Vendor" DROP COLUMN "onboardingCompletedAt", DROP COLUMN "onboardingStatus";
