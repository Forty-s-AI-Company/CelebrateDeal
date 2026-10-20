-- Forward-only and additive (F-114): an append-only record of the terms and
-- privacy policy versions a user accepted, starting with merchant
-- registration. No existing table, column or row changes. Versions are taken
-- from the server's published policy metadata, never from the client.
CREATE TABLE "UserPolicyConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT,
    "context" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "privacyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPolicyConsent_pkey" PRIMARY KEY ("id"),
    -- Closed set of consent entry points; extend with a later migration.
    CONSTRAINT "UserPolicyConsent_context_check" CHECK ("context" IN ('merchant_registration')),
    -- Bounded version tokens such as "2026.10.18".
    CONSTRAINT "UserPolicyConsent_version_check" CHECK (
        "termsVersion" ~ '^[0-9A-Za-z._-]{1,32}$' AND "privacyVersion" ~ '^[0-9A-Za-z._-]{1,32}$'
    )
);

CREATE INDEX "UserPolicyConsent_vendorId_acceptedAt_idx" ON "UserPolicyConsent"("vendorId", "acceptedAt");

-- One record per user, entry point and accepted version pair.
CREATE UNIQUE INDEX "UserPolicyConsent_user_context_versions_key" ON "UserPolicyConsent"("userId", "context", "termsVersion", "privacyVersion");

-- The record follows the user; it outlives a deleted workspace.
ALTER TABLE "UserPolicyConsent" ADD CONSTRAINT "UserPolicyConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPolicyConsent" ADD CONSTRAINT "UserPolicyConsent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserPolicyConsent" ENABLE ROW LEVEL SECURITY;
