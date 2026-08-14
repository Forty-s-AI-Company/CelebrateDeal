ALTER TYPE "AnalyticsTrustLevel"
ADD VALUE 'VERIFIED_FORM_SUBMISSION';

CREATE TYPE "FormSubmissionVerificationStatus" AS ENUM (
  'UNVERIFIED',
  'VERIFIED'
);

ALTER TABLE "FormSubmission"
ADD COLUMN "verificationStatus" "FormSubmissionVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "verificationVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "verificationExpiresAt" TIMESTAMP(3),
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "affiliateClickId" TEXT;

CREATE INDEX "FormSubmission_affiliateClickId_idx"
ON "FormSubmission"("affiliateClickId");

CREATE INDEX "FormSubmission_formId_verificationStatus_createdAt_idx"
ON "FormSubmission"("formId", "verificationStatus", "createdAt");

CREATE INDEX "FormSubmission_liveId_verificationStatus_createdAt_idx"
ON "FormSubmission"("liveId", "verificationStatus", "createdAt");

ALTER TABLE "FormSubmission"
ADD CONSTRAINT "FormSubmission_affiliateClickId_fkey"
FOREIGN KEY ("affiliateClickId") REFERENCES "AffiliateClick"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
