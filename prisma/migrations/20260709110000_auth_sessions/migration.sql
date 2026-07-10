-- AlterTable
ALTER TABLE "User" ADD COLUMN "platformRole" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_expiresAt_idx" ON "UserSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "UserSession_vendorId_expiresAt_idx" ON "UserSession"("vendorId", "expiresAt");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
