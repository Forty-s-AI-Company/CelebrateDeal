-- AlterTable
ALTER TABLE "UserSession" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserMfaFactor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "factorType" TEXT NOT NULL DEFAULT 'totp',
    "label" TEXT,
    "secretEncrypted" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMfaFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserMfaFactor_userId_key" ON "UserMfaFactor"("userId");

-- CreateIndex
CREATE INDEX "UserMfaFactor_factorType_enabledAt_idx" ON "UserMfaFactor"("factorType", "enabledAt");

-- CreateIndex
CREATE INDEX "UserRecoveryCode_userId_usedAt_idx" ON "UserRecoveryCode"("userId", "usedAt");

-- AddForeignKey
ALTER TABLE "UserMfaFactor" ADD CONSTRAINT "UserMfaFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRecoveryCode" ADD CONSTRAINT "UserRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
