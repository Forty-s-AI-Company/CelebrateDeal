CREATE TYPE "AnalyticsTrustLevel" AS ENUM (
  'LEGACY_UNVERIFIED',
  'ADMITTED_LIVE_SESSION'
);

ALTER TABLE "AnalyticsEvent"
ADD COLUMN "trustLevel" "AnalyticsTrustLevel" NOT NULL DEFAULT 'LEGACY_UNVERIFIED';

CREATE INDEX "AnalyticsEvent_vendorId_trustLevel_eventType_createdAt_idx"
ON "AnalyticsEvent"("vendorId", "trustLevel", "eventType", "createdAt");
