CREATE TABLE "PayUniLiveProbe" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "setupIntentId" TEXT NOT NULL,
    "paymentMethodReferenceId" TEXT,
    "secondOrderNumber" TEXT NOT NULL,
    "consentActorId" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "firstAmountCents" INTEGER NOT NULL DEFAULT 100,
    "secondAmountCents" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'awaiting_setup',
    "dueAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "providerTradeNo" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayUniLiveProbe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayUniLiveProbe_vendorId_key" ON "PayUniLiveProbe"("vendorId");
CREATE UNIQUE INDEX "PayUniLiveProbe_setupIntentId_key" ON "PayUniLiveProbe"("setupIntentId");
CREATE UNIQUE INDEX "PayUniLiveProbe_secondOrderNumber_key" ON "PayUniLiveProbe"("secondOrderNumber");
CREATE INDEX "PayUniLiveProbe_status_dueAt_idx" ON "PayUniLiveProbe"("status", "dueAt");

-- Server-side Prisma owns this table. No browser-facing RLS policies are needed.
ALTER TABLE "PayUniLiveProbe" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PayUniLiveProbe" ADD CONSTRAINT "PayUniLiveProbe_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
