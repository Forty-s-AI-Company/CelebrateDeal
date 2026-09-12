-- Landing pages are additive. Published output is an immutable snapshot, while
-- the mutable row retains the current editor draft and its CAS revision.
CREATE TYPE "LandingPageStatus" AS ENUM ('draft', 'published');

CREATE TABLE "LandingPage" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "draftContent" JSONB NOT NULL,
  "draftFormId" TEXT,
  "draftLiveId" TEXT,
  "status" "LandingPageStatus" NOT NULL DEFAULT 'draft',
  "publishedVersionId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "publishedAt" TIMESTAMP(3),
  "unpublishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LandingPageVersion" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "content" JSONB NOT NULL,
  "formId" TEXT,
  "liveId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LandingPageVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LandingPage_slug_key" ON "LandingPage"("slug");
CREATE UNIQUE INDEX "LandingPage_vendorId_id_key" ON "LandingPage"("vendorId", "id");
CREATE UNIQUE INDEX "LandingPage_vendorId_id_publishedVersionId_key" ON "LandingPage"("vendorId", "id", "publishedVersionId");
CREATE UNIQUE INDEX "LandingPage_vendorId_projectId_slug_key" ON "LandingPage"("vendorId", "projectId", "slug");
CREATE INDEX "LandingPage_vendorId_projectId_updatedAt_idx" ON "LandingPage"("vendorId", "projectId", "updatedAt");
CREATE INDEX "LandingPage_vendorId_status_publishedAt_idx" ON "LandingPage"("vendorId", "status", "publishedAt");

CREATE UNIQUE INDEX "LandingPageVersion_vendorId_id_key" ON "LandingPageVersion"("vendorId", "id");
CREATE UNIQUE INDEX "LandingPageVersion_vendorId_pageId_id_key" ON "LandingPageVersion"("vendorId", "pageId", "id");
CREATE UNIQUE INDEX "LandingPageVersion_vendorId_pageId_version_key" ON "LandingPageVersion"("vendorId", "pageId", "version");
CREATE INDEX "LandingPageVersion_vendorId_pageId_createdAt_idx" ON "LandingPageVersion"("vendorId", "pageId", "createdAt");

ALTER TABLE "LandingPage"
  ADD CONSTRAINT "LandingPage_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LandingPage_vendorId_projectId_fkey"
  FOREIGN KEY ("vendorId", "projectId") REFERENCES "SalesProject"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LandingPage_vendorId_draftFormId_fkey"
  FOREIGN KEY ("vendorId", "draftFormId") REFERENCES "RegistrationForm"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LandingPage_vendorId_draftLiveId_fkey"
  FOREIGN KEY ("vendorId", "draftLiveId") REFERENCES "Live"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LandingPageVersion"
  ADD CONSTRAINT "LandingPageVersion_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LandingPageVersion_vendorId_pageId_fkey"
  FOREIGN KEY ("vendorId", "pageId") REFERENCES "LandingPage"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LandingPageVersion_vendorId_formId_fkey"
  FOREIGN KEY ("vendorId", "formId") REFERENCES "RegistrationForm"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LandingPageVersion_vendorId_liveId_fkey"
  FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LandingPage"
  ADD CONSTRAINT "LandingPage_publishedVersionId_fkey"
  FOREIGN KEY ("vendorId", "id", "publishedVersionId") REFERENCES "LandingPageVersion"("vendorId", "pageId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
