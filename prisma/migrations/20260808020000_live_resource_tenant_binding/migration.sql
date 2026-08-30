-- Refuse to proceed when a legacy Live points to a missing or cross-tenant resource.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Live" AS l
        LEFT JOIN "Video" AS v ON v."id" = l."videoId"
        LEFT JOIN "RegistrationForm" AS f ON f."id" = l."formId"
        WHERE (l."videoId" IS NOT NULL AND (v."id" IS NULL OR v."vendorId" <> l."vendorId"))
           OR (l."formId" IS NOT NULL AND (f."id" IS NULL OR f."vendorId" <> l."vendorId"))
    ) THEN
        RAISE EXCEPTION 'Live resource tenant preflight failed: missing parent or cross-tenant legacy row';
    END IF;
END $$;

CREATE UNIQUE INDEX "Video_vendorId_id_key" ON "Video"("vendorId", "id");
CREATE UNIQUE INDEX "RegistrationForm_vendorId_id_key" ON "RegistrationForm"("vendorId", "id");

-- Keep the existing SET NULL behavior while adding a database-enforced tenant check.
ALTER TABLE "Live" DROP CONSTRAINT "Live_videoId_fkey";
ALTER TABLE "Live" DROP CONSTRAINT "Live_formId_fkey";

ALTER TABLE "Live"
    ADD CONSTRAINT "Live_videoId_fkey"
    FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Live"
    ADD CONSTRAINT "Live_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The composite checks use NO ACTION so the legacy single-column SET NULL FK can
-- clear the nullable resource id in the same delete statement.
ALTER TABLE "Live"
    ADD CONSTRAINT "Live_vendorId_videoId_fkey"
    FOREIGN KEY ("vendorId", "videoId") REFERENCES "Video"("vendorId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Live"
    ADD CONSTRAINT "Live_vendorId_formId_fkey"
    FOREIGN KEY ("vendorId", "formId") REFERENCES "RegistrationForm"("vendorId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
