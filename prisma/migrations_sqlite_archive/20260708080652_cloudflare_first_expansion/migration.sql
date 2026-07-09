-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VendorMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorMember_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VendorMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InteractionRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "label" TEXT NOT NULL DEFAULT '官方角色',
    "roleType" TEXT NOT NULL DEFAULT 'official',
    "tone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InteractionRole_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InteractionScript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InteractionScript_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InteractionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scriptId" TEXT NOT NULL,
    "roleId" TEXT,
    "eventType" TEXT NOT NULL,
    "triggerSec" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "productId" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InteractionEvent_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "InteractionScript" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InteractionEvent_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "InteractionRole" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Blacklist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "identifierType" TEXT NOT NULL DEFAULT 'email',
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "blockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unblockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Blacklist_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" TEXT,
    "contactEmail" TEXT,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Affiliate_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AffiliateClick" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "affiliateId" TEXT,
    "liveId" TEXT,
    "referralCode" TEXT,
    "visitorId" TEXT NOT NULL,
    "landingPath" TEXT NOT NULL,
    "convertedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateClick_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AffiliateClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AffiliateClick_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "Live" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "includedStreamMinutes" INTEGER NOT NULL DEFAULT 0,
    "includedStorageMinutes" INTEGER NOT NULL DEFAULT 0,
    "includedCredits" INTEGER NOT NULL DEFAULT 0,
    "overageCreditCostCents" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VendorUsageLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "billingPlanId" TEXT,
    "streamMinutesLimit" INTEGER NOT NULL DEFAULT 0,
    "storageMinutesLimit" INTEGER NOT NULL DEFAULT 0,
    "creditsLimit" INTEGER NOT NULL DEFAULT 0,
    "streamMinutesUsed" INTEGER NOT NULL DEFAULT 0,
    "storageMinutesUsed" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "resetAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VendorUsageLimit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VendorUsageLimit_billingPlanId_fkey" FOREIGN KEY ("billingPlanId") REFERENCES "BillingPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "creditsDelta" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Live" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "videoId" TEXT,
    "formId" TEXT,
    "messageTemplateId" TEXT,
    "interactionScriptId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "heroImageUrl" TEXT,
    "accentCopy" TEXT,
    "replayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "streamMode" TEXT NOT NULL DEFAULT 'vod',
    "cloudflareLiveInputUid" TEXT,
    "quotaPolicy" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Live_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Live_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Live_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Live_messageTemplateId_fkey" FOREIGN KEY ("messageTemplateId") REFERENCES "MessageTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Live_interactionScriptId_fkey" FOREIGN KEY ("interactionScriptId") REFERENCES "InteractionScript" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Live" ("accentCopy", "createdAt", "description", "formId", "heroImageUrl", "id", "replayEnabled", "scheduledAt", "slug", "status", "title", "updatedAt", "vendorId", "videoId") SELECT "accentCopy", "createdAt", "description", "formId", "heroImageUrl", "id", "replayEnabled", "scheduledAt", "slug", "status", "title", "updatedAt", "vendorId", "videoId" FROM "Live";
DROP TABLE "Live";
ALTER TABLE "new_Live" RENAME TO "Live";
CREATE UNIQUE INDEX "Live_slug_key" ON "Live"("slug");
CREATE TABLE "new_Video" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'cloudflare_stream',
    "videoUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "cloudflareStreamUid" TEXT,
    "cloudflareLiveInputUid" TEXT,
    "cloudflarePlaybackId" TEXT,
    "cloudflareReadyToStream" BOOLEAN NOT NULL DEFAULT false,
    "liveStreamKey" TEXT,
    "liveInputStatus" TEXT,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Video_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Video" ("createdAt", "description", "durationSec", "id", "sourceType", "status", "thumbnailUrl", "title", "updatedAt", "vendorId", "videoUrl") SELECT "createdAt", "description", "durationSec", "id", "sourceType", "status", "thumbnailUrl", "title", "updatedAt", "vendorId", "videoUrl" FROM "Video";
DROP TABLE "Video";
ALTER TABLE "new_Video" RENAME TO "Video";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VendorMember_vendorId_userId_key" ON "VendorMember"("vendorId", "userId");

-- CreateIndex
CREATE INDEX "Blacklist_vendorId_identifier_idx" ON "Blacklist"("vendorId", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");

-- CreateIndex
CREATE INDEX "AffiliateClick_referralCode_createdAt_idx" ON "AffiliateClick"("referralCode", "createdAt");

-- CreateIndex
CREATE INDEX "AffiliateClick_liveId_createdAt_idx" ON "AffiliateClick"("liveId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlan_code_key" ON "BillingPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "VendorUsageLimit_vendorId_key" ON "VendorUsageLimit"("vendorId");

-- CreateIndex
CREATE INDEX "UsageRecord_vendorId_createdAt_idx" ON "UsageRecord"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_recordType_createdAt_idx" ON "UsageRecord"("recordType", "createdAt");
