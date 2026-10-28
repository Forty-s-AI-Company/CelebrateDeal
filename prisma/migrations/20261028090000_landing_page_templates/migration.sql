-- 一頁式網站「我的範本」：商家把某個步驟的頁面存成自己的範本。
--
-- Forward-only and additive: one new table, no existing row changes.
-- `content` is a PageDocument the server rebuilt from the stored draft with
-- every vendor-resource binding removed (stripTemplateBindings), so a template
-- never carries another record's id into a page it is applied to.
-- `sourcePageId` has no FK on purpose: deleting or archiving the source page
-- must never be blocked by, or cascade into, templates.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

CREATE TABLE "LandingPageTemplate" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "sourcePageId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPageTemplate_pkey" PRIMARY KEY ("id"),
    -- Same bound as LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH; the app trims first.
    CONSTRAINT "LandingPageTemplate_name_check"
        CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 80),
    CONSTRAINT "LandingPageTemplate_content_check"
        CHECK (jsonb_typeof("content") = 'object')
);

CREATE INDEX "LandingPageTemplate_vendorId_updatedAt_idx" ON "LandingPageTemplate"("vendorId", "updatedAt");

CREATE UNIQUE INDEX "LandingPageTemplate_vendorId_id_key" ON "LandingPageTemplate"("vendorId", "id");

ALTER TABLE "LandingPageTemplate" ADD CONSTRAINT "LandingPageTemplate_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LandingPageTemplate" ADD CONSTRAINT "LandingPageTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "LandingPageTemplate" ENABLE ROW LEVEL SECURITY;
