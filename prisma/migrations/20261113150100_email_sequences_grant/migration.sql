-- F-3 Email 追銷序列: allow the closed-beta grant 'email_sequences'
-- (src/lib/vendor-feature-toggles.ts BETA_GATED_FEATURES).
--
-- Only this: the CHECK from 20261021171100_vendor_beta_feature_grants is
-- dropped and re-added with one more allowed value. The new CHECK is a
-- superset of the old one, so re-validating the existing rows cannot fail.
-- It runs in its own short transaction so the ACCESS EXCLUSIVE lock on
-- "Vendor" (held for the validation scan of a small table) is not held while
-- the tables of 20261113150000_email_sequences are built. No row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "Vendor" DROP CONSTRAINT "Vendor_betaFeatureGrants_check";
ALTER TABLE "Vendor"
  ADD CONSTRAINT "Vendor_betaFeatureGrants_check" CHECK (
    "betaFeatureGrants" <@ ARRAY[
      'courses',
      'billing',
      'funnel_binding',
      'consultation_booking',
      'browser_live',
      'danmaku',
      'email_sequences'
    ]::TEXT[]
  );
