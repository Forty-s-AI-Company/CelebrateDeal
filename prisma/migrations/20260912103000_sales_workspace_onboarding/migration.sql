-- Add sales-project boundaries and onboarding state without changing or
-- deleting existing merchant data. Historic resources remain unassigned.
CREATE TYPE "SalesWorkspaceMode" AS ENUM ('live_course', 'consulting', 'flagship');
CREATE TYPE "SalesProjectFlow" AS ENUM ('live', 'consultation');
CREATE TYPE "SalesProjectStatus" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "OnboardingTaskStatus" AS ENUM ('not_started', 'in_progress', 'completed', 'skipped', 'needs_attention', 'archived');

CREATE TABLE "SalesProject" (
  "id" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
  "mode" "SalesWorkspaceMode" NOT NULL, "primaryFlow" "SalesProjectFlow" NOT NULL,
  "status" "SalesProjectStatus" NOT NULL DEFAULT 'draft', "onboardingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "publishedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SalesProject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesProject_vendorId_id_key" ON "SalesProject"("vendorId", "id");
CREATE UNIQUE INDEX "SalesProject_vendorId_slug_key" ON "SalesProject"("vendorId", "slug");
CREATE INDEX "SalesProject_vendorId_status_updatedAt_idx" ON "SalesProject"("vendorId", "status", "updatedAt");

CREATE TABLE "SalesProjectProduct" (
  "id" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "productId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesProjectProduct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesProjectProduct_vendorId_projectId_productId_key" ON "SalesProjectProduct"("vendorId", "projectId", "productId");
CREATE INDEX "SalesProjectProduct_vendorId_projectId_sortOrder_idx" ON "SalesProjectProduct"("vendorId", "projectId", "sortOrder");
CREATE INDEX "SalesProjectProduct_vendorId_productId_idx" ON "SalesProjectProduct"("vendorId", "productId");

CREATE TABLE "SalesProjectCustomer" (
  "id" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "customerKeyHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesProjectCustomer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesProjectCustomer_vendorId_projectId_customerKeyHash_key" ON "SalesProjectCustomer"("vendorId", "projectId", "customerKeyHash");
CREATE INDEX "SalesProjectCustomer_vendorId_customerKeyHash_idx" ON "SalesProjectCustomer"("vendorId", "customerKeyHash");

CREATE TABLE "UserOnboardingPreference" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "questionnaireAnswers" JSONB,
  "questionnaireStep" INTEGER NOT NULL DEFAULT 0, "questionnaireDoneAt" TIMESTAMP(3),
  "recommendedMode" "SalesWorkspaceMode", "selectedMode" "SalesWorkspaceMode", "selectedProjectId" TEXT,
  "taskPanelCollapsed" BOOLEAN NOT NULL DEFAULT false, "taskPanelHiddenUntil" TIMESTAMP(3), "guideDismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserOnboardingPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserOnboardingPreference_userId_vendorId_key" ON "UserOnboardingPreference"("userId", "vendorId");
CREATE INDEX "UserOnboardingPreference_vendorId_selectedProjectId_idx" ON "UserOnboardingPreference"("vendorId", "selectedProjectId");

CREATE TABLE "OnboardingTaskState" (
  "id" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "projectId" TEXT, "scopeKey" TEXT NOT NULL, "taskKey" TEXT NOT NULL,
  "status" "OnboardingTaskStatus" NOT NULL DEFAULT 'not_started', "skipImpact" TEXT, "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingTaskState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OnboardingTaskState_vendorId_scopeKey_taskKey_key" ON "OnboardingTaskState"("vendorId", "scopeKey", "taskKey");
CREATE INDEX "OnboardingTaskState_vendorId_projectId_status_idx" ON "OnboardingTaskState"("vendorId", "projectId", "status");

ALTER TABLE "RegistrationForm" ADD COLUMN "projectId" TEXT;
ALTER TABLE "Live" ADD COLUMN "projectId" TEXT;
ALTER TABLE "ConsultationEvent" ADD COLUMN "projectId" TEXT;
ALTER TABLE "CommerceOrder" ADD COLUMN "projectId" TEXT;
ALTER TABLE "AnalyticsEvent" ADD COLUMN "projectId" TEXT;
CREATE INDEX "RegistrationForm_vendorId_projectId_idx" ON "RegistrationForm"("vendorId", "projectId");
CREATE INDEX "Live_vendorId_projectId_status_idx" ON "Live"("vendorId", "projectId", "status");
CREATE INDEX "ConsultationEvent_vendorId_projectId_isActive_idx" ON "ConsultationEvent"("vendorId", "projectId", "isActive");
CREATE INDEX "CommerceOrder_vendorId_projectId_status_createdAt_idx" ON "CommerceOrder"("vendorId", "projectId", "status", "createdAt");
CREATE INDEX "AnalyticsEvent_vendorId_projectId_createdAt_idx" ON "AnalyticsEvent"("vendorId", "projectId", "createdAt");

ALTER TABLE "SalesProject" ADD CONSTRAINT "SalesProject_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProjectProduct" ADD CONSTRAINT "SalesProjectProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProjectProduct" ADD CONSTRAINT "SalesProjectProduct_vendorId_projectId_fkey" FOREIGN KEY ("vendorId", "projectId") REFERENCES "SalesProject"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProjectProduct" ADD CONSTRAINT "SalesProjectProduct_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProjectCustomer" ADD CONSTRAINT "SalesProjectCustomer_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProjectCustomer" ADD CONSTRAINT "SalesProjectCustomer_vendorId_projectId_fkey" FOREIGN KEY ("vendorId", "projectId") REFERENCES "SalesProject"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesProjectCustomer" ADD CONSTRAINT "SalesProjectCustomer_vendorId_customerKeyHash_fkey" FOREIGN KEY ("vendorId", "customerKeyHash") REFERENCES "CustomerCrmRecord"("vendorId", "customerKeyHash") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserOnboardingPreference" ADD CONSTRAINT "UserOnboardingPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserOnboardingPreference" ADD CONSTRAINT "UserOnboardingPreference_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserOnboardingPreference" ADD CONSTRAINT "UserOnboardingPreference_vendorId_selectedProjectId_fkey" FOREIGN KEY ("vendorId", "selectedProjectId") REFERENCES "SalesProject"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OnboardingTaskState" ADD CONSTRAINT "OnboardingTaskState_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingTaskState" ADD CONSTRAINT "OnboardingTaskState_vendorId_projectId_fkey" FOREIGN KEY ("vendorId", "projectId") REFERENCES "SalesProject"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_vendorId_projectId_fkey" FOREIGN KEY ("vendorId", "projectId") REFERENCES "SalesProject"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Live" ADD CONSTRAINT "Live_vendorId_projectId_fkey" FOREIGN KEY ("vendorId", "projectId") REFERENCES "SalesProject"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsultationEvent" ADD CONSTRAINT "ConsultationEvent_vendorId_projectId_fkey" FOREIGN KEY ("vendorId", "projectId") REFERENCES "SalesProject"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_vendorId_projectId_fkey" FOREIGN KEY ("vendorId", "projectId") REFERENCES "SalesProject"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_vendorId_projectId_fkey" FOREIGN KEY ("vendorId", "projectId") REFERENCES "SalesProject"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
