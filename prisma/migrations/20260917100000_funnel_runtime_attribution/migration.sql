-- Public Funnel runtime persistence. This migration is additive: it creates
-- no synthetic traffic and does not alter existing published snapshots.
ALTER TABLE "LandingPage" ADD COLUMN "operations" JSONB;

CREATE TABLE "FunnelVisit" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "logicalStepId" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "experimentId" TEXT,
  "arm" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FunnelVisit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FunnelSubmission" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "visitId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FunnelSubmission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AutomationRule" ADD COLUMN "funnelPageId" TEXT;

CREATE UNIQUE INDEX "FunnelVisit_vendorId_id_key" ON "FunnelVisit"("vendorId", "id");
CREATE UNIQUE INDEX "FunnelVisit_vendorId_pageId_id_key" ON "FunnelVisit"("vendorId", "pageId", "id");
CREATE INDEX "FunnelVisit_vendorId_pageId_logicalStepId_createdAt_idx" ON "FunnelVisit"("vendorId", "pageId", "logicalStepId", "createdAt");
CREATE INDEX "FunnelVisit_vendorId_pageId_visitorId_createdAt_idx" ON "FunnelVisit"("vendorId", "pageId", "visitorId", "createdAt");
CREATE UNIQUE INDEX "FunnelSubmission_submissionId_key" ON "FunnelSubmission"("submissionId");
CREATE INDEX "FunnelSubmission_vendorId_pageId_stepId_createdAt_idx" ON "FunnelSubmission"("vendorId", "pageId", "stepId", "createdAt");
CREATE INDEX "FunnelSubmission_vendorId_pageId_visitId_idx" ON "FunnelSubmission"("vendorId", "pageId", "visitId");
CREATE INDEX "AutomationRule_vendorId_funnelPageId_trigger_isActive_idx" ON "AutomationRule"("vendorId", "funnelPageId", "trigger", "isActive");

ALTER TABLE "FunnelVisit"
  ADD CONSTRAINT "FunnelVisit_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "FunnelVisit_vendorId_pageId_fkey"
  FOREIGN KEY ("vendorId", "pageId") REFERENCES "LandingPage"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FunnelSubmission"
  ADD CONSTRAINT "FunnelSubmission_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "FunnelSubmission_vendorId_pageId_fkey"
  FOREIGN KEY ("vendorId", "pageId") REFERENCES "LandingPage"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "FunnelSubmission_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FunnelSubmission_vendorId_pageId_visitId_fkey"
  FOREIGN KEY ("vendorId", "pageId", "visitId") REFERENCES "FunnelVisit"("vendorId", "pageId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
