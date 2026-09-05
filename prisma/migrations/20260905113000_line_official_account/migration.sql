-- CreateTable
CREATE TABLE "LineOfficialAccount" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "messagingChannelIdEncrypted" TEXT NOT NULL,
    "messagingChannelSecretEncrypted" TEXT NOT NULL,
    "messagingAccessTokenEncrypted" TEXT NOT NULL,
    "loginChannelIdEncrypted" TEXT,
    "loginChannelSecretEncrypted" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LineOfficialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineUserIdentity" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "lineUserIdHash" TEXT NOT NULL,
    "lineUserIdEncrypted" TEXT NOT NULL,
    "displayNameEncrypted" TEXT,
    "pictureUrlEncrypted" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMaterializedAt" TIMESTAMP(3),
    "materializationCursor" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LineUserIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineLoginState" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "codeVerifierEncrypted" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "redirectPath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LineLoginState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineDelivery" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "lineOfficialAccountId" TEXT NOT NULL,
    "lineUserIdentityId" TEXT NOT NULL,
    "sourceTemplateId" TEXT,
    "trigger" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadEncrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "providerRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LineDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LineOfficialAccount_vendorId_key" ON "LineOfficialAccount"("vendorId");
CREATE UNIQUE INDEX "LineOfficialAccount_vendorId_id_key" ON "LineOfficialAccount"("vendorId", "id");
CREATE INDEX "LineOfficialAccount_status_updatedAt_idx" ON "LineOfficialAccount"("status", "updatedAt");
CREATE UNIQUE INDEX "LineUserIdentity_vendorId_subjectType_subjectId_key" ON "LineUserIdentity"("vendorId", "subjectType", "subjectId");
CREATE UNIQUE INDEX "LineUserIdentity_vendorId_lineUserIdHash_key" ON "LineUserIdentity"("vendorId", "lineUserIdHash");
CREATE UNIQUE INDEX "LineUserIdentity_vendorId_id_key" ON "LineUserIdentity"("vendorId", "id");
CREATE INDEX "LineUserIdentity_vendorId_subjectType_revokedAt_idx" ON "LineUserIdentity"("vendorId", "subjectType", "revokedAt");
CREATE INDEX "LineUserIdentity_revokedAt_lastMaterializedAt_idx" ON "LineUserIdentity"("revokedAt", "lastMaterializedAt");
CREATE UNIQUE INDEX "LineLoginState_stateHash_key" ON "LineLoginState"("stateHash");
CREATE INDEX "LineLoginState_vendorId_expiresAt_consumedAt_idx" ON "LineLoginState"("vendorId", "expiresAt", "consumedAt");
CREATE UNIQUE INDEX "LineDelivery_vendorId_idempotencyKey_key" ON "LineDelivery"("vendorId", "idempotencyKey");
CREATE INDEX "LineDelivery_status_nextAttemptAt_claimedAt_idx" ON "LineDelivery"("status", "nextAttemptAt", "claimedAt");
CREATE INDEX "LineDelivery_vendorId_trigger_createdAt_idx" ON "LineDelivery"("vendorId", "trigger", "createdAt");
CREATE INDEX "LineDelivery_lineUserIdentityId_createdAt_idx" ON "LineDelivery"("lineUserIdentityId", "createdAt");

ALTER TABLE "LineOfficialAccount" ADD CONSTRAINT "LineOfficialAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LineUserIdentity" ADD CONSTRAINT "LineUserIdentity_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LineLoginState" ADD CONSTRAINT "LineLoginState_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LineDelivery" ADD CONSTRAINT "LineDelivery_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LineDelivery" ADD CONSTRAINT "LineDelivery_vendorId_lineOfficialAccountId_fkey" FOREIGN KEY ("vendorId", "lineOfficialAccountId") REFERENCES "LineOfficialAccount"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LineDelivery" ADD CONSTRAINT "LineDelivery_vendorId_lineUserIdentityId_fkey" FOREIGN KEY ("vendorId", "lineUserIdentityId") REFERENCES "LineUserIdentity"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LineDelivery" ADD CONSTRAINT "LineDelivery_vendorId_sourceTemplateId_fkey" FOREIGN KEY ("vendorId", "sourceTemplateId") REFERENCES "MessageTemplate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
