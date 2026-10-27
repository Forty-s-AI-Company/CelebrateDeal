-- Funnel tracking integrations (custom code work, 2026-10-27): merchants enter
-- only IDs and the platform renders the standard GA4 / Meta Pixel snippet on
-- public funnel pages. Arbitrary tracking scripts are not accepted.
--
-- * "ga4MeasurementId": GA4 measurement ID (G-XXXX). The format is validated
--   on save and again before rendering (src/lib/tracking-integration-ids.ts).
-- * "enableBrowserTags": explicit opt-in. Merchants who entered a Meta Pixel ID
--   only for server-side Conversions API keep exactly today's behaviour (no
--   browser script) until they turn this on.
--
-- Forward-only and additive: a nullable column and a NOT NULL column with a
-- constant default are metadata-only changes in PostgreSQL 11+. No backfill.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "TrackingSetting" ADD COLUMN "ga4MeasurementId" TEXT;
ALTER TABLE "TrackingSetting" ADD COLUMN "enableBrowserTags" BOOLEAN NOT NULL DEFAULT false;
