-- Platform plan referral domain is intentionally separate from vendor affiliates.
CREATE TABLE "PlatformReferralCode" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformReferralCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralClick" (
    "id" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "landingPath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformReferralClick_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralAttribution" (
    "id" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "clickId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "codeSnapshot" TEXT NOT NULL,
    "commissionRateBpsSnapshot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformReferralAttribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformReferralCode_code_key" ON "PlatformReferralCode"("code");
CREATE UNIQUE INDEX "PlatformReferralCode_ownerUserId_id_key" ON "PlatformReferralCode"("ownerUserId", "id");
CREATE INDEX "PlatformReferralCode_ownerUserId_isActive_idx" ON "PlatformReferralCode"("ownerUserId", "isActive");

CREATE UNIQUE INDEX "PlatformReferralClick_referralCodeId_id_key" ON "PlatformReferralClick"("referralCodeId", "id");
CREATE INDEX "PlatformReferralClick_visitorId_createdAt_idx" ON "PlatformReferralClick"("visitorId", "createdAt");
CREATE INDEX "PlatformReferralClick_referralCodeId_expiresAt_idx" ON "PlatformReferralClick"("referralCodeId", "expiresAt");

CREATE UNIQUE INDEX "PlatformReferralAttribution_subscriptionId_key" ON "PlatformReferralAttribution"("subscriptionId");
CREATE UNIQUE INDEX "PlatformReferralAttribution_referralCodeId_clickId_key" ON "PlatformReferralAttribution"("referralCodeId", "clickId");
CREATE INDEX "PlatformReferralAttribution_ownerUserId_createdAt_idx" ON "PlatformReferralAttribution"("ownerUserId", "createdAt");
CREATE INDEX "PlatformReferralAttribution_referralCodeId_createdAt_idx" ON "PlatformReferralAttribution"("referralCodeId", "createdAt");

ALTER TABLE "PlatformReferralCode" ADD CONSTRAINT "PlatformReferralCode_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformReferralClick" ADD CONSTRAINT "PlatformReferralClick_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "PlatformReferralCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformReferralAttribution" ADD CONSTRAINT "PlatformReferralAttribution_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "PlatformReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformReferralAttribution" ADD CONSTRAINT "PlatformReferralAttribution_referralCodeId_clickId_fkey" FOREIGN KEY ("referralCodeId", "clickId") REFERENCES "PlatformReferralClick"("referralCodeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformReferralAttribution" ADD CONSTRAINT "PlatformReferralAttribution_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "VendorSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformReferralAttribution" ADD CONSTRAINT "PlatformReferralAttribution_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
