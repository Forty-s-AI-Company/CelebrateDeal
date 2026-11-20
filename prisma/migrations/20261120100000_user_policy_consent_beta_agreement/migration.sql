-- O-11 (owner 2026-11-20): the 封測合作協議 is accepted in the back office
-- (clickwrap) instead of by e-mail reply. Each acceptance is a
-- UserPolicyConsent row with context 'beta_agreement', bound to the accepting
-- user and the vendor, carrying the agreement version.
--
-- Forward-only. No existing row changes:
--   * new nullable column "agreementVersion";
--   * "termsVersion" / "privacyVersion" lose NOT NULL, but the rebuilt
--     version CHECK still requires both for every context except
--     'beta_agreement', so existing rows (merchant_registration,
--     vendor_member_invitation) keep exactly the same guarantees;
--   * the context CHECK only gains a value;
--   * one new unique index: one row per user, vendor and agreement version.
--     NULLs are distinct in PostgreSQL, so the existing rows (agreementVersion
--     NULL) never collide on it, and the existing per-user terms/privacy key
--     never sees beta rows (their terms/privacy are NULL).
--
-- Locks: ALTER COLUMN / ADD COLUMN are catalog-only (ACCESS EXCLUSIVE for an
-- instant); re-adding the CHECKs scans the table, which holds one row per
-- accepted version per user and is small; CREATE UNIQUE INDEX takes SHARE on
-- the same small table. lock_timeout bounds the wait for each.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "UserPolicyConsent" ADD COLUMN "agreementVersion" TEXT;

ALTER TABLE "UserPolicyConsent"
  ALTER COLUMN "termsVersion" DROP NOT NULL,
  ALTER COLUMN "privacyVersion" DROP NOT NULL;

ALTER TABLE "UserPolicyConsent" DROP CONSTRAINT "UserPolicyConsent_context_check";
ALTER TABLE "UserPolicyConsent"
  ADD CONSTRAINT "UserPolicyConsent_context_check"
    CHECK ("context" IN ('merchant_registration', 'vendor_member_invitation', 'beta_agreement'));

-- Exactly one shape per context. A regex on NULL is NULL (which a CHECK
-- accepts), so every required column is also tested with IS NOT NULL.
ALTER TABLE "UserPolicyConsent" DROP CONSTRAINT "UserPolicyConsent_version_check";
ALTER TABLE "UserPolicyConsent"
  ADD CONSTRAINT "UserPolicyConsent_version_check" CHECK (
    (
      "context" = 'beta_agreement'
      AND "agreementVersion" IS NOT NULL
      AND "agreementVersion" ~ '^[0-9A-Za-z._-]{1,32}$'
      AND "termsVersion" IS NULL
      AND "privacyVersion" IS NULL
    )
    OR (
      "context" <> 'beta_agreement'
      AND "termsVersion" IS NOT NULL
      AND "privacyVersion" IS NOT NULL
      AND "termsVersion" ~ '^[0-9A-Za-z._-]{1,32}$'
      AND "privacyVersion" ~ '^[0-9A-Za-z._-]{1,32}$'
      AND "agreementVersion" IS NULL
    )
  );

-- Idempotent acceptance: the same user accepts a given agreement version for
-- a given vendor once. A user who owns two vendors accepts once per vendor.
CREATE UNIQUE INDEX "UserPolicyConsent_user_vendor_agreement_key"
  ON "UserPolicyConsent"("userId", "vendorId", "context", "agreementVersion");
