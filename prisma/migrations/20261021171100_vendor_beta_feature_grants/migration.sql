-- F-001 / F-002 (B01-01, B01-02): per-vendor grants for modules that stay
-- closed during the closed beta (courses, billing, funnel_binding,
-- consultation_booking, browser_live, danmaku).
--
-- Only platform administrators write this column; merchants cannot grant
-- themselves a module through the feature settings page. The empty default
-- means every existing and new vendor starts with all beta modules closed.
-- Values are validated in application code (src/lib/vendor-feature-toggles.ts);
-- the CHECK below rejects anything outside the known set so a typo cannot
-- silently open or hide a module.
--
-- Forward-only and additive: no backfill, no data rewrite. Adding a column
-- with a constant default is a metadata-only change in PostgreSQL 11+.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Vendor"
  ADD COLUMN "betaFeatureGrants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Vendor"
  ADD CONSTRAINT "Vendor_betaFeatureGrants_check" CHECK (
    "betaFeatureGrants" <@ ARRAY[
      'courses',
      'billing',
      'funnel_binding',
      'consultation_booking',
      'browser_live',
      'danmaku'
    ]::TEXT[]
  );
