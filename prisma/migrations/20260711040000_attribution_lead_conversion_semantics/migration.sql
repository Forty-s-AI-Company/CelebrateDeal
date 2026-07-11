ALTER TABLE "AffiliateClick" ADD COLUMN "leadAt" TIMESTAMP(3);

-- Before this migration, only lead/enrollment paths wrote convertedAt. Preserve that
-- timestamp as lead evidence and clear the misleading paid-conversion marker.
UPDATE "AffiliateClick"
SET "leadAt" = "convertedAt", "convertedAt" = NULL
WHERE "convertedAt" IS NOT NULL;

UPDATE "AffiliateClick" click
SET "affiliateId" = NULL
WHERE click."affiliateId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Affiliate" affiliate
    WHERE affiliate."id" = click."affiliateId" AND affiliate."vendorId" = click."vendorId"
  );

UPDATE "AffiliateClick" click
SET "liveId" = NULL
WHERE click."liveId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Live" live
    WHERE live."id" = click."liveId" AND live."vendorId" = click."vendorId"
  );

UPDATE "Enrollment" enrollment
SET "affiliateId" = NULL
WHERE enrollment."affiliateId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Affiliate" affiliate
    WHERE affiliate."id" = enrollment."affiliateId" AND affiliate."vendorId" = enrollment."vendorId"
  );

UPDATE "Enrollment" enrollment
SET "sessionId" = NULL
WHERE enrollment."sessionId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "CourseSession" session
    WHERE session."id" = enrollment."sessionId"
      AND session."courseId" = enrollment."courseId"
      AND session."vendorId" = enrollment."vendorId"
  );

UPDATE "Enrollment" enrollment
SET "attributionClickId" = NULL
WHERE enrollment."attributionClickId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "AffiliateClick" click
    WHERE click."id" = enrollment."attributionClickId" AND click."vendorId" = enrollment."vendorId"
  );

CREATE UNIQUE INDEX "AffiliateClick_id_vendorId_key" ON "AffiliateClick"("id", "vendorId");
CREATE UNIQUE INDEX "CourseSession_id_courseId_vendorId_key" ON "CourseSession"("id", "courseId", "vendorId");

ALTER TABLE "AffiliateClick"
DROP CONSTRAINT "AffiliateClick_affiliateId_fkey",
DROP CONSTRAINT "AffiliateClick_liveId_fkey",
ADD CONSTRAINT "AffiliateClick_affiliateId_vendorId_fkey"
  FOREIGN KEY ("affiliateId", "vendorId") REFERENCES "Affiliate"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "AffiliateClick_liveId_vendorId_fkey"
  FOREIGN KEY ("liveId", "vendorId") REFERENCES "Live"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Enrollment"
DROP CONSTRAINT "Enrollment_sessionId_vendorId_fkey",
DROP CONSTRAINT "Enrollment_affiliateId_fkey",
ADD CONSTRAINT "Enrollment_sessionId_courseId_vendorId_fkey"
  FOREIGN KEY ("sessionId", "courseId", "vendorId") REFERENCES "CourseSession"("id", "courseId", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Enrollment_affiliateId_vendorId_fkey"
  FOREIGN KEY ("affiliateId", "vendorId") REFERENCES "Affiliate"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Enrollment_attributionClickId_vendorId_fkey"
  FOREIGN KEY ("attributionClickId", "vendorId") REFERENCES "AffiliateClick"("id", "vendorId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rollback: drop the three composite foreign keys and two unique indexes, restore
-- the original single-column relations, then drop AffiliateClick.leadAt. Export
-- leadAt first because lead and paid-conversion timestamps cannot be recombined.
