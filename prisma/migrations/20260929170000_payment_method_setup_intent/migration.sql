CREATE TABLE "PaymentMethodSetupIntent" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "teamId" TEXT,
    "membershipId" TEXT,
    "nonceHash" TEXT NOT NULL,
    "consentActorId" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "providerEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethodSetupIntent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentMethodSetupIntent_vendorId_status_expiresAt_idx"
    ON "PaymentMethodSetupIntent"("vendorId", "status", "expiresAt");

-- Server-side Prisma owns this table. Keep direct Data API access default-deny.
ALTER TABLE "PaymentMethodSetupIntent" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PaymentMethodSetupIntent"
    ADD CONSTRAINT "PaymentMethodSetupIntent_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentMethodSetupIntent"
    ADD CONSTRAINT "PaymentMethodSetupIntent_vendorId_consentActorId_fkey"
    FOREIGN KEY ("vendorId", "consentActorId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
