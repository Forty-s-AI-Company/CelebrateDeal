-- F-4 PR 2: allow the closed-beta grant 'automation_delayed_steps'
-- (src/lib/vendor-feature-toggles.ts BETA_GATED_FEATURES).
--
-- Same shape as 20261113150100_email_sequences_grant: the CHECK from
-- 20261021171100_vendor_beta_feature_grants is dropped and re-added with one
-- more allowed value. The new CHECK is a superset of the old one, so
-- re-validating the existing rows cannot fail. It runs in its own short
-- transaction so the ACCESS EXCLUSIVE lock on "Vendor" (held for the
-- validation scan of a small table) is not held while the DelayedStepRun
-- changes of 20261114090000 / 20261114090100 are made. No row changes and no
-- vendor receives the grant.
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
      'email_sequences',
      'automation_delayed_steps'
    ]::TEXT[]
  );
