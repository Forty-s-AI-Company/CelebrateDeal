-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2563eb',
    "ctaColor" TEXT NOT NULL DEFAULT '#f97316',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Taipei',
    "supportEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorMember" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingSetting" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "facebookPixelId" TEXT,
    "tiktokPixelId" TEXT,
    "googleTagManagerId" TEXT,
    "enablePageView" BOOLEAN NOT NULL DEFAULT true,
    "enableLeadEvent" BOOLEAN NOT NULL DEFAULT true,
    "enablePurchaseEvent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackingSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "compareAtCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "imageUrl" TEXT,
    "checkoutUrl" TEXT,
    "inventory" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationForm" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "description" TEXT,
    "submitLabel" TEXT NOT NULL DEFAULT '送出報名',
    "fields" JSONB NOT NULL,
    "successMessage" TEXT NOT NULL DEFAULT '已收到你的資料，開播前會再提醒你。',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "liveId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "answers" JSONB,
    "source" TEXT NOT NULL DEFAULT 'form',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Live" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "videoId" TEXT,
    "formId" TEXT,
    "messageTemplateId" TEXT,
    "interactionScriptId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "heroImageUrl" TEXT,
    "accentCopy" TEXT,
    "replayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "streamMode" TEXT NOT NULL DEFAULT 'vod',
    "cloudflareLiveInputUid" TEXT,
    "quotaPolicy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Live_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveProduct" (
    "id" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "offerLabel" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LiveProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "trigger" TEXT NOT NULL DEFAULT 'registration_confirmed',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT,
    "eventType" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteractionRole" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "label" TEXT NOT NULL DEFAULT '官方角色',
    "roleType" TEXT NOT NULL DEFAULT 'official',
    "tone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InteractionRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteractionScript" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InteractionScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteractionEvent" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InteractionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blacklist" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "identifierType" TEXT NOT NULL DEFAULT 'email',
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unblockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" TEXT,
    "contactEmail" TEXT,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateClick" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "affiliateId" TEXT,
    "liveId" TEXT,
    "referralCode" TEXT,
    "visitorId" TEXT NOT NULL,
    "landingPath" TEXT NOT NULL,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "includedStreamMinutes" INTEGER NOT NULL DEFAULT 0,
    "includedStorageMinutes" INTEGER NOT NULL DEFAULT 0,
    "includedCredits" INTEGER NOT NULL DEFAULT 0,
    "includedEvents" INTEGER NOT NULL DEFAULT 0,
    "includedAffiliates" INTEGER NOT NULL DEFAULT 0,
    "overageCreditCostCents" INTEGER NOT NULL DEFAULT 0,
    "overflowWatchHourPriceCents" INTEGER NOT NULL DEFAULT 0,
    "overflowEventUnitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "overflowAffiliateUnitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "overflowStorageMinutePriceCents" INTEGER NOT NULL DEFAULT 0,
    "paymentServiceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "transactionFeeRateBps" INTEGER NOT NULL DEFAULT 0,
    "affiliateManagementFeeCents" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorSubscription" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "paymentMode" TEXT NOT NULL DEFAULT 'byo',
    "status" TEXT NOT NULL DEFAULT 'active',
    "customFeeRateBps" INTEGER,
    "billingCycleDay" INTEGER NOT NULL DEFAULT 5,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorUsageLimit" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "billingPlanId" TEXT,
    "streamMinutesLimit" INTEGER NOT NULL DEFAULT 0,
    "storageMinutesLimit" INTEGER NOT NULL DEFAULT 0,
    "creditsLimit" INTEGER NOT NULL DEFAULT 0,
    "streamMinutesUsed" INTEGER NOT NULL DEFAULT 0,
    "storageMinutesUsed" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorUsageLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "monthKey" TEXT,
    "recordType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "creditsDelta" INTEGER NOT NULL DEFAULT 0,
    "totalWatchMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalEvents" INTEGER NOT NULL DEFAULT 0,
    "totalAffiliates" INTEGER NOT NULL DEFAULT 0,
    "totalStorageMinutes" INTEGER NOT NULL DEFAULT 0,
    "overflowWatchMinutes" INTEGER NOT NULL DEFAULT 0,
    "overflowEvents" INTEGER NOT NULL DEFAULT 0,
    "overflowAffiliates" INTEGER NOT NULL DEFAULT 0,
    "overflowStorageMinutes" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceType" TEXT NOT NULL DEFAULT 'monthly',
    "monthlyFeeCents" INTEGER NOT NULL DEFAULT 0,
    "overflowFeeCents" INTEGER NOT NULL DEFAULT 0,
    "paymentServiceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "transactionServiceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "affiliateManagementFeeCents" INTEGER NOT NULL DEFAULT 0,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "monthlyFeeCents" INTEGER NOT NULL DEFAULT 0,
    "overflowFeeCents" INTEGER NOT NULL DEFAULT 0,
    "paymentServiceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "transactionServiceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "affiliateManagementFeeCents" INTEGER NOT NULL DEFAULT 0,
    "paymentGatewayFeeCents" INTEGER NOT NULL DEFAULT 0,
    "grossRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "payoutableAmountCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentAmountCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentReason" TEXT,
    "finalPayoutAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "payoutBatchId" TEXT,
    "payoutDate" TIMESTAMP(3),
    "batchNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "batchDate" TIMESTAMP(3) NOT NULL,
    "totalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "exportedFilePath" TEXT,
    "exportedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" TEXT NOT NULL,
    "payoutBatchId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "settlementId" TEXT,
    "bankAccountName" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "payoutAmountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retriedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'byo',
    "providerName" TEXT NOT NULL,
    "accountLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "apiKeyRef" TEXT,
    "merchantIdRef" TEXT,
    "bankAccountName" TEXT,
    "bankCode" TEXT,
    "bankAccountNumber" TEXT,
    "riskHoldEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerTradeNo" TEXT,
    "orderNumber" TEXT,
    "paymentMode" TEXT NOT NULL DEFAULT 'platform',
    "grossAmountCents" INTEGER NOT NULL DEFAULT 0,
    "gatewayFeeCents" INTEGER NOT NULL DEFAULT 0,
    "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
    "netAmountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "status" TEXT NOT NULL DEFAULT 'paid',
    "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "refundReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "providerEventId" TEXT,
    "monthKey" TEXT NOT NULL,
    "refundAmountCents" INTEGER NOT NULL,
    "gatewayFeeRefundCents" INTEGER NOT NULL DEFAULT 0,
    "platformFeeRefundCents" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "affiliateId" TEXT,
    "monthKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'product',
    "sourceId" TEXT,
    "referralCode" TEXT,
    "orderNumber" TEXT,
    "orderAmountCents" INTEGER NOT NULL DEFAULT 0,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 0,
    "commissionAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliatePayout" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "affiliateId" TEXT,
    "monthKey" TEXT NOT NULL,
    "commissionAmountCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentAmountCents" INTEGER NOT NULL DEFAULT 0,
    "finalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payoutItemId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliatePayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_slug_key" ON "Vendor"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VendorMember_vendorId_userId_key" ON "VendorMember"("vendorId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingSetting_vendorId_key" ON "TrackingSetting"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationForm_slug_key" ON "RegistrationForm"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Live_slug_key" ON "Live"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "LiveProduct_liveId_productId_key" ON "LiveProduct"("liveId", "productId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventType_createdAt_idx" ON "AnalyticsEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_liveId_createdAt_idx" ON "AnalyticsEvent"("liveId", "createdAt");

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
CREATE INDEX "VendorSubscription_vendorId_status_idx" ON "VendorSubscription"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VendorUsageLimit_vendorId_key" ON "VendorUsageLimit"("vendorId");

-- CreateIndex
CREATE INDEX "UsageRecord_vendorId_monthKey_idx" ON "UsageRecord"("vendorId", "monthKey");

-- CreateIndex
CREATE INDEX "UsageRecord_vendorId_createdAt_idx" ON "UsageRecord"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_recordType_createdAt_idx" ON "UsageRecord"("recordType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_vendorId_monthKey_idx" ON "Invoice"("vendorId", "monthKey");

-- CreateIndex
CREATE INDEX "Settlement_status_monthKey_idx" ON "Settlement"("status", "monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_vendorId_monthKey_key" ON "Settlement"("vendorId", "monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatch_batchNumber_key" ON "PayoutBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "PayoutItem_payoutBatchId_status_idx" ON "PayoutItem"("payoutBatchId", "status");

-- CreateIndex
CREATE INDEX "PayoutItem_vendorId_createdAt_idx" ON "PayoutItem"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAccount_vendorId_mode_idx" ON "PaymentAccount"("vendorId", "mode");

-- CreateIndex
CREATE INDEX "PaymentTransaction_vendorId_occurredAt_idx" ON "PaymentTransaction"("vendorId", "occurredAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_vendorId_orderNumber_idx" ON "PaymentTransaction"("vendorId", "orderNumber");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_occurredAt_idx" ON "PaymentTransaction"("status", "occurredAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_createdAt_idx" ON "WebhookEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_vendorId_createdAt_idx" ON "WebhookEvent"("vendorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "RefundRecord_vendorId_monthKey_idx" ON "RefundRecord"("vendorId", "monthKey");

-- CreateIndex
CREATE INDEX "RefundRecord_paymentTransactionId_processedAt_idx" ON "RefundRecord"("paymentTransactionId", "processedAt");

-- CreateIndex
CREATE INDEX "RefundRecord_paymentTransactionId_providerEventId_idx" ON "RefundRecord"("paymentTransactionId", "providerEventId");

-- CreateIndex
CREATE INDEX "AuditLog_vendorId_createdAt_idx" ON "AuditLog"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AffiliateCommission_vendorId_monthKey_idx" ON "AffiliateCommission"("vendorId", "monthKey");

-- CreateIndex
CREATE INDEX "AffiliateCommission_affiliateId_status_idx" ON "AffiliateCommission"("affiliateId", "status");

-- CreateIndex
CREATE INDEX "AffiliatePayout_vendorId_monthKey_idx" ON "AffiliatePayout"("vendorId", "monthKey");

-- CreateIndex
CREATE INDEX "AffiliatePayout_affiliateId_status_idx" ON "AffiliatePayout"("affiliateId", "status");

-- AddForeignKey
ALTER TABLE "VendorMember" ADD CONSTRAINT "VendorMember_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorMember" ADD CONSTRAINT "VendorMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingSetting" ADD CONSTRAINT "TrackingSetting_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "Live"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Live" ADD CONSTRAINT "Live_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Live" ADD CONSTRAINT "Live_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Live" ADD CONSTRAINT "Live_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Live" ADD CONSTRAINT "Live_messageTemplateId_fkey" FOREIGN KEY ("messageTemplateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Live" ADD CONSTRAINT "Live_interactionScriptId_fkey" FOREIGN KEY ("interactionScriptId") REFERENCES "InteractionScript"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveProduct" ADD CONSTRAINT "LiveProduct_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "Live"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveProduct" ADD CONSTRAINT "LiveProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "Live"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionRole" ADD CONSTRAINT "InteractionRole_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionScript" ADD CONSTRAINT "InteractionScript_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionEvent" ADD CONSTRAINT "InteractionEvent_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "InteractionScript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionEvent" ADD CONSTRAINT "InteractionEvent_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "InteractionRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blacklist" ADD CONSTRAINT "Blacklist_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "Live"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorSubscription" ADD CONSTRAINT "VendorSubscription_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorSubscription" ADD CONSTRAINT "VendorSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorUsageLimit" ADD CONSTRAINT "VendorUsageLimit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorUsageLimit" ADD CONSTRAINT "VendorUsageLimit_billingPlanId_fkey" FOREIGN KEY ("billingPlanId") REFERENCES "BillingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRecord" ADD CONSTRAINT "RefundRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRecord" ADD CONSTRAINT "RefundRecord_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
