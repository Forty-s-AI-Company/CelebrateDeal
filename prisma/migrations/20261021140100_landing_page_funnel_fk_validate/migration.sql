-- F-072 / B04-19: validate the RESTRICT funnel FKs added NOT VALID by
-- 20261021140000_landing_page_archive_restrict_funnel.
--
-- Kept in its own migration on purpose: Prisma runs each migration file as one
-- implicit transaction, so a VALIDATE in the same file would still hold the
-- ACCESS EXCLUSIVE locks taken by DROP/ADD CONSTRAINT during the full scan.
-- Here VALIDATE CONSTRAINT takes only SHARE UPDATE EXCLUSIVE on the
-- referencing table and ROW SHARE on LandingPage, so public /lp reads and
-- visit writes keep working. Existing rows already satisfy the constraint
-- (they were created under the previous FK), so this cannot fail on data.
SELECT pg_catalog.set_config('lock_timeout', '5s', true);

ALTER TABLE "FunnelVisit" VALIDATE CONSTRAINT "FunnelVisit_vendorId_pageId_fkey";
ALTER TABLE "FunnelSubmission" VALIDATE CONSTRAINT "FunnelSubmission_vendorId_pageId_fkey";
