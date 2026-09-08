CREATE TYPE "StudentPortalAccessTokenPurpose" AS ENUM ('magic_link', 'checkout_redirect');

CREATE TABLE "StudentPortalAccessToken" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "purpose" "StudentPortalAccessTokenPurpose" NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentPortalAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentPortalAccessToken_tokenHash_key" ON "StudentPortalAccessToken"("tokenHash");
CREATE UNIQUE INDEX "StudentPortalAccessToken_vendorId_id_key" ON "StudentPortalAccessToken"("vendorId", "id");
CREATE INDEX "StudentPortalAccessToken_vendorId_customerKeyHash_expiresAt_idx"
  ON "StudentPortalAccessToken"("vendorId", "customerKeyHash", "expiresAt");
CREATE INDEX "StudentPortalAccessToken_vendorId_purpose_expiresAt_idx"
  ON "StudentPortalAccessToken"("vendorId", "purpose", "expiresAt");

ALTER TABLE "StudentPortalAccessToken"
  ADD CONSTRAINT "StudentPortalAccessToken_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
