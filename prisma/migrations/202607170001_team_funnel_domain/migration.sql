-- Team funnel domain model. This migration is forward-only and contains no data rewrite.

-- CreateEnum
CREATE TYPE "TeamMembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "TeamFunnelTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "TeamFunnelField" AS ENUM ('HEADLINE', 'SUBHEADLINE', 'BODY', 'CTA_LABEL', 'CTA_URL', 'PRODUCT_SLOTS');
CREATE TYPE "TeamPageAccessMode" AS ENUM ('PUBLIC', 'TOKEN_REQUIRED', 'DISABLED');
CREATE TYPE "TeamAttributionSource" AS ENUM ('REFERRAL', 'EXISTING_OWNER', 'MANUAL_OVERRIDE', 'DIRECT');

-- AlterTable
ALTER TABLE "Live" ADD COLUMN "teamId" TEXT;
ALTER TABLE "Live" ADD COLUMN "seminarOwnerMembershipId" TEXT;
ALTER TABLE "Live" ADD CONSTRAINT "Live_team_owner_pair_check" CHECK ("teamId" IS NOT NULL OR "seminarOwnerMembershipId" IS NULL);

-- Composite keys support tenant-scoped foreign keys.
CREATE UNIQUE INDEX "VendorMember_vendorId_id_key" ON "VendorMember"("vendorId", "id");
CREATE UNIQUE INDEX "Product_vendorId_id_key" ON "Product"("vendorId", "id");
CREATE UNIQUE INDEX "Live_vendorId_id_key" ON "Live"("vendorId", "id");
CREATE UNIQUE INDEX "Affiliate_vendorId_id_key" ON "Affiliate"("vendorId", "id");
CREATE UNIQUE INDEX "AffiliateClick_vendorId_id_key" ON "AffiliateClick"("vendorId", "id");
CREATE UNIQUE INDEX "PaymentTransaction_vendorId_id_key" ON "PaymentTransaction"("vendorId", "id");

-- CreateTable
CREATE TABLE "SalesTeam" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "vendorMemberId" TEXT NOT NULL,
    "affiliateId" TEXT,
    "status" "TeamMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeamMembership_lifecycle_check" CHECK ("leftAt" IS NULL OR "leftAt" >= "joinedAt")
);

CREATE TABLE "TeamMembershipRelationship" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "uplineMembershipId" TEXT NOT NULL,
    "downlineMembershipId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembershipRelationship_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeamMembershipRelationship_distinct_members_check" CHECK ("uplineMembershipId" <> "downlineMembershipId"),
    CONSTRAINT "TeamMembershipRelationship_period_check" CHECK ("endedAt" IS NULL OR "endedAt" > "effectiveAt")
);

CREATE TABLE "TeamFunnelTemplate" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TeamFunnelTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamFunnelTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamFunnelTemplateVersion" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentOwnerMembershipId" TEXT NOT NULL,
    "createdByMemberId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "subheadline" TEXT,
    "body" TEXT,
    "ctaLabel" TEXT NOT NULL,
    "ctaUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamFunnelTemplateVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeamFunnelTemplateVersion_version_check" CHECK ("version" > 0)
);

CREATE TABLE "TeamFunnelTemplateFieldLock" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "field" "TeamFunnelField" NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedByMemberId" TEXT NOT NULL,

    CONSTRAINT "TeamFunnelTemplateFieldLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamFunnelTemplateProductSlot" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "offerLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamFunnelTemplateProductSlot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerFunnelPage" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "promoterMembershipId" TEXT NOT NULL,
    "contentOwnerMembershipId" TEXT NOT NULL,
    "liveId" TEXT,
    "slug" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "subheadline" TEXT,
    "body" TEXT,
    "ctaLabel" TEXT NOT NULL,
    "ctaUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerFunnelPage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerFunnelPageShareSetting" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "accessMode" "TeamPageAccessMode" NOT NULL DEFAULT 'TOKEN_REQUIRED',
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerFunnelPageShareSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PartnerFunnelPageShareSetting_token_check" CHECK ("accessMode" <> 'TOKEN_REQUIRED' OR "tokenHash" IS NOT NULL),
    CONSTRAINT "PartnerFunnelPageShareSetting_usage_check" CHECK ("useCount" >= 0 AND ("maxUses" IS NULL OR ("maxUses" >= 0 AND "useCount" <= "maxUses")))
);

CREATE TABLE "PartnerProductSlotOverride" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "productSlotId" TEXT NOT NULL,
    "productId" TEXT,
    "overrideUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerProductSlotOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PartnerProductSlotOverride_target_check" CHECK ("productId" IS NOT NULL OR "overrideUrl" IS NOT NULL)
);

CREATE TABLE "TeamClickAttribution" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "affiliateClickId" TEXT NOT NULL,
    "pageId" TEXT,
    "leaderMembershipId" TEXT NOT NULL,
    "promoterMembershipId" TEXT NOT NULL,
    "contentOwnerMembershipId" TEXT NOT NULL,
    "seminarOwnerMembershipId" TEXT,
    "source" "TeamAttributionSource" NOT NULL,
    "referralCode" TEXT,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamClickAttribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamLeadAttribution" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "formSubmissionId" TEXT NOT NULL,
    "pageId" TEXT,
    "leaderMembershipId" TEXT NOT NULL,
    "promoterMembershipId" TEXT NOT NULL,
    "contentOwnerMembershipId" TEXT NOT NULL,
    "seminarOwnerMembershipId" TEXT,
    "source" "TeamAttributionSource" NOT NULL,
    "referralCode" TEXT,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamLeadAttribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamConversionAttribution" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "leadAttributionId" TEXT,
    "pageId" TEXT,
    "leaderMembershipId" TEXT NOT NULL,
    "promoterMembershipId" TEXT NOT NULL,
    "contentOwnerMembershipId" TEXT NOT NULL,
    "seminarOwnerMembershipId" TEXT,
    "source" "TeamAttributionSource" NOT NULL,
    "referralCode" TEXT,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamConversionAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesTeam_vendorId_slug_key" ON "SalesTeam"("vendorId", "slug");
CREATE UNIQUE INDEX "SalesTeam_vendorId_id_key" ON "SalesTeam"("vendorId", "id");

CREATE UNIQUE INDEX "TeamMembership_teamId_vendorMemberId_key" ON "TeamMembership"("teamId", "vendorMemberId");
CREATE UNIQUE INDEX "TeamMembership_vendorId_affiliateId_key" ON "TeamMembership"("vendorId", "affiliateId");
CREATE UNIQUE INDEX "TeamMembership_teamId_id_key" ON "TeamMembership"("teamId", "id");
CREATE INDEX "TeamMembership_vendorId_vendorMemberId_status_idx" ON "TeamMembership"("vendorId", "vendorMemberId", "status");
CREATE INDEX "TeamMembership_teamId_status_idx" ON "TeamMembership"("teamId", "status");

CREATE UNIQUE INDEX "TeamMembershipRelationship_downlineMembershipId_effectiveAt_key" ON "TeamMembershipRelationship"("downlineMembershipId", "effectiveAt");
CREATE UNIQUE INDEX "TeamMembershipRelationship_one_active_upline" ON "TeamMembershipRelationship"("downlineMembershipId") WHERE "endedAt" IS NULL;
CREATE INDEX "TeamMembershipRelationship_teamId_uplineMembershipId_endedAt_idx" ON "TeamMembershipRelationship"("teamId", "uplineMembershipId", "endedAt");
CREATE INDEX "TeamMembershipRelationship_teamId_downlineMembershipId_endedAt_idx" ON "TeamMembershipRelationship"("teamId", "downlineMembershipId", "endedAt");

CREATE UNIQUE INDEX "TeamFunnelTemplate_teamId_name_key" ON "TeamFunnelTemplate"("teamId", "name");
CREATE UNIQUE INDEX "TeamFunnelTemplate_teamId_id_key" ON "TeamFunnelTemplate"("teamId", "id");
CREATE INDEX "TeamFunnelTemplate_vendorId_status_idx" ON "TeamFunnelTemplate"("vendorId", "status");

CREATE UNIQUE INDEX "TeamFunnelTemplateVersion_templateId_version_key" ON "TeamFunnelTemplateVersion"("templateId", "version");
CREATE UNIQUE INDEX "TeamFunnelTemplateVersion_teamId_id_key" ON "TeamFunnelTemplateVersion"("teamId", "id");
CREATE UNIQUE INDEX "TeamFunnelTemplateVersion_vendorId_id_key" ON "TeamFunnelTemplateVersion"("vendorId", "id");
CREATE INDEX "TeamFunnelTemplateVersion_teamId_createdAt_idx" ON "TeamFunnelTemplateVersion"("teamId", "createdAt");

CREATE UNIQUE INDEX "TeamFunnelTemplateFieldLock_templateVersionId_field_key" ON "TeamFunnelTemplateFieldLock"("templateVersionId", "field");

CREATE UNIQUE INDEX "TeamFunnelTemplateProductSlot_templateVersionId_slotKey_key" ON "TeamFunnelTemplateProductSlot"("templateVersionId", "slotKey");
CREATE UNIQUE INDEX "TeamFunnelTemplateProductSlot_templateVersionId_displayOrder_key" ON "TeamFunnelTemplateProductSlot"("templateVersionId", "displayOrder");
CREATE UNIQUE INDEX "TeamFunnelTemplateProductSlot_vendorId_id_key" ON "TeamFunnelTemplateProductSlot"("vendorId", "id");
CREATE INDEX "TeamFunnelTemplateProductSlot_vendorId_productId_idx" ON "TeamFunnelTemplateProductSlot"("vendorId", "productId");

CREATE UNIQUE INDEX "PartnerFunnelPage_slug_key" ON "PartnerFunnelPage"("slug");
CREATE UNIQUE INDEX "PartnerFunnelPage_templateVersionId_promoterMembershipId_key" ON "PartnerFunnelPage"("templateVersionId", "promoterMembershipId");
CREATE UNIQUE INDEX "PartnerFunnelPage_vendorId_id_key" ON "PartnerFunnelPage"("vendorId", "id");
CREATE INDEX "PartnerFunnelPage_teamId_promoterMembershipId_idx" ON "PartnerFunnelPage"("teamId", "promoterMembershipId");

CREATE UNIQUE INDEX "PartnerFunnelPageShareSetting_pageId_key" ON "PartnerFunnelPageShareSetting"("pageId");
CREATE UNIQUE INDEX "PartnerFunnelPageShareSetting_tokenHash_key" ON "PartnerFunnelPageShareSetting"("tokenHash");
CREATE INDEX "PartnerFunnelPageShareSetting_accessMode_isEnabled_expiresAt_idx" ON "PartnerFunnelPageShareSetting"("accessMode", "isEnabled", "expiresAt");

CREATE UNIQUE INDEX "PartnerProductSlotOverride_pageId_productSlotId_key" ON "PartnerProductSlotOverride"("pageId", "productSlotId");
CREATE INDEX "PartnerProductSlotOverride_productId_idx" ON "PartnerProductSlotOverride"("productId");

CREATE UNIQUE INDEX "TeamClickAttribution_vendorId_affiliateClickId_key" ON "TeamClickAttribution"("vendorId", "affiliateClickId");
CREATE INDEX "TeamClickAttribution_teamId_promoterMembershipId_attributedAt_idx" ON "TeamClickAttribution"("teamId", "promoterMembershipId", "attributedAt");
CREATE INDEX "TeamClickAttribution_teamId_leaderMembershipId_attributedAt_idx" ON "TeamClickAttribution"("teamId", "leaderMembershipId", "attributedAt");

CREATE UNIQUE INDEX "TeamLeadAttribution_formSubmissionId_key" ON "TeamLeadAttribution"("formSubmissionId");
CREATE INDEX "TeamLeadAttribution_teamId_promoterMembershipId_attributedAt_idx" ON "TeamLeadAttribution"("teamId", "promoterMembershipId", "attributedAt");
CREATE INDEX "TeamLeadAttribution_teamId_leaderMembershipId_attributedAt_idx" ON "TeamLeadAttribution"("teamId", "leaderMembershipId", "attributedAt");

CREATE UNIQUE INDEX "TeamConversionAttribution_vendorId_paymentTransactionId_key" ON "TeamConversionAttribution"("vendorId", "paymentTransactionId");
CREATE INDEX "TeamConversionAttribution_teamId_promoterMembershipId_attributedAt_idx" ON "TeamConversionAttribution"("teamId", "promoterMembershipId", "attributedAt");
CREATE INDEX "TeamConversionAttribution_teamId_leaderMembershipId_attributedAt_idx" ON "TeamConversionAttribution"("teamId", "leaderMembershipId", "attributedAt");
CREATE INDEX "TeamConversionAttribution_leadAttributionId_idx" ON "TeamConversionAttribution"("leadAttributionId");

-- AddForeignKey
ALTER TABLE "Live" ADD CONSTRAINT "Live_vendorId_teamId_fkey" FOREIGN KEY ("vendorId", "teamId") REFERENCES "SalesTeam"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Live" ADD CONSTRAINT "Live_teamId_seminarOwnerMembershipId_fkey" FOREIGN KEY ("teamId", "seminarOwnerMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesTeam" ADD CONSTRAINT "SalesTeam_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_vendorId_teamId_fkey" FOREIGN KEY ("vendorId", "teamId") REFERENCES "SalesTeam"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_vendorId_vendorMemberId_fkey" FOREIGN KEY ("vendorId", "vendorMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_vendorId_affiliateId_fkey" FOREIGN KEY ("vendorId", "affiliateId") REFERENCES "Affiliate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeamMembershipRelationship" ADD CONSTRAINT "TeamMembershipRelationship_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMembershipRelationship" ADD CONSTRAINT "TeamMembershipRelationship_teamId_uplineMembershipId_fkey" FOREIGN KEY ("teamId", "uplineMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamMembershipRelationship" ADD CONSTRAINT "TeamMembershipRelationship_teamId_downlineMembershipId_fkey" FOREIGN KEY ("teamId", "downlineMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeamFunnelTemplate" ADD CONSTRAINT "TeamFunnelTemplate_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamFunnelTemplate" ADD CONSTRAINT "TeamFunnelTemplate_vendorId_teamId_fkey" FOREIGN KEY ("vendorId", "teamId") REFERENCES "SalesTeam"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamFunnelTemplateVersion" ADD CONSTRAINT "TeamFunnelTemplateVersion_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamFunnelTemplateVersion" ADD CONSTRAINT "TeamFunnelTemplateVersion_vendorId_teamId_fkey" FOREIGN KEY ("vendorId", "teamId") REFERENCES "SalesTeam"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamFunnelTemplateVersion" ADD CONSTRAINT "TeamFunnelTemplateVersion_teamId_templateId_fkey" FOREIGN KEY ("teamId", "templateId") REFERENCES "TeamFunnelTemplate"("teamId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamFunnelTemplateVersion" ADD CONSTRAINT "TeamFunnelTemplateVersion_teamId_contentOwnerMembershipId_fkey" FOREIGN KEY ("teamId", "contentOwnerMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamFunnelTemplateVersion" ADD CONSTRAINT "TeamFunnelTemplateVersion_vendorId_createdByMemberId_fkey" FOREIGN KEY ("vendorId", "createdByMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeamFunnelTemplateFieldLock" ADD CONSTRAINT "TeamFunnelTemplateFieldLock_vendorId_templateVersionId_fkey" FOREIGN KEY ("vendorId", "templateVersionId") REFERENCES "TeamFunnelTemplateVersion"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamFunnelTemplateFieldLock" ADD CONSTRAINT "TeamFunnelTemplateFieldLock_vendorId_lockedByMemberId_fkey" FOREIGN KEY ("vendorId", "lockedByMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeamFunnelTemplateProductSlot" ADD CONSTRAINT "TeamFunnelTemplateProductSlot_vendorId_templateVersionId_fkey" FOREIGN KEY ("vendorId", "templateVersionId") REFERENCES "TeamFunnelTemplateVersion"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamFunnelTemplateProductSlot" ADD CONSTRAINT "TeamFunnelTemplateProductSlot_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartnerFunnelPage" ADD CONSTRAINT "PartnerFunnelPage_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerFunnelPage" ADD CONSTRAINT "PartnerFunnelPage_vendorId_teamId_fkey" FOREIGN KEY ("vendorId", "teamId") REFERENCES "SalesTeam"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerFunnelPage" ADD CONSTRAINT "PartnerFunnelPage_teamId_templateVersionId_fkey" FOREIGN KEY ("teamId", "templateVersionId") REFERENCES "TeamFunnelTemplateVersion"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerFunnelPage" ADD CONSTRAINT "PartnerFunnelPage_teamId_promoterMembershipId_fkey" FOREIGN KEY ("teamId", "promoterMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerFunnelPage" ADD CONSTRAINT "PartnerFunnelPage_teamId_contentOwnerMembershipId_fkey" FOREIGN KEY ("teamId", "contentOwnerMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerFunnelPage" ADD CONSTRAINT "PartnerFunnelPage_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartnerFunnelPageShareSetting" ADD CONSTRAINT "PartnerFunnelPageShareSetting_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "PartnerFunnelPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerProductSlotOverride" ADD CONSTRAINT "PartnerProductSlotOverride_vendorId_pageId_fkey" FOREIGN KEY ("vendorId", "pageId") REFERENCES "PartnerFunnelPage"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerProductSlotOverride" ADD CONSTRAINT "PartnerProductSlotOverride_vendorId_productSlotId_fkey" FOREIGN KEY ("vendorId", "productSlotId") REFERENCES "TeamFunnelTemplateProductSlot"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerProductSlotOverride" ADD CONSTRAINT "PartnerProductSlotOverride_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeamClickAttribution" ADD CONSTRAINT "TeamClickAttribution_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamClickAttribution" ADD CONSTRAINT "TeamClickAttribution_vendorId_teamId_fkey" FOREIGN KEY ("vendorId", "teamId") REFERENCES "SalesTeam"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamClickAttribution" ADD CONSTRAINT "TeamClickAttribution_vendorId_affiliateClickId_fkey" FOREIGN KEY ("vendorId", "affiliateClickId") REFERENCES "AffiliateClick"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamClickAttribution" ADD CONSTRAINT "TeamClickAttribution_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "PartnerFunnelPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamClickAttribution" ADD CONSTRAINT "TeamClickAttribution_teamId_leaderMembershipId_fkey" FOREIGN KEY ("teamId", "leaderMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamClickAttribution" ADD CONSTRAINT "TeamClickAttribution_teamId_promoterMembershipId_fkey" FOREIGN KEY ("teamId", "promoterMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamClickAttribution" ADD CONSTRAINT "TeamClickAttribution_teamId_contentOwnerMembershipId_fkey" FOREIGN KEY ("teamId", "contentOwnerMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamClickAttribution" ADD CONSTRAINT "TeamClickAttribution_teamId_seminarOwnerMembershipId_fkey" FOREIGN KEY ("teamId", "seminarOwnerMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeamLeadAttribution" ADD CONSTRAINT "TeamLeadAttribution_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamLeadAttribution" ADD CONSTRAINT "TeamLeadAttribution_vendorId_teamId_fkey" FOREIGN KEY ("vendorId", "teamId") REFERENCES "SalesTeam"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamLeadAttribution" ADD CONSTRAINT "TeamLeadAttribution_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamLeadAttribution" ADD CONSTRAINT "TeamLeadAttribution_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "PartnerFunnelPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamLeadAttribution" ADD CONSTRAINT "TeamLeadAttribution_teamId_leaderMembershipId_fkey" FOREIGN KEY ("teamId", "leaderMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamLeadAttribution" ADD CONSTRAINT "TeamLeadAttribution_teamId_promoterMembershipId_fkey" FOREIGN KEY ("teamId", "promoterMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamLeadAttribution" ADD CONSTRAINT "TeamLeadAttribution_teamId_contentOwnerMembershipId_fkey" FOREIGN KEY ("teamId", "contentOwnerMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamLeadAttribution" ADD CONSTRAINT "TeamLeadAttribution_teamId_seminarOwnerMembershipId_fkey" FOREIGN KEY ("teamId", "seminarOwnerMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeamConversionAttribution" ADD CONSTRAINT "TeamConversionAttribution_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamConversionAttribution" ADD CONSTRAINT "TeamConversionAttribution_vendorId_teamId_fkey" FOREIGN KEY ("vendorId", "teamId") REFERENCES "SalesTeam"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamConversionAttribution" ADD CONSTRAINT "TeamConversionAttribution_vendorId_paymentTransactionId_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamConversionAttribution" ADD CONSTRAINT "TeamConversionAttribution_leadAttributionId_fkey" FOREIGN KEY ("leadAttributionId") REFERENCES "TeamLeadAttribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamConversionAttribution" ADD CONSTRAINT "TeamConversionAttribution_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "PartnerFunnelPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamConversionAttribution" ADD CONSTRAINT "TeamConversionAttribution_teamId_leaderMembershipId_fkey" FOREIGN KEY ("teamId", "leaderMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamConversionAttribution" ADD CONSTRAINT "TeamConversionAttribution_teamId_promoterMembershipId_fkey" FOREIGN KEY ("teamId", "promoterMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamConversionAttribution" ADD CONSTRAINT "TeamConversionAttribution_teamId_contentOwnerMembershipId_fkey" FOREIGN KEY ("teamId", "contentOwnerMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamConversionAttribution" ADD CONSTRAINT "TeamConversionAttribution_teamId_seminarOwnerMembershipId_fkey" FOREIGN KEY ("teamId", "seminarOwnerMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
