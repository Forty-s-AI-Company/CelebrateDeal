-- Feature toggles only affect merchant UI visibility. Existing business data is preserved.
ALTER TABLE "Vendor"
ADD COLUMN "enabledFeatureModules" TEXT[] NOT NULL DEFAULT ARRAY[
  'funnel_builder',
  'live_webinar',
  'affiliate_program',
  'tax_remuneration',
  'analytics_advanced'
]::TEXT[];
