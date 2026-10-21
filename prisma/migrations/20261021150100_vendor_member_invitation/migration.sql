-- F-029 / B02-06: member invitations need the invitee's acceptance.
--
-- "Add member" used to create an active VendorMember for any existing user
-- immediately and answered differently for platform administrators and
-- suspended accounts, so any self-registered owner could enumerate accounts
-- and attach another tenant's user without consent. The owner now creates an
-- invitation; the membership is written only when the invitee accepts.
--
-- Forward-only and additive: one new table, no existing row changes.
-- Existing memberships are untouched.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

CREATE TABLE "VendorMemberInvitation" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorMemberInvitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VendorMemberInvitation_role_check"
        CHECK ("role" IN ('owner', 'admin', 'accountant', 'support')),
    CONSTRAINT "VendorMemberInvitation_email_check"
        CHECK ("email" = lower(btrim("email")) AND "email" <> ''),
    CONSTRAINT "VendorMemberInvitation_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    -- An invitation ends at most once: accepted or revoked. acceptedUserId
    -- may later become NULL (ON DELETE SET NULL) but never exists without
    -- acceptedAt.
    CONSTRAINT "VendorMemberInvitation_outcome_check"
        CHECK (("acceptedAt" IS NULL OR "revokedAt" IS NULL)
           AND ("acceptedUserId" IS NULL OR "acceptedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "VendorMemberInvitation_tokenHash_key" ON "VendorMemberInvitation"("tokenHash");

CREATE INDEX "VendorMemberInvitation_vendorId_email_idx" ON "VendorMemberInvitation"("vendorId", "email");

CREATE INDEX "VendorMemberInvitation_expiresAt_idx" ON "VendorMemberInvitation"("expiresAt");

ALTER TABLE "VendorMemberInvitation" ADD CONSTRAINT "VendorMemberInvitation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorMemberInvitation" ADD CONSTRAINT "VendorMemberInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VendorMemberInvitation" ADD CONSTRAINT "VendorMemberInvitation_acceptedUserId_fkey" FOREIGN KEY ("acceptedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "VendorMemberInvitation" ENABLE ROW LEVEL SECURITY;

-- A new account created by accepting an invitation records its policy
-- consent with its own context. Widening the allowed set cannot fail on
-- existing rows; UserPolicyConsent holds one row per accepted policy version
-- per user, so the validating scan is short.
ALTER TABLE "UserPolicyConsent" DROP CONSTRAINT "UserPolicyConsent_context_check";
ALTER TABLE "UserPolicyConsent"
  ADD CONSTRAINT "UserPolicyConsent_context_check"
    CHECK ("context" IN ('merchant_registration', 'vendor_member_invitation'));
