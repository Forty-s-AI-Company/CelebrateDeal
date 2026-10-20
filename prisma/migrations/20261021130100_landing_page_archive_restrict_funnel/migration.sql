-- F-072 / B04-19: funnel traffic and lead-source rows outlive their page.
--
-- Deleting a LandingPage used to cascade into FunnelVisit and
-- FunnelSubmission, erasing the visit and lead-attribution history that ad
-- reporting and commission audits depend on. deleteLandingPage now archives
-- (sets "archivedAt") any page that was ever published or has traffic, and the
-- database refuses to delete a page that still has funnel rows.
--
-- Vendor deletion is unchanged: FunnelVisit/FunnelSubmission still cascade
-- from "Vendor" through their own vendorId foreign keys.
--
-- Locking: the new FKs are added NOT VALID (brief SHARE ROW EXCLUSIVE on both
-- tables, no scan) and validated separately (SHARE UPDATE EXCLUSIVE on the
-- referencing table, ROW SHARE on LandingPage), so funnel writes are not
-- blocked for the length of a full-table scan. Existing rows already satisfy
-- the constraint because they were created under the previous FK.
SELECT pg_catalog.set_config('lock_timeout', '5s', true);

ALTER TABLE "LandingPage" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- An archived page can never be live again: no published status, no
-- published version pointer. New column, so every existing row passes.
ALTER TABLE "LandingPage"
  ADD CONSTRAINT "LandingPage_archived_unpublished_check"
  CHECK ("archivedAt" IS NULL OR ("status" <> 'published' AND "publishedVersionId" IS NULL));

ALTER TABLE "FunnelVisit" DROP CONSTRAINT "FunnelVisit_vendorId_pageId_fkey";
ALTER TABLE "FunnelVisit"
  ADD CONSTRAINT "FunnelVisit_vendorId_pageId_fkey"
  FOREIGN KEY ("vendorId", "pageId") REFERENCES "LandingPage"("vendorId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "FunnelSubmission" DROP CONSTRAINT "FunnelSubmission_vendorId_pageId_fkey";
ALTER TABLE "FunnelSubmission"
  ADD CONSTRAINT "FunnelSubmission_vendorId_pageId_fkey"
  FOREIGN KEY ("vendorId", "pageId") REFERENCES "LandingPage"("vendorId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "FunnelVisit" VALIDATE CONSTRAINT "FunnelVisit_vendorId_pageId_fkey";
ALTER TABLE "FunnelSubmission" VALIDATE CONSTRAINT "FunnelSubmission_vendorId_pageId_fkey";
