-- FUNC-29: bind an opaque, revocable Live promotion link to a specific
-- vendor/team/webinar/source page and target promoter. Raw tokens are never
-- persisted; only their SHA-256 digest is stored by the application.
CREATE TABLE "PartnerLiveShare" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "liveId" TEXT NOT NULL,
  "sourcePageId" TEXT NOT NULL,
  "promoterMembershipId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerLiveShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerLiveShare_tokenHash_key"
  ON "PartnerLiveShare"("tokenHash");
CREATE UNIQUE INDEX "PartnerLiveShare_vendorId_liveId_promoterMembershipId_key"
  ON "PartnerLiveShare"("vendorId", "liveId", "promoterMembershipId");
CREATE INDEX "PartnerLiveShare_vendorId_teamId_liveId_isEnabled_expiresAt_idx"
  ON "PartnerLiveShare"("vendorId", "teamId", "liveId", "isEnabled", "expiresAt");

ALTER TABLE "PartnerLiveShare"
  ADD CONSTRAINT "PartnerLiveShare_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PartnerLiveShare_vendorId_teamId_fkey"
    FOREIGN KEY ("vendorId", "teamId") REFERENCES "SalesTeam"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PartnerLiveShare_vendorId_liveId_fkey"
    FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PartnerLiveShare_vendorId_sourcePageId_fkey"
    FOREIGN KEY ("vendorId", "sourcePageId") REFERENCES "PartnerFunnelPage"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PartnerLiveShare_vendorId_teamId_promoterMembershipId_fkey"
    FOREIGN KEY ("vendorId", "teamId", "promoterMembershipId") REFERENCES "TeamMembership"("vendorId", "teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
