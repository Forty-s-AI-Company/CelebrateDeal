CREATE TABLE "PaymentMethodReference" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'VENDOR',
    "teamId" TEXT,
    "membershipId" TEXT,
    "providerName" TEXT NOT NULL,
    "providerCustomerRef" TEXT,
    "providerPaymentMethodRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethodReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentMethodReference_vendorId_providerName_providerPaymentMethodRef_key"
    ON "PaymentMethodReference"("vendorId", "providerName", "providerPaymentMethodRef");
CREATE UNIQUE INDEX "PaymentMethodReference_vendorId_id_key"
    ON "PaymentMethodReference"("vendorId", "id");
CREATE INDEX "PaymentMethodReference_vendorId_scopeType_status_idx"
    ON "PaymentMethodReference"("vendorId", "scopeType", "status");
CREATE INDEX "PaymentMethodReference_vendorId_membershipId_status_idx"
    ON "PaymentMethodReference"("vendorId", "membershipId", "status");

ALTER TABLE "PaymentMethodReference"
    ADD CONSTRAINT "PaymentMethodReference_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentMethodReference"
    ADD CONSTRAINT "PaymentMethodReference_vendorId_teamId_membershipId_fkey"
    FOREIGN KEY ("vendorId", "teamId", "membershipId")
    REFERENCES "TeamMembership"("vendorId", "teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
