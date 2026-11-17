-- Q-11 (review M-1): allow the closed-beta grant 'automation_form_no_show'
-- (src/lib/vendor-feature-toggles.ts BETA_GATED_FEATURES).
--
-- Same shape as 20261114090200_automation_delayed_steps_grant: the CHECK is
-- dropped and re-added with one more allowed value. The new CHECK is a
-- superset of the old one, so re-validating the existing rows cannot fail. It
-- runs in its own short transaction (the ACCESS EXCLUSIVE lock on "Vendor" is
-- held only for the validation scan of a small table). No row changes and no
-- vendor receives the grant: the platform opens it per vendor in
-- /admin/vendor-features.
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
      'automation_delayed_steps',
      'automation_form_no_show'
    ]::TEXT[]
  );
