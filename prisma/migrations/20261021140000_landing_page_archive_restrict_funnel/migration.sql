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
-- Locking: Prisma sends this whole file as one implicit transaction, so every
-- lock taken here is held until commit. Nothing in this file scans a table:
-- ADD COLUMN without a default and ADD CONSTRAINT ... NOT VALID are
-- catalog-only. The FKs are validated by the separate, later migration
-- 20261021140100_landing_page_funnel_fk_validate, which runs in its own
-- transaction and only takes SHARE UPDATE EXCLUSIVE on the referencing table
-- (ROW SHARE on LandingPage), so reads and writes continue during the scan.
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
