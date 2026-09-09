BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$ BEGIN IF current_database() NOT IN ('celebratedeal_dev_audit_rehearsal', 'celebratedeal_dev_audit_final', 'celebratedeal_dev_audit_verified', 'celebratedeal_dev_audit_release', 'celebratedeal_dev') THEN RAISE EXCEPTION 'Local development database required'; END IF; END $$;
-- Save checksums of every original column without returning any row contents.
CREATE TEMP TABLE audit_original_rows (table_name text, columns_sql text, digest text, row_count bigint) ON COMMIT DROP;
DO $$ DECLARE t record; cols text; hash text; n bigint; BEGIN
 FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' LOOP
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position) INTO cols FROM information_schema.columns WHERE table_schema='public' AND table_name=t.table_name;
  EXECUTE format('SELECT md5(coalesce(string_agg(md5(row_to_json(r)::text), %L ORDER BY md5(row_to_json(r)::text)), %L)), count(*) FROM (SELECT %s FROM public.%I) r', '', '', cols, t.table_name) INTO hash,n;
  INSERT INTO audit_original_rows VALUES(t.table_name,cols,hash,n);
 END LOOP;
END $$;
-- WP-13 is forward-only. This migration deliberately fails before contract if
-- an active legacy source-less commission cannot be mapped to a trusted token.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AffiliateCommission"
    WHERE btrim("sourceType") = ''
  ) THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: blank sourceType exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "AffiliateCommission"
    WHERE "status" NOT IN ('pending', 'approved', 'locked', 'paid', 'void')
  ) THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: unknown status exists';
  END IF;

  -- A non-terminal row without a provider source can still be replayed. It
  -- cannot be safely guessed from amounts, dates, order numbers or referral codes.
  IF EXISTS (
    SELECT 1 FROM "AffiliateCommission"
    WHERE "sourceId" IS NULL
      AND "status" IN ('pending', 'approved', 'locked')
  ) THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: active NULL sourceId needs manual idempotency mapping';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "AffiliateCommission"
    WHERE ("sourceType" = 'refund_adjustment'
      AND NOT ("orderAmountCents" <= "commissionAmountCents" AND "commissionAmountCents" <= 0))
      OR ("sourceType" <> 'refund_adjustment'
        AND NOT ("orderAmountCents" >= 0 AND "commissionAmountCents" >= 0
          AND "commissionAmountCents" <= "orderAmountCents"))
  ) THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: legacy amount constraints fail';
  END IF;
END $$;


CREATE TYPE "StreamUsageReconciliationStatus" AS ENUM ('MATCHED', 'MISMATCH', 'RESOLVED');

CREATE TYPE "StreamUsageReconciliationResolution" AS ENUM ('ACCEPT_INTERNAL', 'ACCEPT_PROVIDER', 'ESCALATED');

CREATE TYPE "StreamUsageReconciliationEvidenceKind" AS ENUM ('ADMIN_ATTESTED_DIGEST');

CREATE TYPE "StreamOperationsAlertType" AS ENUM ('QUOTA_WARNING', 'QUOTA_EXHAUSTED', 'PROVIDER_DISCREPANCY');

CREATE TYPE "StreamOperationsAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TYPE "StreamOperationsAlertSeverity" AS ENUM ('WARNING', 'CRITICAL');

CREATE TYPE "LiveQuestionStatus" AS ENUM ('pending', 'spotlight', 'answered', 'hidden');

CREATE TYPE "FormSubmissionVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED');

CREATE TYPE "AnalyticsTrustLevel" AS ENUM ('LEGACY_UNVERIFIED', 'ADMITTED_LIVE_SESSION', 'VERIFIED_FORM_SUBMISSION');

CREATE TYPE "ElectronicInvoiceStatus" AS ENUM ('queued', 'issued', 'allowance', 'voided');

CREATE TYPE "SupportCaseStatus" AS ENUM ('open', 'in_progress', 'waiting_customer', 'waiting_finance', 'resolved', 'closed');

CREATE TYPE "SupportCasePriority" AS ENUM ('p0', 'p1', 'p2');

CREATE TYPE "SupportCaseCategory" AS ENUM ('payment', 'refund', 'fulfillment', 'access', 'general');

CREATE TYPE "SupportCaseEventType" AS ENUM ('created', 'note_added', 'buyer_reply_added', 'customer_reply_added', 'status_changed', 'assignment_changed', 'refund_requested', 'refund_review_started', 'refund_declined', 'refund_completed');

CREATE TYPE "SupportCaseEventAudience" AS ENUM ('internal', 'buyer');

CREATE TYPE "SupportRefundHandoffStatus" AS ENUM ('requested', 'reviewing', 'declined', 'completed');

CREATE TYPE "CommissionRuleStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TYPE "CommerceFulfillmentType" AS ENUM ('physical', 'digital', 'service', 'course');

CREATE TYPE "ProductDeliveryConfigStatus" AS ENUM ('draft', 'active', 'disabled');

CREATE TYPE "ProductDeliveryKind" AS ENUM ('digital_link', 'course_portal', 'service_instructions');

CREATE TYPE "CommerceOrderStatus" AS ENUM ('draft', 'pending_payment', 'paid', 'payment_failed', 'expired', 'cancelled', 'partially_refunded', 'refunded');

CREATE TYPE "ShippingFulfillmentStatus" AS ENUM ('pending', 'packing', 'shipped', 'refund_review', 'delivered', 'returned', 'cancelled');

CREATE TYPE "CommerceEntitlementStatus" AS ENUM ('pending', 'granted', 'revoked');

CREATE TYPE "ServiceFulfillmentStatus" AS ENUM ('pending', 'scheduling', 'scheduled', 'completed', 'cancelled');

CREATE TYPE "CommerceOrderRefundStatus" AS ENUM ('pending', 'processed', 'failed');

CREATE TYPE "AffiliateCommissionLedgerEntryType" AS ENUM ('opening_balance', 'accrual', 'refund', 'reversal', 'dispute_opened', 'dispute_released', 'dispute_lost');

CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('pending', 'approved', 'locked', 'paid', 'void');

CREATE TYPE "CourseCommissionLedgerEntryType" AS ENUM ('opening_balance', 'accrual', 'refund', 'reversal', 'dispute_opened', 'dispute_released', 'dispute_lost');

CREATE TYPE "CustomerConsultationStatus" AS ENUM ('following_up', 'closed_won', 'closed_lost', 'no_show');

CREATE TYPE "ConsultationBookingStatus" AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');

CREATE TYPE "StudentPortalAccessTokenPurpose" AS ENUM ('magic_link', 'checkout_redirect');

ALTER TABLE "Affiliate" ADD COLUMN     "bankAccountEncrypted" TEXT,
ADD COLUMN     "taxIdentityEncrypted" TEXT,
ADD COLUMN     "userId" TEXT;

ALTER TABLE "AffiliateCommission" ADD COLUMN     "appliedRateBps" INTEGER,
ADD COLUMN     "calculationSnapshot" JSONB,
ADD COLUMN     "commissionBaseAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionRuleSetId" TEXT,
ADD COLUMN     "commissionRuleVersion" INTEGER,
ADD COLUMN     "cumulativeSalesAfterCount" INTEGER,
ADD COLUMN     "cumulativeSalesBeforeCount" INTEGER,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'TWD',
ADD COLUMN     "deduplicationKey" TEXT,
ADD COLUMN     "matchedTier" JSONB,
ADD COLUMN     "monthlySalesAfterCents" INTEGER,
ADD COLUMN     "monthlySalesBeforeCents" INTEGER,
ADD COLUMN     "netReferenceAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "orderQuantity" INTEGER,
ADD COLUMN     "policyVersion" INTEGER,
ADD COLUMN     "recipientRole" TEXT NOT NULL DEFAULT 'promoter',
ADD COLUMN     "uplineLevel" INTEGER;

ALTER TABLE "AffiliatePayout" ADD COLUMN     "bankFeeCents" INTEGER,
ADD COLUMN     "grossAmountCents" INTEGER,
ADD COLUMN     "grossSalesAmountCents" INTEGER,
ADD COLUMN     "netPayoutAmountCents" INTEGER,
ADD COLUMN     "netReferenceAmountCents" INTEGER,
ADD COLUMN     "nhiSupplementaryTaxCents" INTEGER,
ADD COLUMN     "outcomeReason" TEXT,
ADD COLUMN     "outcomeReference" TEXT,
ADD COLUMN     "requestedAt" TIMESTAMP(3),
ADD COLUMN     "requestedBankAccountEncrypted" TEXT,
ADD COLUMN     "requestedTaxIdentityEncrypted" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "taxCategory" TEXT NOT NULL DEFAULT '92_other',
ADD COLUMN     "withholdingRuleVersion" TEXT,
ADD COLUMN     "withholdingTaxCents" INTEGER,
ALTER COLUMN "affiliateId" SET NOT NULL;

ALTER TABLE "AnalyticsEvent" ADD COLUMN     "trustLevel" "AnalyticsTrustLevel" NOT NULL DEFAULT 'LEGACY_UNVERIFIED';

ALTER TABLE "CourseLesson" ADD COLUMN     "chapterTitle" TEXT,
ADD COLUMN     "durationSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "position" INTEGER,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "videoUrl" TEXT;

ALTER TABLE "FormSubmission" ADD COLUMN     "affiliateClickId" TEXT,
ADD COLUMN     "attribution" JSONB,
ADD COLUMN     "customerKeyHash" TEXT,
ADD COLUMN     "verificationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "verificationStatus" "FormSubmissionVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "verificationVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

ALTER TABLE "InteractionEvent" ADD COLUMN     "isSimulated" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "InteractionRole" ADD COLUMN     "isScheduled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSimulated" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Live" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "evergreenConsultationAtSeconds" INTEGER,
ADD COLUMN     "evergreenDailyTimes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "evergreenIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "evergreenPitchAtSeconds" INTEGER,
ADD COLUMN     "evergreenPreviewEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "evergreenPreviewRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "evergreenScheduleMode" TEXT NOT NULL DEFAULT 'just_in_time',
ADD COLUMN     "evergreenSessionStartAt" TIMESTAMP(3),
ADD COLUMN     "heroImageAssetId" TEXT,
ADD COLUMN     "isEvergreen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liveReminderOffsetMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "liveReminderTemplateId" TEXT,
ADD COLUMN     "replayAvailableUntil" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

ALTER TABLE "LiveProduct" ADD COLUMN     "isVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "offerPriceCents" INTEGER,
ADD COLUMN     "vendorId" TEXT;

ALTER TABLE "PaymentAccount" ADD COLUMN     "bankAccountEncrypted" TEXT;

ALTER TABLE "PaymentTransaction" ADD COLUMN     "checkoutIdempotencyKey" TEXT;

ALTER TABLE "PayoutItem" ADD COLUMN     "bankAccountEncrypted" TEXT,
ADD COLUMN     "outcomeReference" TEXT;

ALTER TABLE "Product" ADD COLUMN     "commerceDomain" TEXT NOT NULL DEFAULT 'merchant',
ADD COLUMN     "courseContentOwnerMembershipId" TEXT,
ADD COLUMN     "coursePolicyVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "coursePromoterShareBps" INTEGER,
ADD COLUMN     "customCheckoutFields" JSONB,
ADD COLUMN     "downsellProductId" TEXT,
ADD COLUMN     "fulfillmentType" "CommerceFulfillmentType" NOT NULL DEFAULT 'physical',
ADD COLUMN     "fulfillmentTypeConfirmed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "imageAssetId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "upsellDiscountCents" INTEGER,
ADD COLUMN     "upsellProductId" TEXT;

ALTER TABLE "RegistrationForm" ADD COLUMN     "archetype" TEXT,
ADD COLUMN     "backgroundImageAssetId" TEXT,
ADD COLUMN     "backgroundImageUrl" TEXT,
ADD COLUMN     "bodyContent" TEXT,
ADD COLUMN     "countdownMinutes" INTEGER,
ADD COLUMN     "heroImageAssetId" TEXT,
ADD COLUMN     "heroImageUrl" TEXT,
ADD COLUMN     "hideExpiredSessions" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxVisibleSessions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notice" TEXT,
ADD COLUMN     "pageBlocks" JSONB,
ADD COLUMN     "promoVideoId" TEXT,
ADD COLUMN     "seoDescription" TEXT,
ADD COLUMN     "seoTitle" TEXT,
ADD COLUMN     "stickyText" TEXT,
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "themeColor" TEXT;

ALTER TABLE "TrackingSetting" ADD COLUMN     "facebookAccessTokenEncrypted" TEXT,
ADD COLUMN     "facebookTestEventCode" TEXT;

ALTER TABLE "VendorMember" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Video" ADD COLUMN     "thumbnailAssetId" TEXT;
ALTER TABLE "AffiliateCommission" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "AffiliateCommission" ALTER COLUMN "status" TYPE "AffiliateCommissionStatus" USING "status"::"AffiliateCommissionStatus";
ALTER TABLE "AffiliateCommission" ALTER COLUMN "status" SET DEFAULT 'pending';
-- Prisma expected DROP COLUMN to remove this index; in-place conversion kept it.
DROP INDEX "AffiliateCommission_affiliateId_status_idx";
DO $migration$
DECLARE
  pgcrypto_schema TEXT;
BEGIN
  -- pgcrypto may already live outside the schema selected by DATABASE_URL.
  -- Resolve it from PostgreSQL metadata instead of relying on search_path.
  SELECT namespace.nspname
    INTO pgcrypto_schema
  FROM pg_extension extension
  JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pgcrypto';

  IF pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: pgcrypto is unavailable';
  END IF;

  EXECUTE format($update$
    UPDATE "AffiliateCommission"
    SET "deduplicationKey" = CASE
      WHEN "sourceId" IS NULL THEN 'commission:v1|legacy:' || "id"
      ELSE 'commission:v1|sha256:' || encode(%I.digest(
        'commission:v1|beneficiary:' ||
          CASE WHEN "affiliateId" IS NULL THEN 'unassigned' ELSE 'affiliate:' || "affiliateId" END ||
          '|type:' || regexp_replace(lower(btrim("sourceType")), '\s+', '_', 'g') ||
          '|source:' || btrim("sourceId"),
        'sha256'), 'hex')
    END
  $update$, pgcrypto_schema);
END $migration$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AffiliateCommission"
    GROUP BY "vendorId", "deduplicationKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: canonical deduplication collision needs manual resolution';
  END IF;
END $$;


ALTER TABLE "AffiliateCommission" ALTER COLUMN "deduplicationKey" SET NOT NULL;
UPDATE "AffiliateCommission" SET "commissionBaseAmountCents" = "orderAmountCents";
UPDATE "LiveProduct" lp SET "vendorId" = l."vendorId" FROM "Live" l WHERE l.id=lp."liveId";
ALTER TABLE "LiveProduct" ALTER COLUMN "vendorId" SET NOT NULL;
UPDATE "CourseLesson" l SET "chapterTitle"=c.title, "productId"=c."defaultProductId", "position"=l."sortOrder" FROM "Course" c WHERE c.id=l."courseId" AND c."vendorId"=l."vendorId";
UPDATE "CourseLesson" l SET "videoUrl"=v."videoUrl", "durationSeconds"=v."durationSec" FROM "Video" v WHERE v.id=l."videoId" AND v."vendorId"=l."vendorId";
-- Match canonical cutover semantics; do not silently classify old merchandise.
UPDATE "Product" SET "fulfillmentTypeConfirmed"=false;
UPDATE "Product" p SET "commerceDomain"='course', "fulfillmentType"='course', "fulfillmentTypeConfirmed"=true WHERE EXISTS (SELECT 1 FROM "Course" c WHERE c."defaultProductId"=p.id AND c."vendorId"=p."vendorId");
ALTER TABLE "CourseLesson" ALTER COLUMN "chapterTitle" SET NOT NULL, ALTER COLUMN "productId" SET NOT NULL, ALTER COLUMN "position" SET NOT NULL, ALTER COLUMN "courseId" DROP NOT NULL;
CREATE TABLE "VideoArchiveState" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoArchiveState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveStudioDraft" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT,
    "payload" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedByMemberId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveStudioDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveViewerSession" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveViewerSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineOfficialAccount" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "messagingChannelIdEncrypted" TEXT NOT NULL,
    "messagingChannelSecretEncrypted" TEXT NOT NULL,
    "messagingAccessTokenEncrypted" TEXT NOT NULL,
    "loginChannelIdEncrypted" TEXT,
    "loginChannelSecretEncrypted" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineOfficialAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineRichMenu" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerRichMenuId" TEXT,
    "templateType" TEXT NOT NULL,
    "chatBarText" TEXT NOT NULL,
    "areas" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineRichMenu_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineUserIdentity" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "lineUserIdHash" TEXT NOT NULL,
    "lineUserIdEncrypted" TEXT NOT NULL,
    "displayNameEncrypted" TEXT,
    "pictureUrlEncrypted" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMaterializedAt" TIMESTAMP(3),
    "materializationCursor" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineUserIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineLoginState" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "codeVerifierEncrypted" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "redirectPath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineLoginState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineDelivery" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "lineOfficialAccountId" TEXT NOT NULL,
    "lineUserIdentityId" TEXT NOT NULL,
    "sourceTemplateId" TEXT,
    "trigger" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadEncrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "providerRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveChatMessage" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "formSubmissionId" TEXT,
    "roleId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'viewer',
    "status" TEXT NOT NULL DEFAULT 'visible',
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveQuestion" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "participantHash" TEXT NOT NULL,
    "displayName" TEXT,
    "body" TEXT NOT NULL,
    "status" "LiveQuestionStatus" NOT NULL DEFAULT 'pending',
    "spotlightedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveNotificationRule" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "messageTemplateId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveNotificationRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "sourceTemplateId" TEXT NOT NULL,
    "sourceLiveId" TEXT,
    "sourceFormSubmissionId" TEXT,
    "trigger" TEXT NOT NULL,
    "payloadEncryptedEnvelope" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "recipientMaskedEmail" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "manualRetryCount" INTEGER NOT NULL DEFAULT 0,
    "lastManualRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveReminderReconciliationJob" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "liveStatus" TEXT NOT NULL,
    "configDigest" TEXT NOT NULL,
    "templateId" TEXT,
    "templateRevision" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "reminderOffsetMinutes" INTEGER NOT NULL,
    "lifecycle" TEXT NOT NULL DEFAULT 'pending',
    "cursorCreatedAt" TIMESTAMP(3),
    "cursorId" TEXT,
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledCount" INTEGER NOT NULL DEFAULT 0,
    "supersededCount" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveReminderReconciliationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "recipientMaskedEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "suppressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveInteractionRun" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "winnerResponseId" TEXT,
    "createdByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveInteractionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveInteractionResponse" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "participantHash" TEXT NOT NULL,
    "formSubmissionId" TEXT,
    "eventType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "displayName" TEXT,
    "claimTokenHash" TEXT,
    "winnerClaimCodeEncryptedEnvelope" TEXT,
    "winnerClaimedAt" TIMESTAMP(3),
    "productId" TEXT,
    "discountAmountCents" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "usedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveInteractionResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralCode" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformReferralCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralClick" (
    "id" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "landingPath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformReferralClick_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralAttribution" (
    "id" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "clickId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "codeSnapshot" TEXT NOT NULL,
    "commissionRateBpsSnapshot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformReferralAttribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralCommission" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "codeSnapshot" TEXT NOT NULL,
    "commissionRateBpsSnapshot" INTEGER NOT NULL,
    "grossAmountCents" INTEGER NOT NULL,
    "commissionAmountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformReferralCommission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralCommissionLedgerEntry" (
    "id" TEXT NOT NULL,
    "platformReferralCommissionId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "providerName" TEXT NOT NULL,
    "eventIdentity" TEXT NOT NULL,
    "disputeCaseId" TEXT,
    "deduplicationKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformReferralCommissionLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralPayout" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "commissionAmountCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentAmountCents" INTEGER NOT NULL DEFAULT 0,
    "finalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payoutBatchId" TEXT,
    "outcomeReference" TEXT,
    "outcomeReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformReferralPayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralPayoutBatch" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "batchDate" TIMESTAMP(3) NOT NULL,
    "totalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "exportedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformReferralPayoutBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentMethodReference" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'VENDOR',
    "teamId" TEXT,
    "membershipId" TEXT,
    "providerName" TEXT NOT NULL,
    "providerCustomerRef" TEXT,
    "providerPaymentMethodRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethodReference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceOrder" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "checkoutIdempotencyKey" TEXT NOT NULL,
    "checkoutIdentityHash" TEXT NOT NULL,
    "automationCustomerKeyHash" TEXT,
    "primaryPaymentTransactionId" TEXT,
    "status" "CommerceOrderStatus" NOT NULL DEFAULT 'pending_payment',
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "subtotalAmountCents" INTEGER NOT NULL,
    "totalAmountCents" INTEGER NOT NULL,
    "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
    "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "buyerEncryptedEnvelope" TEXT NOT NULL,
    "buyerMaskedName" TEXT NOT NULL,
    "buyerMaskedEmail" TEXT NOT NULL,
    "buyerMaskedPhone" TEXT,
    "shippingEncryptedEnvelope" TEXT,
    "shippingMaskedSummary" TEXT,
    "invoiceType" TEXT,
    "invoiceBuyerDisplay" TEXT,
    "invoiceRequestEncryptedEnvelope" TEXT,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceOrderItem" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "lineIndex" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "productSlug" TEXT NOT NULL,
    "commerceDomain" TEXT NOT NULL,
    "fulfillmentType" "CommerceFulfillmentType" NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "nonSensitiveSnapshot" JSONB NOT NULL,
    "customCheckoutAnswersEncryptedEnvelope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceOrderEvent" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "sanitizedData" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceOrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceOrderRefund" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentTransactionId" TEXT,
    "refundRecordId" TEXT,
    "providerName" TEXT NOT NULL,
    "eventIdentity" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "cumulativeAmountCents" INTEGER NOT NULL,
    "status" "CommerceOrderRefundStatus" NOT NULL DEFAULT 'processed',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceOrderRefund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ElectronicInvoice" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "randomCode" TEXT,
    "invoiceType" TEXT NOT NULL,
    "buyerDisplay" TEXT NOT NULL,
    "requestEncryptedEnvelope" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "amountCents" INTEGER NOT NULL,
    "pretaxAmountCents" INTEGER NOT NULL,
    "taxAmountCents" INTEGER NOT NULL,
    "status" "ElectronicInvoiceStatus" NOT NULL DEFAULT 'queued',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectronicInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ElectronicInvoiceAllowance" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "electronicInvoiceId" TEXT NOT NULL,
    "commerceRefundId" TEXT NOT NULL,
    "allowanceNumber" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "pretaxAmountCents" INTEGER NOT NULL,
    "taxAmountCents" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectronicInvoiceAllowance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportCase" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "intakeKey" TEXT NOT NULL,
    "category" "SupportCaseCategory" NOT NULL,
    "priority" "SupportCasePriority" NOT NULL,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'open',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByMemberId" TEXT,
    "createdByBuyerGrantId" TEXT,
    "assignedMemberId" TEXT,
    "firstRespondedAt" TIMESTAMP(3),
    "responseDueAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportCaseEvent" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "supportCaseId" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "eventType" "SupportCaseEventType" NOT NULL,
    "audience" "SupportCaseEventAudience" NOT NULL DEFAULT 'internal',
    "actorMemberId" TEXT,
    "actorUserId" TEXT,
    "actorBuyerOrderId" TEXT,
    "actorBuyerGrantId" TEXT,
    "payloadEncryptedEnvelope" TEXT,
    "sanitizedData" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportCaseEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BuyerSupportOrderGrant" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cookieKey" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "rotationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerSupportOrderGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportRefundHandoff" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "supportCaseId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "requestedByMemberId" TEXT NOT NULL,
    "requestedAmountCents" INTEGER NOT NULL,
    "reasonEncryptedEnvelope" TEXT NOT NULL,
    "status" "SupportRefundHandoffStatus" NOT NULL DEFAULT 'requested',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "completedRefundId" TEXT,
    "reviewedByActorId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportRefundHandoff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportRefundHandoffRefund" (
    "vendorId" TEXT NOT NULL,
    "handoffId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "amountCentsSnapshot" INTEGER NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportRefundHandoffRefund_pkey" PRIMARY KEY ("vendorId","handoffId","refundId")
);

CREATE TABLE "VendorDeliveryUrlAllowlist" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "pathPrefix" TEXT NOT NULL DEFAULT '/',
    "allowQuery" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorDeliveryUrlAllowlist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductDeliveryConfig" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "allowlistId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "ProductDeliveryConfigStatus" NOT NULL DEFAULT 'draft',
    "fulfillmentType" "CommerceFulfillmentType" NOT NULL,
    "deliveryKind" "ProductDeliveryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "destinationEncryptedEnvelope" TEXT,
    "destinationMaskedSummary" TEXT,
    "instructionsEncryptedEnvelope" TEXT,
    "instructionsMaskedSummary" TEXT,
    "activatedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDeliveryConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceOrderItemDeliverySnapshot" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productDeliveryConfigId" TEXT,
    "productDeliveryConfigRevision" INTEGER,
    "fulfillmentType" "CommerceFulfillmentType" NOT NULL,
    "deliveryKind" "ProductDeliveryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "destinationEncryptedEnvelope" TEXT,
    "destinationMaskedSummary" TEXT,
    "instructionsEncryptedEnvelope" TEXT,
    "instructionsMaskedSummary" TEXT,
    "allowlistSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CommerceOrderItemDeliverySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShippingFulfillment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "ShippingFulfillmentStatus" NOT NULL DEFAULT 'pending',
    "carrierName" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "packingAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "refundReviewAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommerceEntitlement" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "CommerceEntitlementStatus" NOT NULL DEFAULT 'pending',
    "accessEncryptedEnvelope" TEXT,
    "accessMaskedSummary" TEXT,
    "grantedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceFulfillment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "ServiceFulfillmentStatus" NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "serviceEncryptedEnvelope" TEXT,
    "serviceMaskedSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionRuleSet" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CommissionRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxTotalRateBps" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRuleSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionRateTier" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "commissionRuleSetId" TEXT NOT NULL,
    "minMonthlySalesCents" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,

    CONSTRAINT "CommissionRateTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionQuantityTier" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "commissionRuleSetId" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "maxQuantity" INTEGER,
    "rateBps" INTEGER NOT NULL,

    CONSTRAINT "CommissionQuantityTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionUplineLevel" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "commissionRuleSetId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "bonusRateBps" INTEGER NOT NULL,

    CONSTRAINT "CommissionUplineLevel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionProductOverride" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "commissionRuleSetId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL,

    CONSTRAINT "CommissionProductOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateCommissionLedgerEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "affiliateCommissionId" TEXT NOT NULL,
    "entryType" "AffiliateCommissionLedgerEntryType" NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "eventIdentity" TEXT NOT NULL,
    "disputeCaseId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCommissionLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseCommissionAllocation" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "teamConversionAttributionId" TEXT,
    "recipientMembershipId" TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "grossAmountCents" INTEGER NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseCommissionAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseCommissionLedgerEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "courseCommissionAllocationId" TEXT NOT NULL,
    "entryType" "CourseCommissionLedgerEntryType" NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "eventIdentity" TEXT NOT NULL,
    "disputeCaseId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseCommissionLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoursePayout" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "recipientMembershipId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "commissionAmountCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentAmountCents" INTEGER NOT NULL DEFAULT 0,
    "finalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "grossSalesAmountCents" INTEGER,
    "netReferenceAmountCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "outcomeReference" TEXT,
    "outcomeReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoursePayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StreamUsageLedgerEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "viewerKeyHash" TEXT,
    "customerKeyHash" TEXT,
    "liveId" TEXT NOT NULL,
    "sourcePageId" TEXT,
    "teamId" TEXT,
    "templateVersionId" TEXT,
    "promoterMembershipId" TEXT,
    "contentOwnerMembershipId" TEXT,
    "eventId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "watchSeconds" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DIRECT_PLAYBACK',
    "policyVersion" INTEGER NOT NULL DEFAULT 2,
    "attributionMode" TEXT NOT NULL DEFAULT 'PROMOTER',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamUsageLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StreamUsageReconciliation" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "sourceReference" TEXT,
    "providerWatchMinutes" INTEGER NOT NULL,
    "providerStorageMinutes" INTEGER,
    "internalWatchSeconds" INTEGER NOT NULL,
    "internalWatchMinutes" INTEGER NOT NULL,
    "differenceMinutes" INTEGER NOT NULL,
    "status" "StreamUsageReconciliationStatus" NOT NULL,
    "evidenceKind" "StreamUsageReconciliationEvidenceKind" NOT NULL DEFAULT 'ADMIN_ATTESTED_DIGEST',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdByActorId" TEXT NOT NULL,
    "createdByActorLabel" TEXT NOT NULL,
    "resolution" "StreamUsageReconciliationResolution",
    "resolutionNote" TEXT,
    "resolvedByActorId" TEXT,
    "resolvedByActorLabel" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamUsageReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StreamOperationsAlert" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "StreamOperationsAlertType" NOT NULL,
    "status" "StreamOperationsAlertStatus" NOT NULL DEFAULT 'OPEN',
    "dedupKey" TEXT NOT NULL,
    "provider" TEXT,
    "monthKey" TEXT NOT NULL,
    "severity" "StreamOperationsAlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "reconciliationId" TEXT,
    "metadata" JSONB,
    "acknowledgedByActorId" TEXT,
    "acknowledgedByActorLabel" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedByActorId" TEXT,
    "resolvedByActorLabel" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamOperationsAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StreamUsageAllocationEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "recipientTeamId" TEXT,
    "recipientMembershipId" TEXT,
    "allocationBps" INTEGER NOT NULL,
    "allocatedWatchSeconds" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "attributionMode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamUsageAllocationEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerLiveShare" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "sourcePageId" TEXT NOT NULL,
    "promoterMembershipId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerLiveShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationExecutionLog" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectKeyHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "conditionMatched" BOOLEAN,
    "actionResults" JSONB,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationExecutionLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerTagAssignment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "sourceExecutionLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerTagAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationVoucherGrant" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "claimTokenHash" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "sourceExecutionLogId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "usedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationVoucherGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerCrmRecord" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "consultationStatus" "CustomerConsultationStatus" NOT NULL DEFAULT 'following_up',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCrmRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsultantNote" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerRecordId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultantNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentPortalAccessToken" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "purpose" "StudentPortalAccessTokenPurpose" NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentPortalAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseLessonProgress" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "watchedSeconds" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseLessonProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityPost" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityComment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityReaction" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityReaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsultationEvent" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Taipei',
    "weeklySchedule" JSONB NOT NULL,
    "intakeFormFields" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsultationBooking" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "ConsultationBookingStatus" NOT NULL DEFAULT 'scheduled',
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT NOT NULL,
    "customerKeyHash" TEXT,
    "clientPhone" TEXT NOT NULL,
    "answers" JSONB,
    "meetingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationBooking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VideoArchiveState_vendorId_previousStatus_idx" ON "VideoArchiveState"("vendorId", "previousStatus");

CREATE UNIQUE INDEX "VideoArchiveState_vendorId_videoId_key" ON "VideoArchiveState"("vendorId", "videoId");

CREATE UNIQUE INDEX "ImageAsset_objectKey_key" ON "ImageAsset"("objectKey");

CREATE INDEX "ImageAsset_vendorId_status_createdAt_idx" ON "ImageAsset"("vendorId", "status", "createdAt");

CREATE UNIQUE INDEX "ImageAsset_vendorId_id_key" ON "ImageAsset"("vendorId", "id");

CREATE INDEX "LiveStudioDraft_vendorId_consumedAt_expiresAt_updatedAt_idx" ON "LiveStudioDraft"("vendorId", "consumedAt", "expiresAt", "updatedAt");

CREATE UNIQUE INDEX "LiveStudioDraft_vendorId_id_key" ON "LiveStudioDraft"("vendorId", "id");

CREATE UNIQUE INDEX "LiveStudioDraft_vendorId_liveId_key" ON "LiveStudioDraft"("vendorId", "liveId");

CREATE UNIQUE INDEX "LiveViewerSession_tokenHash_key" ON "LiveViewerSession"("tokenHash");

CREATE INDEX "LiveViewerSession_vendorId_liveId_expiresAt_idx" ON "LiveViewerSession"("vendorId", "liveId", "expiresAt");

CREATE INDEX "LiveViewerSession_liveId_expiresAt_idx" ON "LiveViewerSession"("liveId", "expiresAt");

CREATE UNIQUE INDEX "LineOfficialAccount_vendorId_key" ON "LineOfficialAccount"("vendorId");

CREATE INDEX "LineOfficialAccount_status_updatedAt_idx" ON "LineOfficialAccount"("status", "updatedAt");

CREATE UNIQUE INDEX "LineOfficialAccount_vendorId_id_key" ON "LineOfficialAccount"("vendorId", "id");

CREATE INDEX "LineRichMenu_vendorId_status_updatedAt_idx" ON "LineRichMenu"("vendorId", "status", "updatedAt");

CREATE INDEX "LineRichMenu_vendorId_isDefault_idx" ON "LineRichMenu"("vendorId", "isDefault");

CREATE UNIQUE INDEX "LineRichMenu_vendorId_id_key" ON "LineRichMenu"("vendorId", "id");

CREATE INDEX "LineUserIdentity_vendorId_subjectType_revokedAt_idx" ON "LineUserIdentity"("vendorId", "subjectType", "revokedAt");

CREATE INDEX "LineUserIdentity_revokedAt_lastMaterializedAt_idx" ON "LineUserIdentity"("revokedAt", "lastMaterializedAt");

CREATE UNIQUE INDEX "LineUserIdentity_vendorId_subjectType_subjectId_key" ON "LineUserIdentity"("vendorId", "subjectType", "subjectId");

CREATE UNIQUE INDEX "LineUserIdentity_vendorId_lineUserIdHash_key" ON "LineUserIdentity"("vendorId", "lineUserIdHash");

CREATE UNIQUE INDEX "LineUserIdentity_vendorId_id_key" ON "LineUserIdentity"("vendorId", "id");

CREATE UNIQUE INDEX "LineLoginState_stateHash_key" ON "LineLoginState"("stateHash");

CREATE INDEX "LineLoginState_vendorId_expiresAt_consumedAt_idx" ON "LineLoginState"("vendorId", "expiresAt", "consumedAt");

CREATE INDEX "LineDelivery_status_nextAttemptAt_claimedAt_idx" ON "LineDelivery"("status", "nextAttemptAt", "claimedAt");

CREATE INDEX "LineDelivery_vendorId_trigger_createdAt_idx" ON "LineDelivery"("vendorId", "trigger", "createdAt");

CREATE INDEX "LineDelivery_lineUserIdentityId_createdAt_idx" ON "LineDelivery"("lineUserIdentityId", "createdAt");

CREATE UNIQUE INDEX "LineDelivery_vendorId_idempotencyKey_key" ON "LineDelivery"("vendorId", "idempotencyKey");

CREATE INDEX "LiveChatMessage_vendorId_liveId_createdAt_idx" ON "LiveChatMessage"("vendorId", "liveId", "createdAt");

CREATE INDEX "LiveChatMessage_liveId_createdAt_idx" ON "LiveChatMessage"("liveId", "createdAt");

CREATE INDEX "LiveChatMessage_vendorId_formSubmissionId_createdAt_idx" ON "LiveChatMessage"("vendorId", "formSubmissionId", "createdAt");

CREATE INDEX "LiveQuestion_vendorId_liveId_status_createdAt_idx" ON "LiveQuestion"("vendorId", "liveId", "status", "createdAt");

CREATE INDEX "LiveQuestion_liveId_participantHash_createdAt_idx" ON "LiveQuestion"("liveId", "participantHash", "createdAt");

CREATE INDEX "LiveNotificationRule_vendorId_liveId_trigger_isActive_idx" ON "LiveNotificationRule"("vendorId", "liveId", "trigger", "isActive");

CREATE UNIQUE INDEX "LiveNotificationRule_vendorId_liveId_trigger_offsetMinutes__key" ON "LiveNotificationRule"("vendorId", "liveId", "trigger", "offsetMinutes", "sortOrder");

CREATE INDEX "EmailDelivery_status_nextAttemptAt_idx" ON "EmailDelivery"("status", "nextAttemptAt");

CREATE INDEX "EmailDelivery_vendorId_createdAt_idx" ON "EmailDelivery"("vendorId", "createdAt");

CREATE INDEX "EmailDelivery_vendorId_status_createdAt_idx" ON "EmailDelivery"("vendorId", "status", "createdAt");

CREATE INDEX "EmailDelivery_vendorId_trigger_createdAt_idx" ON "EmailDelivery"("vendorId", "trigger", "createdAt");

CREATE INDEX "EmailDelivery_vendorId_recipientHash_idx" ON "EmailDelivery"("vendorId", "recipientHash");

CREATE UNIQUE INDEX "EmailDelivery_vendorId_idempotencyKey_key" ON "EmailDelivery"("vendorId", "idempotencyKey");

CREATE INDEX "LiveReminderReconciliationJob_lifecycle_nextAttemptAt_idx" ON "LiveReminderReconciliationJob"("lifecycle", "nextAttemptAt");

CREATE INDEX "LiveReminderReconciliationJob_vendorId_liveId_lifecycle_cre_idx" ON "LiveReminderReconciliationJob"("vendorId", "liveId", "lifecycle", "createdAt");

CREATE UNIQUE INDEX "LiveReminderReconciliationJob_vendorId_liveId_configDigest_key" ON "LiveReminderReconciliationJob"("vendorId", "liveId", "configDigest");

CREATE INDEX "EmailSuppression_vendorId_suppressedAt_idx" ON "EmailSuppression"("vendorId", "suppressedAt");

CREATE UNIQUE INDEX "EmailSuppression_vendorId_recipientHash_key" ON "EmailSuppression"("vendorId", "recipientHash");

CREATE INDEX "LiveInteractionRun_vendorId_liveId_status_endsAt_idx" ON "LiveInteractionRun"("vendorId", "liveId", "status", "endsAt");

CREATE UNIQUE INDEX "LiveInteractionRun_liveId_sourceEventId_key" ON "LiveInteractionRun"("liveId", "sourceEventId");

CREATE UNIQUE INDEX "LiveInteractionRun_vendorId_id_key" ON "LiveInteractionRun"("vendorId", "id");

CREATE UNIQUE INDEX "LiveInteractionResponse_claimTokenHash_key" ON "LiveInteractionResponse"("claimTokenHash");

CREATE INDEX "LiveInteractionResponse_vendorId_liveId_eventType_createdAt_idx" ON "LiveInteractionResponse"("vendorId", "liveId", "eventType", "createdAt");

CREATE INDEX "LiveInteractionResponse_vendorId_liveId_formSubmissionId_idx" ON "LiveInteractionResponse"("vendorId", "liveId", "formSubmissionId");

CREATE INDEX "LiveInteractionResponse_usedOrderId_idx" ON "LiveInteractionResponse"("usedOrderId");

CREATE UNIQUE INDEX "LiveInteractionResponse_runId_participantHash_key" ON "LiveInteractionResponse"("runId", "participantHash");

CREATE UNIQUE INDEX "PlatformReferralCode_code_key" ON "PlatformReferralCode"("code");

CREATE INDEX "PlatformReferralCode_ownerUserId_isActive_idx" ON "PlatformReferralCode"("ownerUserId", "isActive");

CREATE UNIQUE INDEX "PlatformReferralCode_ownerUserId_id_key" ON "PlatformReferralCode"("ownerUserId", "id");

CREATE INDEX "PlatformReferralClick_visitorId_createdAt_idx" ON "PlatformReferralClick"("visitorId", "createdAt");

CREATE INDEX "PlatformReferralClick_referralCodeId_expiresAt_idx" ON "PlatformReferralClick"("referralCodeId", "expiresAt");

CREATE UNIQUE INDEX "PlatformReferralClick_referralCodeId_id_key" ON "PlatformReferralClick"("referralCodeId", "id");

CREATE UNIQUE INDEX "PlatformReferralAttribution_subscriptionId_key" ON "PlatformReferralAttribution"("subscriptionId");

CREATE INDEX "PlatformReferralAttribution_ownerUserId_createdAt_idx" ON "PlatformReferralAttribution"("ownerUserId", "createdAt");

CREATE INDEX "PlatformReferralAttribution_referralCodeId_createdAt_idx" ON "PlatformReferralAttribution"("referralCodeId", "createdAt");

CREATE UNIQUE INDEX "PlatformReferralAttribution_referralCodeId_clickId_key" ON "PlatformReferralAttribution"("referralCodeId", "clickId");

CREATE UNIQUE INDEX "PlatformReferralCommission_paymentTransactionId_key" ON "PlatformReferralCommission"("paymentTransactionId");

CREATE INDEX "PlatformReferralCommission_ownerUserId_monthKey_idx" ON "PlatformReferralCommission"("ownerUserId", "monthKey");

CREATE INDEX "PlatformReferralCommission_vendorId_monthKey_idx" ON "PlatformReferralCommission"("vendorId", "monthKey");

CREATE UNIQUE INDEX "PlatformReferralCommission_vendorId_id_key" ON "PlatformReferralCommission"("vendorId", "id");

CREATE UNIQUE INDEX "PlatformReferralCommission_vendorId_paymentTransactionId_key" ON "PlatformReferralCommission"("vendorId", "paymentTransactionId");

CREATE UNIQUE INDEX "PlatformReferralCommission_subscriptionId_key" ON "PlatformReferralCommission"("subscriptionId");

CREATE INDEX "prc_ledger_comm_dispute_idx" ON "PlatformReferralCommissionLedgerEntry"("platformReferralCommissionId", "disputeCaseId");

CREATE INDEX "prc_ledger_comm_created_idx" ON "PlatformReferralCommissionLedgerEntry"("platformReferralCommissionId", "createdAt");

CREATE UNIQUE INDEX "PlatformReferralCommissionLedgerEntry_platformReferralCommi_key" ON "PlatformReferralCommissionLedgerEntry"("platformReferralCommissionId", "deduplicationKey");

CREATE INDEX "PlatformReferralPayout_ownerUserId_monthKey_status_idx" ON "PlatformReferralPayout"("ownerUserId", "monthKey", "status");

CREATE INDEX "PlatformReferralPayout_payoutBatchId_status_idx" ON "PlatformReferralPayout"("payoutBatchId", "status");

CREATE UNIQUE INDEX "PlatformReferralPayout_ownerUserId_monthKey_key" ON "PlatformReferralPayout"("ownerUserId", "monthKey");

CREATE UNIQUE INDEX "PlatformReferralPayoutBatch_batchNumber_key" ON "PlatformReferralPayoutBatch"("batchNumber");

CREATE INDEX "PlatformReferralPayoutBatch_monthKey_status_idx" ON "PlatformReferralPayoutBatch"("monthKey", "status");

CREATE INDEX "PaymentMethodReference_vendorId_scopeType_status_idx" ON "PaymentMethodReference"("vendorId", "scopeType", "status");

CREATE INDEX "PaymentMethodReference_vendorId_membershipId_status_idx" ON "PaymentMethodReference"("vendorId", "membershipId", "status");

CREATE UNIQUE INDEX "PaymentMethodReference_vendorId_providerName_providerPaymen_key" ON "PaymentMethodReference"("vendorId", "providerName", "providerPaymentMethodRef");

CREATE UNIQUE INDEX "PaymentMethodReference_vendorId_id_key" ON "PaymentMethodReference"("vendorId", "id");

CREATE INDEX "CommerceOrder_vendorId_status_createdAt_idx" ON "CommerceOrder"("vendorId", "status", "createdAt");

CREATE INDEX "CommerceOrder_vendorId_automationCustomerKeyHash_status_idx" ON "CommerceOrder"("vendorId", "automationCustomerKeyHash", "status");

CREATE INDEX "CommerceOrder_vendorId_paidAt_idx" ON "CommerceOrder"("vendorId", "paidAt");

CREATE UNIQUE INDEX "CommerceOrder_vendorId_id_key" ON "CommerceOrder"("vendorId", "id");

CREATE UNIQUE INDEX "CommerceOrder_vendorId_orderNumber_key" ON "CommerceOrder"("vendorId", "orderNumber");

CREATE UNIQUE INDEX "CommerceOrder_vendorId_checkoutIdempotencyKey_key" ON "CommerceOrder"("vendorId", "checkoutIdempotencyKey");

CREATE UNIQUE INDEX "CommerceOrder_vendorId_primaryPaymentTransactionId_key" ON "CommerceOrder"("vendorId", "primaryPaymentTransactionId");

CREATE INDEX "CommerceOrderItem_vendorId_productId_idx" ON "CommerceOrderItem"("vendorId", "productId");

CREATE INDEX "CommerceOrderItem_vendorId_fulfillmentType_idx" ON "CommerceOrderItem"("vendorId", "fulfillmentType");

CREATE UNIQUE INDEX "CommerceOrderItem_vendorId_id_key" ON "CommerceOrderItem"("vendorId", "id");

CREATE UNIQUE INDEX "CommerceOrderItem_vendorId_orderId_id_key" ON "CommerceOrderItem"("vendorId", "orderId", "id");

CREATE UNIQUE INDEX "CommerceOrderItem_vendorId_orderId_lineIndex_key" ON "CommerceOrderItem"("vendorId", "orderId", "lineIndex");

CREATE INDEX "CommerceOrderEvent_vendorId_orderId_occurredAt_idx" ON "CommerceOrderEvent"("vendorId", "orderId", "occurredAt");

CREATE INDEX "CommerceOrderEvent_vendorId_eventType_occurredAt_idx" ON "CommerceOrderEvent"("vendorId", "eventType", "occurredAt");

CREATE UNIQUE INDEX "CommerceOrderEvent_vendorId_id_key" ON "CommerceOrderEvent"("vendorId", "id");

CREATE UNIQUE INDEX "CommerceOrderEvent_vendorId_orderId_dedupKey_key" ON "CommerceOrderEvent"("vendorId", "orderId", "dedupKey");

CREATE INDEX "CommerceOrderRefund_vendorId_orderId_occurredAt_idx" ON "CommerceOrderRefund"("vendorId", "orderId", "occurredAt");

CREATE INDEX "CommerceOrderRefund_vendorId_paymentTransactionId_idx" ON "CommerceOrderRefund"("vendorId", "paymentTransactionId");

CREATE UNIQUE INDEX "CommerceOrderRefund_vendorId_id_key" ON "CommerceOrderRefund"("vendorId", "id");

CREATE UNIQUE INDEX "CommerceOrderRefund_vendorId_orderId_id_key" ON "CommerceOrderRefund"("vendorId", "orderId", "id");

CREATE UNIQUE INDEX "CommerceOrderRefund_vendorId_providerName_eventIdentity_key" ON "CommerceOrderRefund"("vendorId", "providerName", "eventIdentity");

CREATE UNIQUE INDEX "CommerceOrderRefund_vendorId_refundRecordId_key" ON "CommerceOrderRefund"("vendorId", "refundRecordId");

CREATE UNIQUE INDEX "ElectronicInvoice_invoiceNumber_key" ON "ElectronicInvoice"("invoiceNumber");

CREATE INDEX "ElectronicInvoice_vendorId_status_nextAttemptAt_processingS_idx" ON "ElectronicInvoice"("vendorId", "status", "nextAttemptAt", "processingStartedAt");

CREATE INDEX "ElectronicInvoice_vendorId_issuedAt_idx" ON "ElectronicInvoice"("vendorId", "issuedAt");

CREATE UNIQUE INDEX "ElectronicInvoice_vendorId_id_key" ON "ElectronicInvoice"("vendorId", "id");

CREATE UNIQUE INDEX "ElectronicInvoice_vendorId_orderId_key" ON "ElectronicInvoice"("vendorId", "orderId");

CREATE INDEX "ElectronicInvoiceAllowance_vendorId_electronicInvoiceId_iss_idx" ON "ElectronicInvoiceAllowance"("vendorId", "electronicInvoiceId", "issuedAt");

CREATE UNIQUE INDEX "ElectronicInvoiceAllowance_vendorId_id_key" ON "ElectronicInvoiceAllowance"("vendorId", "id");

CREATE UNIQUE INDEX "ElectronicInvoiceAllowance_vendorId_commerceRefundId_key" ON "ElectronicInvoiceAllowance"("vendorId", "commerceRefundId");

CREATE UNIQUE INDEX "ElectronicInvoiceAllowance_vendorId_allowanceNumber_key" ON "ElectronicInvoiceAllowance"("vendorId", "allowanceNumber");

CREATE INDEX "SupportCase_vendorId_status_priority_updatedAt_idx" ON "SupportCase"("vendorId", "status", "priority", "updatedAt");

CREATE INDEX "SupportCase_vendorId_assignedMemberId_status_idx" ON "SupportCase"("vendorId", "assignedMemberId", "status");

CREATE INDEX "SupportCase_vendorId_orderId_createdAt_idx" ON "SupportCase"("vendorId", "orderId", "createdAt");

CREATE INDEX "SupportCase_createdByBuyerGrantId_createdAt_idx" ON "SupportCase"("createdByBuyerGrantId", "createdAt");

CREATE UNIQUE INDEX "SupportCase_vendorId_id_key" ON "SupportCase"("vendorId", "id");

CREATE UNIQUE INDEX "SupportCase_vendorId_id_orderId_key" ON "SupportCase"("vendorId", "id", "orderId");

CREATE UNIQUE INDEX "SupportCase_vendorId_caseNumber_key" ON "SupportCase"("vendorId", "caseNumber");

CREATE UNIQUE INDEX "SupportCase_vendorId_intakeKey_key" ON "SupportCase"("vendorId", "intakeKey");

CREATE INDEX "SupportCaseEvent_vendorId_supportCaseId_occurredAt_idx" ON "SupportCaseEvent"("vendorId", "supportCaseId", "occurredAt");

CREATE INDEX "SupportCaseEvent_vendorId_eventType_occurredAt_idx" ON "SupportCaseEvent"("vendorId", "eventType", "occurredAt");

CREATE INDEX "SupportCaseEvent_actorBuyerGrantId_occurredAt_idx" ON "SupportCaseEvent"("actorBuyerGrantId", "occurredAt");

CREATE UNIQUE INDEX "SupportCaseEvent_vendorId_id_key" ON "SupportCaseEvent"("vendorId", "id");

CREATE UNIQUE INDEX "SupportCaseEvent_vendorId_supportCaseId_dedupKey_key" ON "SupportCaseEvent"("vendorId", "supportCaseId", "dedupKey");

CREATE UNIQUE INDEX "BuyerSupportOrderGrant_cookieKey_key" ON "BuyerSupportOrderGrant"("cookieKey");

CREATE UNIQUE INDEX "BuyerSupportOrderGrant_tokenHash_key" ON "BuyerSupportOrderGrant"("tokenHash");

CREATE INDEX "BuyerSupportOrderGrant_vendorId_orderId_idx" ON "BuyerSupportOrderGrant"("vendorId", "orderId");

CREATE INDEX "BuyerSupportOrderGrant_expiresAt_revokedAt_idx" ON "BuyerSupportOrderGrant"("expiresAt", "revokedAt");

CREATE UNIQUE INDEX "BuyerSupportOrderGrant_vendorId_orderId_key" ON "BuyerSupportOrderGrant"("vendorId", "orderId");

CREATE UNIQUE INDEX "BuyerSupportOrderGrant_vendorId_id_key" ON "BuyerSupportOrderGrant"("vendorId", "id");

CREATE UNIQUE INDEX "BuyerSupportOrderGrant_vendorId_orderId_id_key" ON "BuyerSupportOrderGrant"("vendorId", "orderId", "id");

CREATE INDEX "SupportRefundHandoff_status_createdAt_idx" ON "SupportRefundHandoff"("status", "createdAt");

CREATE INDEX "SupportRefundHandoff_vendorId_orderId_status_idx" ON "SupportRefundHandoff"("vendorId", "orderId", "status");

CREATE INDEX "SupportRefundHandoff_vendorId_paymentTransactionId_idx" ON "SupportRefundHandoff"("vendorId", "paymentTransactionId");

CREATE UNIQUE INDEX "SupportRefundHandoff_vendorId_id_key" ON "SupportRefundHandoff"("vendorId", "id");

CREATE UNIQUE INDEX "SupportRefundHandoff_vendorId_supportCaseId_key" ON "SupportRefundHandoff"("vendorId", "supportCaseId");

CREATE UNIQUE INDEX "SupportRefundHandoff_vendorId_completedRefundId_key" ON "SupportRefundHandoff"("vendorId", "completedRefundId");

CREATE UNIQUE INDEX "SupportRefundHandoff_vendorId_orderId_completedRefundId_key" ON "SupportRefundHandoff"("vendorId", "orderId", "completedRefundId");

CREATE INDEX "SupportRefundHandoffRefund_vendorId_handoffId_linkedAt_idx" ON "SupportRefundHandoffRefund"("vendorId", "handoffId", "linkedAt");

CREATE UNIQUE INDEX "SupportRefundHandoffRefund_vendorId_refundId_key" ON "SupportRefundHandoffRefund"("vendorId", "refundId");

CREATE INDEX "VendorDeliveryUrlAllowlist_vendorId_status_updatedAt_idx" ON "VendorDeliveryUrlAllowlist"("vendorId", "status", "updatedAt");

CREATE UNIQUE INDEX "VendorDeliveryUrlAllowlist_vendorId_id_key" ON "VendorDeliveryUrlAllowlist"("vendorId", "id");

CREATE UNIQUE INDEX "VendorDeliveryUrlAllowlist_vendorId_hostname_pathPrefix_key" ON "VendorDeliveryUrlAllowlist"("vendorId", "hostname", "pathPrefix");

CREATE INDEX "ProductDeliveryConfig_vendorId_status_updatedAt_idx" ON "ProductDeliveryConfig"("vendorId", "status", "updatedAt");

CREATE INDEX "ProductDeliveryConfig_vendorId_allowlistId_idx" ON "ProductDeliveryConfig"("vendorId", "allowlistId");

CREATE UNIQUE INDEX "ProductDeliveryConfig_vendorId_id_key" ON "ProductDeliveryConfig"("vendorId", "id");

CREATE UNIQUE INDEX "ProductDeliveryConfig_vendorId_productId_key" ON "ProductDeliveryConfig"("vendorId", "productId");

CREATE INDEX "CommerceOrderItemDeliverySnapshot_vendorId_orderId_createdA_idx" ON "CommerceOrderItemDeliverySnapshot"("vendorId", "orderId", "createdAt");

CREATE UNIQUE INDEX "CommerceOrderItemDeliverySnapshot_vendorId_id_key" ON "CommerceOrderItemDeliverySnapshot"("vendorId", "id");

CREATE UNIQUE INDEX "CommerceOrderItemDeliverySnapshot_vendorId_orderId_orderIte_key" ON "CommerceOrderItemDeliverySnapshot"("vendorId", "orderId", "orderItemId");

CREATE INDEX "ShippingFulfillment_vendorId_status_updatedAt_idx" ON "ShippingFulfillment"("vendorId", "status", "updatedAt");

CREATE INDEX "ShippingFulfillment_trackingNumber_idx" ON "ShippingFulfillment"("trackingNumber");

CREATE UNIQUE INDEX "ShippingFulfillment_vendorId_id_key" ON "ShippingFulfillment"("vendorId", "id");

CREATE UNIQUE INDEX "ShippingFulfillment_vendorId_orderItemId_key" ON "ShippingFulfillment"("vendorId", "orderItemId");

CREATE INDEX "CommerceEntitlement_vendorId_status_expiresAt_idx" ON "CommerceEntitlement"("vendorId", "status", "expiresAt");

CREATE UNIQUE INDEX "CommerceEntitlement_vendorId_id_key" ON "CommerceEntitlement"("vendorId", "id");

CREATE UNIQUE INDEX "CommerceEntitlement_vendorId_orderItemId_key" ON "CommerceEntitlement"("vendorId", "orderItemId");

CREATE INDEX "ServiceFulfillment_vendorId_status_scheduledAt_idx" ON "ServiceFulfillment"("vendorId", "status", "scheduledAt");

CREATE UNIQUE INDEX "ServiceFulfillment_vendorId_id_key" ON "ServiceFulfillment"("vendorId", "id");

CREATE UNIQUE INDEX "ServiceFulfillment_vendorId_orderItemId_key" ON "ServiceFulfillment"("vendorId", "orderItemId");

CREATE INDEX "CommissionRuleSet_vendorId_status_activatedAt_idx" ON "CommissionRuleSet"("vendorId", "status", "activatedAt");

CREATE UNIQUE INDEX "CommissionRuleSet_vendorId_id_key" ON "CommissionRuleSet"("vendorId", "id");

CREATE UNIQUE INDEX "CommissionRuleSet_vendorId_version_key" ON "CommissionRuleSet"("vendorId", "version");

CREATE INDEX "CommissionRateTier_vendorId_commissionRuleSetId_minMonthlyS_idx" ON "CommissionRateTier"("vendorId", "commissionRuleSetId", "minMonthlySalesCents");

CREATE UNIQUE INDEX "CommissionRateTier_commissionRuleSetId_minMonthlySalesCents_key" ON "CommissionRateTier"("commissionRuleSetId", "minMonthlySalesCents");

CREATE INDEX "CommissionQuantityTier_vendorId_commissionRuleSetId_minQuan_idx" ON "CommissionQuantityTier"("vendorId", "commissionRuleSetId", "minQuantity");

CREATE UNIQUE INDEX "CommissionQuantityTier_commissionRuleSetId_minQuantity_key" ON "CommissionQuantityTier"("commissionRuleSetId", "minQuantity");

CREATE INDEX "CommissionUplineLevel_vendorId_commissionRuleSetId_level_idx" ON "CommissionUplineLevel"("vendorId", "commissionRuleSetId", "level");

CREATE UNIQUE INDEX "CommissionUplineLevel_commissionRuleSetId_level_key" ON "CommissionUplineLevel"("commissionRuleSetId", "level");

CREATE INDEX "CommissionProductOverride_vendorId_commissionRuleSetId_prod_idx" ON "CommissionProductOverride"("vendorId", "commissionRuleSetId", "productId");

CREATE UNIQUE INDEX "CommissionProductOverride_commissionRuleSetId_productId_key" ON "CommissionProductOverride"("commissionRuleSetId", "productId");

CREATE INDEX "AffiliateCommissionLedger_v_c_created_idx" ON "AffiliateCommissionLedgerEntry"("vendorId", "affiliateCommissionId", "createdAt");

CREATE INDEX "AffiliateCommissionLedger_v_c_case_idx" ON "AffiliateCommissionLedgerEntry"("vendorId", "affiliateCommissionId", "disputeCaseId");

CREATE UNIQUE INDEX "AffiliateCommissionLedgerEntry_vendorId_deduplicationKey_key" ON "AffiliateCommissionLedgerEntry"("vendorId", "deduplicationKey");

CREATE INDEX "CourseCommissionAllocation_vendorId_recipientMembershipId_c_idx" ON "CourseCommissionAllocation"("vendorId", "recipientMembershipId", "createdAt");

CREATE INDEX "CourseCommissionAllocation_vendorId_paymentTransactionId_idx" ON "CourseCommissionAllocation"("vendorId", "paymentTransactionId");

CREATE UNIQUE INDEX "CourseCommissionAllocation_vendorId_id_key" ON "CourseCommissionAllocation"("vendorId", "id");

CREATE UNIQUE INDEX "CourseCommissionAllocation_vendorId_paymentTransactionId_re_key" ON "CourseCommissionAllocation"("vendorId", "paymentTransactionId", "recipientRole");

CREATE UNIQUE INDEX "CourseCommissionAllocation_vendorId_deduplicationKey_key" ON "CourseCommissionAllocation"("vendorId", "deduplicationKey");

CREATE INDEX "CourseCommissionLedger_v_c_a_created_idx" ON "CourseCommissionLedgerEntry"("vendorId", "courseCommissionAllocationId", "createdAt");

CREATE INDEX "CourseCommissionLedger_v_c_a_case_idx" ON "CourseCommissionLedgerEntry"("vendorId", "courseCommissionAllocationId", "disputeCaseId");

CREATE UNIQUE INDEX "CourseCommissionLedgerEntry_vendorId_deduplicationKey_key" ON "CourseCommissionLedgerEntry"("vendorId", "deduplicationKey");

CREATE INDEX "CoursePayout_vendorId_monthKey_status_idx" ON "CoursePayout"("vendorId", "monthKey", "status");

CREATE INDEX "CoursePayout_vendorId_recipientMembershipId_createdAt_idx" ON "CoursePayout"("vendorId", "recipientMembershipId", "createdAt");

CREATE UNIQUE INDEX "CoursePayout_vendorId_id_key" ON "CoursePayout"("vendorId", "id");

CREATE UNIQUE INDEX "CoursePayout_vendorId_recipientMembershipId_monthKey_key" ON "CoursePayout"("vendorId", "recipientMembershipId", "monthKey");

CREATE UNIQUE INDEX "StreamUsageLedgerEntry_eventId_key" ON "StreamUsageLedgerEntry"("eventId");

CREATE INDEX "StreamUsageLedgerEntry_vendorId_monthKey_idx" ON "StreamUsageLedgerEntry"("vendorId", "monthKey");

CREATE INDEX "StreamUsageLedgerEntry_sourcePageId_monthKey_idx" ON "StreamUsageLedgerEntry"("sourcePageId", "monthKey");

CREATE INDEX "StreamUsageLedgerEntry_promoterMembershipId_monthKey_idx" ON "StreamUsageLedgerEntry"("promoterMembershipId", "monthKey");

CREATE INDEX "StreamUsageLedgerEntry_liveId_capturedAt_idx" ON "StreamUsageLedgerEntry"("liveId", "capturedAt");

CREATE INDEX "StreamUsageLedgerEntry_liveId_viewerKeyHash_capturedAt_idx" ON "StreamUsageLedgerEntry"("liveId", "viewerKeyHash", "capturedAt");

CREATE INDEX "StreamUsageLedgerEntry_vendorId_customerKeyHash_capturedAt_idx" ON "StreamUsageLedgerEntry"("vendorId", "customerKeyHash", "capturedAt");

CREATE UNIQUE INDEX "StreamUsageLedgerEntry_vendorId_id_key" ON "StreamUsageLedgerEntry"("vendorId", "id");

CREATE INDEX "StreamUsageReconciliation_vendorId_monthKey_status_idx" ON "StreamUsageReconciliation"("vendorId", "monthKey", "status");

CREATE INDEX "StreamUsageReconciliation_vendorId_provider_monthKey_idx" ON "StreamUsageReconciliation"("vendorId", "provider", "monthKey");

CREATE UNIQUE INDEX "StreamUsageReconciliation_provider_sourceDigest_key" ON "StreamUsageReconciliation"("provider", "sourceDigest");

CREATE UNIQUE INDEX "StreamUsageReconciliation_vendorId_id_key" ON "StreamUsageReconciliation"("vendorId", "id");

CREATE UNIQUE INDEX "StreamOperationsAlert_dedupKey_key" ON "StreamOperationsAlert"("dedupKey");

CREATE INDEX "StreamOperationsAlert_vendorId_monthKey_status_idx" ON "StreamOperationsAlert"("vendorId", "monthKey", "status");

CREATE INDEX "StreamOperationsAlert_vendorId_provider_type_status_idx" ON "StreamOperationsAlert"("vendorId", "provider", "type", "status");

CREATE INDEX "StreamOperationsAlert_reconciliationId_idx" ON "StreamOperationsAlert"("reconciliationId");

CREATE INDEX "StreamUsageAllocationEntry_vendorId_monthKey_recipientKey_idx" ON "StreamUsageAllocationEntry"("vendorId", "monthKey", "recipientKey");

CREATE INDEX "StreamUsageAllocationEntry_recipientMembershipId_monthKey_idx" ON "StreamUsageAllocationEntry"("recipientMembershipId", "monthKey");

CREATE UNIQUE INDEX "StreamUsageAllocationEntry_vendorId_ledgerEntryId_recipient_key" ON "StreamUsageAllocationEntry"("vendorId", "ledgerEntryId", "recipientKey");

CREATE UNIQUE INDEX "PartnerLiveShare_tokenHash_key" ON "PartnerLiveShare"("tokenHash");

CREATE INDEX "PartnerLiveShare_vendorId_teamId_liveId_isEnabled_expiresAt_idx" ON "PartnerLiveShare"("vendorId", "teamId", "liveId", "isEnabled", "expiresAt");

CREATE UNIQUE INDEX "PartnerLiveShare_vendorId_liveId_promoterMembershipId_key" ON "PartnerLiveShare"("vendorId", "liveId", "promoterMembershipId");

CREATE INDEX "AutomationRule_vendorId_trigger_isActive_idx" ON "AutomationRule"("vendorId", "trigger", "isActive");

CREATE UNIQUE INDEX "AutomationRule_vendorId_id_key" ON "AutomationRule"("vendorId", "id");

CREATE INDEX "AutomationExecutionLog_vendorId_ruleId_createdAt_idx" ON "AutomationExecutionLog"("vendorId", "ruleId", "createdAt");

CREATE INDEX "AutomationExecutionLog_vendorId_eventId_idx" ON "AutomationExecutionLog"("vendorId", "eventId");

CREATE INDEX "AutomationExecutionLog_vendorId_status_startedAt_idx" ON "AutomationExecutionLog"("vendorId", "status", "startedAt");

CREATE UNIQUE INDEX "AutomationExecutionLog_vendorId_id_key" ON "AutomationExecutionLog"("vendorId", "id");

CREATE UNIQUE INDEX "AutomationExecutionLog_vendorId_idempotencyKey_key" ON "AutomationExecutionLog"("vendorId", "idempotencyKey");

CREATE INDEX "CustomerTagAssignment_vendorId_customerKeyHash_idx" ON "CustomerTagAssignment"("vendorId", "customerKeyHash");

CREATE INDEX "CustomerTagAssignment_vendorId_tag_createdAt_idx" ON "CustomerTagAssignment"("vendorId", "tag", "createdAt");

CREATE UNIQUE INDEX "CustomerTagAssignment_vendorId_id_key" ON "CustomerTagAssignment"("vendorId", "id");

CREATE UNIQUE INDEX "CustomerTagAssignment_vendorId_customerKeyHash_tag_key" ON "CustomerTagAssignment"("vendorId", "customerKeyHash", "tag");

CREATE UNIQUE INDEX "AutomationVoucherGrant_claimTokenHash_key" ON "AutomationVoucherGrant"("claimTokenHash");

CREATE INDEX "AutomationVoucherGrant_vendorId_customerKeyHash_expiresAt_idx" ON "AutomationVoucherGrant"("vendorId", "customerKeyHash", "expiresAt");

CREATE INDEX "AutomationVoucherGrant_vendorId_productId_expiresAt_idx" ON "AutomationVoucherGrant"("vendorId", "productId", "expiresAt");

CREATE INDEX "AutomationVoucherGrant_usedOrderId_idx" ON "AutomationVoucherGrant"("usedOrderId");

CREATE UNIQUE INDEX "AutomationVoucherGrant_vendorId_id_key" ON "AutomationVoucherGrant"("vendorId", "id");

CREATE INDEX "CustomerCrmRecord_vendorId_consultationStatus_updatedAt_idx" ON "CustomerCrmRecord"("vendorId", "consultationStatus", "updatedAt");

CREATE UNIQUE INDEX "CustomerCrmRecord_vendorId_id_key" ON "CustomerCrmRecord"("vendorId", "id");

CREATE UNIQUE INDEX "CustomerCrmRecord_vendorId_customerKeyHash_key" ON "CustomerCrmRecord"("vendorId", "customerKeyHash");

CREATE INDEX "ConsultantNote_vendorId_customerRecordId_createdAt_idx" ON "ConsultantNote"("vendorId", "customerRecordId", "createdAt");

CREATE UNIQUE INDEX "ConsultantNote_vendorId_id_key" ON "ConsultantNote"("vendorId", "id");

CREATE UNIQUE INDEX "StudentPortalAccessToken_tokenHash_key" ON "StudentPortalAccessToken"("tokenHash");

CREATE INDEX "StudentPortalAccessToken_vendorId_customerKeyHash_expiresAt_idx" ON "StudentPortalAccessToken"("vendorId", "customerKeyHash", "expiresAt");

CREATE INDEX "StudentPortalAccessToken_vendorId_purpose_expiresAt_idx" ON "StudentPortalAccessToken"("vendorId", "purpose", "expiresAt");

CREATE UNIQUE INDEX "StudentPortalAccessToken_vendorId_id_key" ON "StudentPortalAccessToken"("vendorId", "id");

CREATE INDEX "CourseLessonProgress_vendorId_productId_customerKeyHash_idx" ON "CourseLessonProgress"("vendorId", "productId", "customerKeyHash");

CREATE UNIQUE INDEX "CourseLessonProgress_vendorId_lessonId_customerKeyHash_key" ON "CourseLessonProgress"("vendorId", "lessonId", "customerKeyHash");

CREATE INDEX "CommunityPost_vendorId_isPinned_createdAt_idx" ON "CommunityPost"("vendorId", "isPinned", "createdAt");

CREATE INDEX "CommunityPost_vendorId_customerKeyHash_createdAt_idx" ON "CommunityPost"("vendorId", "customerKeyHash", "createdAt");

CREATE UNIQUE INDEX "CommunityPost_vendorId_id_key" ON "CommunityPost"("vendorId", "id");

CREATE INDEX "CommunityComment_vendorId_postId_createdAt_idx" ON "CommunityComment"("vendorId", "postId", "createdAt");

CREATE UNIQUE INDEX "CommunityComment_vendorId_id_key" ON "CommunityComment"("vendorId", "id");

CREATE INDEX "CommunityReaction_vendorId_postId_idx" ON "CommunityReaction"("vendorId", "postId");

CREATE UNIQUE INDEX "CommunityReaction_vendorId_postId_customerKeyHash_key" ON "CommunityReaction"("vendorId", "postId", "customerKeyHash");

CREATE INDEX "ConsultationEvent_vendorId_isActive_idx" ON "ConsultationEvent"("vendorId", "isActive");

CREATE INDEX "ConsultationEvent_vendorId_createdAt_idx" ON "ConsultationEvent"("vendorId", "createdAt");

CREATE UNIQUE INDEX "ConsultationEvent_vendorId_id_key" ON "ConsultationEvent"("vendorId", "id");

CREATE INDEX "ConsultationBooking_vendorId_eventId_startTime_idx" ON "ConsultationBooking"("vendorId", "eventId", "startTime");

CREATE INDEX "ConsultationBooking_vendorId_eventId_status_startTime_idx" ON "ConsultationBooking"("vendorId", "eventId", "status", "startTime");

CREATE INDEX "ConsultationBooking_vendorId_customerKeyHash_startTime_idx" ON "ConsultationBooking"("vendorId", "customerKeyHash", "startTime");

CREATE UNIQUE INDEX "ConsultationBooking_vendorId_id_key" ON "ConsultationBooking"("vendorId", "id");

CREATE INDEX "Affiliate_userId_isActive_idx" ON "Affiliate"("userId", "isActive");

CREATE UNIQUE INDEX "Affiliate_vendorId_userId_key" ON "Affiliate"("vendorId", "userId");

CREATE INDEX "AffiliateCommission_affiliateId_status_idx" ON "AffiliateCommission"("affiliateId", "status");

CREATE INDEX "AffiliateCommission_vendorId_sourceId_recipientRole_idx" ON "AffiliateCommission"("vendorId", "sourceId", "recipientRole");

CREATE INDEX "AffiliateCommission_vendorId_commissionRuleSetId_idx" ON "AffiliateCommission"("vendorId", "commissionRuleSetId");

CREATE UNIQUE INDEX "AffiliateCommission_vendorId_id_key" ON "AffiliateCommission"("vendorId", "id");

CREATE UNIQUE INDEX "AffiliateCommission_vendorId_deduplicationKey_key" ON "AffiliateCommission"("vendorId", "deduplicationKey");

CREATE INDEX "AffiliatePayout_vendorId_affiliateId_requestedAt_idx" ON "AffiliatePayout"("vendorId", "affiliateId", "requestedAt");

CREATE INDEX "AnalyticsEvent_vendorId_trustLevel_eventType_createdAt_idx" ON "AnalyticsEvent"("vendorId", "trustLevel", "eventType", "createdAt");

CREATE INDEX "CourseLesson_vendorId_productId_idx" ON "CourseLesson"("vendorId", "productId");

CREATE UNIQUE INDEX "CourseLesson_vendorId_id_key" ON "CourseLesson"("vendorId", "id");

CREATE UNIQUE INDEX "CourseLesson_vendorId_productId_position_key" ON "CourseLesson"("vendorId", "productId", "position");

CREATE INDEX "FormSubmission_formId_verificationStatus_createdAt_idx" ON "FormSubmission"("formId", "verificationStatus", "createdAt");

CREATE INDEX "FormSubmission_liveId_verificationStatus_createdAt_idx" ON "FormSubmission"("liveId", "verificationStatus", "createdAt");

CREATE INDEX "FormSubmission_affiliateClickId_idx" ON "FormSubmission"("affiliateClickId");

CREATE INDEX "FormSubmission_formId_customerKeyHash_createdAt_idx" ON "FormSubmission"("formId", "customerKeyHash", "createdAt");

CREATE UNIQUE INDEX "FormSubmission_liveId_id_key" ON "FormSubmission"("liveId", "id");

CREATE UNIQUE INDEX "InteractionRole_vendorId_id_key" ON "InteractionRole"("vendorId", "id");

CREATE INDEX "Live_heroImageAssetId_idx" ON "Live"("heroImageAssetId");

CREATE INDEX "Live_vendorId_status_replayAvailableUntil_idx" ON "Live"("vendorId", "status", "replayAvailableUntil");

CREATE INDEX "LiveProduct_vendorId_liveId_sortOrder_idx" ON "LiveProduct"("vendorId", "liveId", "sortOrder");

CREATE INDEX "LiveProduct_vendorId_liveId_isVisible_sortOrder_idx" ON "LiveProduct"("vendorId", "liveId", "isVisible", "sortOrder");

CREATE UNIQUE INDEX "LiveProduct_vendorId_liveId_productId_key" ON "LiveProduct"("vendorId", "liveId", "productId");

CREATE UNIQUE INDEX "MessageTemplate_vendorId_id_key" ON "MessageTemplate"("vendorId", "id");

CREATE UNIQUE INDEX "PaymentTransaction_vendorId_checkoutIdempotencyKey_key" ON "PaymentTransaction"("vendorId", "checkoutIdempotencyKey");

CREATE INDEX "Product_vendorId_commerceDomain_isActive_idx" ON "Product"("vendorId", "commerceDomain", "isActive");

CREATE INDEX "Product_vendorId_fulfillmentType_isActive_idx" ON "Product"("vendorId", "fulfillmentType", "isActive");

CREATE INDEX "Product_imageAssetId_idx" ON "Product"("imageAssetId");

CREATE INDEX "Product_vendorId_upsellProductId_idx" ON "Product"("vendorId", "upsellProductId");

CREATE INDEX "Product_vendorId_downsellProductId_idx" ON "Product"("vendorId", "downsellProductId");

CREATE UNIQUE INDEX "Product_vendorId_slug_key" ON "Product"("vendorId", "slug");

CREATE UNIQUE INDEX "RefundRecord_vendorId_id_key" ON "RefundRecord"("vendorId", "id");

CREATE UNIQUE INDEX "RegistrationForm_vendorId_id_key" ON "RegistrationForm"("vendorId", "id");

CREATE UNIQUE INDEX "Settlement_vendorId_id_key" ON "Settlement"("vendorId", "id");

CREATE UNIQUE INDEX "TeamConversionAttribution_vendorId_id_key" ON "TeamConversionAttribution"("vendorId", "id");

CREATE UNIQUE INDEX "TeamMembership_vendorId_id_key" ON "TeamMembership"("vendorId", "id");

CREATE UNIQUE INDEX "TeamMembership_vendorId_teamId_id_key" ON "TeamMembership"("vendorId", "teamId", "id");

CREATE INDEX "Video_thumbnailAssetId_idx" ON "Video"("thumbnailAssetId");

CREATE UNIQUE INDEX "Video_vendorId_id_key" ON "Video"("vendorId", "id");

ALTER TABLE "Video" ADD CONSTRAINT "Video_vendorId_thumbnailAssetId_fkey" FOREIGN KEY ("vendorId", "thumbnailAssetId") REFERENCES "ImageAsset"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VideoArchiveState" ADD CONSTRAINT "VideoArchiveState_vendorId_videoId_fkey" FOREIGN KEY ("vendorId", "videoId") REFERENCES "Video"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_imageAssetId_fkey" FOREIGN KEY ("vendorId", "imageAssetId") REFERENCES "ImageAsset"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_courseContentOwnerMembershipId_fkey" FOREIGN KEY ("vendorId", "courseContentOwnerMembershipId") REFERENCES "TeamMembership"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_upsellProductId_fkey" FOREIGN KEY ("vendorId", "upsellProductId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_downsellProductId_fkey" FOREIGN KEY ("vendorId", "downsellProductId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_vendorId_heroImageAssetId_fkey" FOREIGN KEY ("vendorId", "heroImageAssetId") REFERENCES "ImageAsset"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_vendorId_backgroundImageAssetId_fkey" FOREIGN KEY ("vendorId", "backgroundImageAssetId") REFERENCES "ImageAsset"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_vendorId_promoVideoId_fkey" FOREIGN KEY ("vendorId", "promoVideoId") REFERENCES "Video"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_affiliateClickId_fkey" FOREIGN KEY ("affiliateClickId") REFERENCES "AffiliateClick"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Live" ADD CONSTRAINT "Live_vendorId_heroImageAssetId_fkey" FOREIGN KEY ("vendorId", "heroImageAssetId") REFERENCES "ImageAsset"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Live" ADD CONSTRAINT "Live_vendorId_liveReminderTemplateId_fkey" FOREIGN KEY ("vendorId", "liveReminderTemplateId") REFERENCES "MessageTemplate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImageAsset" ADD CONSTRAINT "ImageAsset_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveStudioDraft" ADD CONSTRAINT "LiveStudioDraft_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveStudioDraft" ADD CONSTRAINT "LiveStudioDraft_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "Live"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LiveViewerSession" ADD CONSTRAINT "LiveViewerSession_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveViewerSession" ADD CONSTRAINT "LiveViewerSession_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveProduct" ADD CONSTRAINT "LiveProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveProduct" ADD CONSTRAINT "LiveProduct_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveProduct" ADD CONSTRAINT "LiveProduct_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineOfficialAccount" ADD CONSTRAINT "LineOfficialAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineRichMenu" ADD CONSTRAINT "LineRichMenu_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineUserIdentity" ADD CONSTRAINT "LineUserIdentity_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineLoginState" ADD CONSTRAINT "LineLoginState_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineDelivery" ADD CONSTRAINT "LineDelivery_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineDelivery" ADD CONSTRAINT "LineDelivery_vendorId_lineOfficialAccountId_fkey" FOREIGN KEY ("vendorId", "lineOfficialAccountId") REFERENCES "LineOfficialAccount"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineDelivery" ADD CONSTRAINT "LineDelivery_vendorId_lineUserIdentityId_fkey" FOREIGN KEY ("vendorId", "lineUserIdentityId") REFERENCES "LineUserIdentity"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineDelivery" ADD CONSTRAINT "LineDelivery_vendorId_sourceTemplateId_fkey" FOREIGN KEY ("vendorId", "sourceTemplateId") REFERENCES "MessageTemplate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_liveId_formSubmissionId_fkey" FOREIGN KEY ("liveId", "formSubmissionId") REFERENCES "FormSubmission"("liveId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_vendorId_roleId_fkey" FOREIGN KEY ("vendorId", "roleId") REFERENCES "InteractionRole"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiveQuestion" ADD CONSTRAINT "LiveQuestion_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveQuestion" ADD CONSTRAINT "LiveQuestion_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveNotificationRule" ADD CONSTRAINT "LiveNotificationRule_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveNotificationRule" ADD CONSTRAINT "LiveNotificationRule_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveNotificationRule" ADD CONSTRAINT "LiveNotificationRule_vendorId_messageTemplateId_fkey" FOREIGN KEY ("vendorId", "messageTemplateId") REFERENCES "MessageTemplate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveReminderReconciliationJob" ADD CONSTRAINT "LiveReminderReconciliationJob_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveReminderReconciliationJob" ADD CONSTRAINT "LiveReminderReconciliationJob_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailSuppression" ADD CONSTRAINT "EmailSuppression_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveInteractionRun" ADD CONSTRAINT "LiveInteractionRun_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveInteractionRun" ADD CONSTRAINT "LiveInteractionRun_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveInteractionResponse" ADD CONSTRAINT "LiveInteractionResponse_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveInteractionResponse" ADD CONSTRAINT "LiveInteractionResponse_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveInteractionResponse" ADD CONSTRAINT "LiveInteractionResponse_vendorId_runId_fkey" FOREIGN KEY ("vendorId", "runId") REFERENCES "LiveInteractionRun"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveInteractionResponse" ADD CONSTRAINT "LiveInteractionResponse_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "Live"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralCode" ADD CONSTRAINT "PlatformReferralCode_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralClick" ADD CONSTRAINT "PlatformReferralClick_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "PlatformReferralCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralAttribution" ADD CONSTRAINT "PlatformReferralAttribution_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "PlatformReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralAttribution" ADD CONSTRAINT "PlatformReferralAttribution_referralCodeId_clickId_fkey" FOREIGN KEY ("referralCodeId", "clickId") REFERENCES "PlatformReferralClick"("referralCodeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralAttribution" ADD CONSTRAINT "PlatformReferralAttribution_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "VendorSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralAttribution" ADD CONSTRAINT "PlatformReferralAttribution_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralCommission" ADD CONSTRAINT "PlatformReferralCommission_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralCommission" ADD CONSTRAINT "PlatformReferralCommission_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralCommission" ADD CONSTRAINT "PlatformReferralCommission_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "VendorSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralCommission" ADD CONSTRAINT "PlatformReferralCommission_vendorId_paymentTransactionId_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralCommissionLedgerEntry" ADD CONSTRAINT "PlatformReferralCommissionLedgerEntry_platformReferralComm_fkey" FOREIGN KEY ("platformReferralCommissionId") REFERENCES "PlatformReferralCommission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralPayout" ADD CONSTRAINT "PlatformReferralPayout_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformReferralPayout" ADD CONSTRAINT "PlatformReferralPayout_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PlatformReferralPayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_vendorId_settlementId_fkey" FOREIGN KEY ("vendorId", "settlementId") REFERENCES "Settlement"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentMethodReference" ADD CONSTRAINT "PaymentMethodReference_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentMethodReference" ADD CONSTRAINT "PaymentMethodReference_vendorId_teamId_membershipId_fkey" FOREIGN KEY ("vendorId", "teamId", "membershipId") REFERENCES "TeamMembership"("vendorId", "teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_vendorId_primaryPaymentTransactionId_fkey" FOREIGN KEY ("vendorId", "primaryPaymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderEvent" ADD CONSTRAINT "CommerceOrderEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderEvent" ADD CONSTRAINT "CommerceOrderEvent_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderRefund" ADD CONSTRAINT "CommerceOrderRefund_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderRefund" ADD CONSTRAINT "CommerceOrderRefund_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderRefund" ADD CONSTRAINT "CommerceOrderRefund_vendorId_paymentTransactionId_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderRefund" ADD CONSTRAINT "CommerceOrderRefund_vendorId_refundRecordId_fkey" FOREIGN KEY ("vendorId", "refundRecordId") REFERENCES "RefundRecord"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ElectronicInvoice" ADD CONSTRAINT "ElectronicInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ElectronicInvoice" ADD CONSTRAINT "ElectronicInvoice_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ElectronicInvoiceAllowance" ADD CONSTRAINT "ElectronicInvoiceAllowance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ElectronicInvoiceAllowance" ADD CONSTRAINT "ElectronicInvoiceAllowance_vendorId_electronicInvoiceId_fkey" FOREIGN KEY ("vendorId", "electronicInvoiceId") REFERENCES "ElectronicInvoice"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ElectronicInvoiceAllowance" ADD CONSTRAINT "ElectronicInvoiceAllowance_vendorId_commerceRefundId_fkey" FOREIGN KEY ("vendorId", "commerceRefundId") REFERENCES "CommerceOrderRefund"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_vendorId_createdByMemberId_fkey" FOREIGN KEY ("vendorId", "createdByMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_vendorId_orderId_createdByBuyerGrantId_fkey" FOREIGN KEY ("vendorId", "orderId", "createdByBuyerGrantId") REFERENCES "BuyerSupportOrderGrant"("vendorId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_vendorId_assignedMemberId_fkey" FOREIGN KEY ("vendorId", "assignedMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_vendorId_supportCaseId_fkey" FOREIGN KEY ("vendorId", "supportCaseId") REFERENCES "SupportCase"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_vendorId_actorMemberId_fkey" FOREIGN KEY ("vendorId", "actorMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_vendorId_actorBuyerOrderId_actorBuyerGran_fkey" FOREIGN KEY ("vendorId", "actorBuyerOrderId", "actorBuyerGrantId") REFERENCES "BuyerSupportOrderGrant"("vendorId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BuyerSupportOrderGrant" ADD CONSTRAINT "BuyerSupportOrderGrant_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuyerSupportOrderGrant" ADD CONSTRAINT "BuyerSupportOrderGrant_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_vendorId_supportCaseId_fkey" FOREIGN KEY ("vendorId", "supportCaseId") REFERENCES "SupportCase"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_vendorId_paymentTransactionId_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_vendorId_requestedByMemberId_fkey" FOREIGN KEY ("vendorId", "requestedByMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_reviewedByActorId_fkey" FOREIGN KEY ("reviewedByActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_vendorId_orderId_completedRefundId_fkey" FOREIGN KEY ("vendorId", "orderId", "completedRefundId") REFERENCES "CommerceOrderRefund"("vendorId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportRefundHandoffRefund" ADD CONSTRAINT "SupportRefundHandoffRefund_vendorId_handoffId_fkey" FOREIGN KEY ("vendorId", "handoffId") REFERENCES "SupportRefundHandoff"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportRefundHandoffRefund" ADD CONSTRAINT "SupportRefundHandoffRefund_vendorId_orderId_refundId_fkey" FOREIGN KEY ("vendorId", "orderId", "refundId") REFERENCES "CommerceOrderRefund"("vendorId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendorDeliveryUrlAllowlist" ADD CONSTRAINT "VendorDeliveryUrlAllowlist_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductDeliveryConfig" ADD CONSTRAINT "ProductDeliveryConfig_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductDeliveryConfig" ADD CONSTRAINT "ProductDeliveryConfig_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductDeliveryConfig" ADD CONSTRAINT "ProductDeliveryConfig_vendorId_allowlistId_fkey" FOREIGN KEY ("vendorId", "allowlistId") REFERENCES "VendorDeliveryUrlAllowlist"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderItemDeliverySnapshot" ADD CONSTRAINT "CommerceOrderItemDeliverySnapshot_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderItemDeliverySnapshot" ADD CONSTRAINT "CommerceOrderItemDeliverySnapshot_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceOrderItemDeliverySnapshot" ADD CONSTRAINT "CommerceOrderItemDeliverySnapshot_vendorId_orderId_orderIt_fkey" FOREIGN KEY ("vendorId", "orderId", "orderItemId") REFERENCES "CommerceOrderItem"("vendorId", "orderId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShippingFulfillment" ADD CONSTRAINT "ShippingFulfillment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShippingFulfillment" ADD CONSTRAINT "ShippingFulfillment_vendorId_orderItemId_fkey" FOREIGN KEY ("vendorId", "orderItemId") REFERENCES "CommerceOrderItem"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceEntitlement" ADD CONSTRAINT "CommerceEntitlement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceEntitlement" ADD CONSTRAINT "CommerceEntitlement_vendorId_orderItemId_fkey" FOREIGN KEY ("vendorId", "orderItemId") REFERENCES "CommerceOrderItem"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceFulfillment" ADD CONSTRAINT "ServiceFulfillment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceFulfillment" ADD CONSTRAINT "ServiceFulfillment_vendorId_orderItemId_fkey" FOREIGN KEY ("vendorId", "orderItemId") REFERENCES "CommerceOrderItem"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefundRecord" ADD CONSTRAINT "RefundRecord_vendorId_paymentTransactionId_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_vendorId_affiliateId_fkey" FOREIGN KEY ("vendorId", "affiliateId") REFERENCES "Affiliate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_vendorId_commissionRuleSetId_fkey" FOREIGN KEY ("vendorId", "commissionRuleSetId") REFERENCES "CommissionRuleSet"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommissionRuleSet" ADD CONSTRAINT "CommissionRuleSet_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommissionRateTier" ADD CONSTRAINT "CommissionRateTier_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommissionRateTier" ADD CONSTRAINT "CommissionRateTier_vendorId_commissionRuleSetId_fkey" FOREIGN KEY ("vendorId", "commissionRuleSetId") REFERENCES "CommissionRuleSet"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommissionQuantityTier" ADD CONSTRAINT "CommissionQuantityTier_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommissionQuantityTier" ADD CONSTRAINT "CommissionQuantityTier_vendorId_commissionRuleSetId_fkey" FOREIGN KEY ("vendorId", "commissionRuleSetId") REFERENCES "CommissionRuleSet"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommissionUplineLevel" ADD CONSTRAINT "CommissionUplineLevel_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommissionUplineLevel" ADD CONSTRAINT "CommissionUplineLevel_vendorId_commissionRuleSetId_fkey" FOREIGN KEY ("vendorId", "commissionRuleSetId") REFERENCES "CommissionRuleSet"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommissionProductOverride" ADD CONSTRAINT "CommissionProductOverride_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommissionProductOverride" ADD CONSTRAINT "CommissionProductOverride_vendorId_commissionRuleSetId_fkey" FOREIGN KEY ("vendorId", "commissionRuleSetId") REFERENCES "CommissionRuleSet"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommissionProductOverride" ADD CONSTRAINT "CommissionProductOverride_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AffiliateCommissionLedgerEntry" ADD CONSTRAINT "AffiliateCommissionLedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AffiliateCommissionLedgerEntry" ADD CONSTRAINT "AffiliateCommissionLedgerEntry_vendorId_affiliateCommissio_fkey" FOREIGN KEY ("vendorId", "affiliateCommissionId") REFERENCES "AffiliateCommission"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_vendorId_affiliateId_fkey" FOREIGN KEY ("vendorId", "affiliateId") REFERENCES "Affiliate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseCommissionAllocation" ADD CONSTRAINT "CourseCommissionAllocation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseCommissionAllocation" ADD CONSTRAINT "CourseCommissionAllocation_vendorId_paymentTransactionId_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseCommissionAllocation" ADD CONSTRAINT "CourseCommissionAllocation_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseCommissionAllocation" ADD CONSTRAINT "CourseCommissionAllocation_vendorId_recipientMembershipId_fkey" FOREIGN KEY ("vendorId", "recipientMembershipId") REFERENCES "TeamMembership"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseCommissionAllocation" ADD CONSTRAINT "CourseCommissionAllocation_vendorId_teamConversionAttribut_fkey" FOREIGN KEY ("vendorId", "teamConversionAttributionId") REFERENCES "TeamConversionAttribution"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseCommissionLedgerEntry" ADD CONSTRAINT "CourseCommissionLedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseCommissionLedgerEntry" ADD CONSTRAINT "CourseCommissionLedgerEntry_vendorId_courseCommissionAlloc_fkey" FOREIGN KEY ("vendorId", "courseCommissionAllocationId") REFERENCES "CourseCommissionAllocation"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CoursePayout" ADD CONSTRAINT "CoursePayout_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoursePayout" ADD CONSTRAINT "CoursePayout_vendorId_recipientMembershipId_fkey" FOREIGN KEY ("vendorId", "recipientMembershipId") REFERENCES "TeamMembership"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "PartnerFunnelPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TeamFunnelTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_promoterMembershipId_fkey" FOREIGN KEY ("promoterMembershipId") REFERENCES "TeamMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StreamUsageLedgerEntry" ADD CONSTRAINT "StreamUsageLedgerEntry_contentOwnerMembershipId_fkey" FOREIGN KEY ("contentOwnerMembershipId") REFERENCES "TeamMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StreamUsageReconciliation" ADD CONSTRAINT "StreamUsageReconciliation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StreamOperationsAlert" ADD CONSTRAINT "StreamOperationsAlert_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StreamOperationsAlert" ADD CONSTRAINT "StreamOperationsAlert_vendorId_reconciliationId_fkey" FOREIGN KEY ("vendorId", "reconciliationId") REFERENCES "StreamUsageReconciliation"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StreamUsageAllocationEntry" ADD CONSTRAINT "StreamUsageAllocationEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StreamUsageAllocationEntry" ADD CONSTRAINT "StreamUsageAllocationEntry_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StreamUsageAllocationEntry" ADD CONSTRAINT "StreamUsageAllocationEntry_vendorId_ledgerEntryId_fkey" FOREIGN KEY ("vendorId", "ledgerEntryId") REFERENCES "StreamUsageLedgerEntry"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StreamUsageAllocationEntry" ADD CONSTRAINT "StreamUsageAllocationEntry_vendorId_recipientTeamId_recipi_fkey" FOREIGN KEY ("vendorId", "recipientTeamId", "recipientMembershipId") REFERENCES "TeamMembership"("vendorId", "teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartnerLiveShare" ADD CONSTRAINT "PartnerLiveShare_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerLiveShare" ADD CONSTRAINT "PartnerLiveShare_vendorId_teamId_fkey" FOREIGN KEY ("vendorId", "teamId") REFERENCES "SalesTeam"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerLiveShare" ADD CONSTRAINT "PartnerLiveShare_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartnerLiveShare" ADD CONSTRAINT "PartnerLiveShare_vendorId_sourcePageId_fkey" FOREIGN KEY ("vendorId", "sourcePageId") REFERENCES "PartnerFunnelPage"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerLiveShare" ADD CONSTRAINT "PartnerLiveShare_vendorId_teamId_promoterMembershipId_fkey" FOREIGN KEY ("vendorId", "teamId", "promoterMembershipId") REFERENCES "TeamMembership"("vendorId", "teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutomationExecutionLog" ADD CONSTRAINT "AutomationExecutionLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutomationExecutionLog" ADD CONSTRAINT "AutomationExecutionLog_vendorId_ruleId_fkey" FOREIGN KEY ("vendorId", "ruleId") REFERENCES "AutomationRule"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerTagAssignment" ADD CONSTRAINT "CustomerTagAssignment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerTagAssignment" ADD CONSTRAINT "CustomerTagAssignment_vendorId_sourceExecutionLogId_fkey" FOREIGN KEY ("vendorId", "sourceExecutionLogId") REFERENCES "AutomationExecutionLog"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutomationVoucherGrant" ADD CONSTRAINT "AutomationVoucherGrant_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutomationVoucherGrant" ADD CONSTRAINT "AutomationVoucherGrant_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomationVoucherGrant" ADD CONSTRAINT "AutomationVoucherGrant_vendorId_sourceExecutionLogId_fkey" FOREIGN KEY ("vendorId", "sourceExecutionLogId") REFERENCES "AutomationExecutionLog"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerCrmRecord" ADD CONSTRAINT "CustomerCrmRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultantNote" ADD CONSTRAINT "ConsultantNote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultantNote" ADD CONSTRAINT "ConsultantNote_vendorId_customerRecordId_fkey" FOREIGN KEY ("vendorId", "customerRecordId") REFERENCES "CustomerCrmRecord"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentPortalAccessToken" ADD CONSTRAINT "StudentPortalAccessToken_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseLessonProgress" ADD CONSTRAINT "CourseLessonProgress_vendorId_lessonId_fkey" FOREIGN KEY ("vendorId", "lessonId") REFERENCES "CourseLesson"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_vendorId_postId_fkey" FOREIGN KEY ("vendorId", "postId") REFERENCES "CommunityPost"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityReaction" ADD CONSTRAINT "CommunityReaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityReaction" ADD CONSTRAINT "CommunityReaction_vendorId_postId_fkey" FOREIGN KEY ("vendorId", "postId") REFERENCES "CommunityPost"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultationEvent" ADD CONSTRAINT "ConsultationEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultationBooking" ADD CONSTRAINT "ConsultationBooking_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultationBooking" ADD CONSTRAINT "ConsultationBooking_vendorId_eventId_fkey" FOREIGN KEY ("vendorId", "eventId") REFERENCES "ConsultationEvent"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER INDEX "PartnerFunnelPageShareSetting_accessMode_isEnabled_expiresAt_id" RENAME TO "PartnerFunnelPageShareSetting_accessMode_isEnabled_expiresA_idx";

ALTER INDEX "TeamClickAttribution_teamId_promoterMembershipId_attributedAt_i" RENAME TO "TeamClickAttribution_teamId_promoterMembershipId_attributed_idx";

ALTER INDEX "TeamConversionAttribution_teamId_leaderMembershipId_attributedA" RENAME TO "TeamConversionAttribution_teamId_leaderMembershipId_attribu_idx";

ALTER INDEX "TeamConversionAttribution_teamId_promoterMembershipId_attribute" RENAME TO "TeamConversionAttribution_teamId_promoterMembershipId_attri_idx";

ALTER INDEX "TeamFunnelTemplateProductSlot_templateVersionId_displayOrder_ke" RENAME TO "TeamFunnelTemplateProductSlot_templateVersionId_displayOrde_key";

ALTER INDEX "TeamLeadAttribution_teamId_promoterMembershipId_attributedAt_id" RENAME TO "TeamLeadAttribution_teamId_promoterMembershipId_attributedA_idx";

ALTER INDEX "TeamMembershipRelationship_teamId_downlineMembershipId_endedAt_" RENAME TO "TeamMembershipRelationship_teamId_downlineMembershipId_ende_idx";

ALTER INDEX "TeamMembershipRelationship_teamId_uplineMembershipId_endedAt_id" RENAME TO "TeamMembershipRelationship_teamId_uplineMembershipId_endedA_idx";
INSERT INTO "AffiliateCommissionLedgerEntry" (
  "id", "vendorId", "affiliateCommissionId", "entryType", "deduplicationKey",
  "providerName", "eventIdentity", "amountCents", "occurredAt"
)
SELECT
  'opening_' || "id", "vendorId", "id", 'opening_balance',
  'commission-ledger:v1|opening:' || "id", 'migration', 'opening:' || "id",
  "commissionAmountCents", "attributedAt"
FROM "AffiliateCommission" commission
WHERE NOT EXISTS (
  SELECT 1 FROM "AffiliateCommissionLedgerEntry" entry
  WHERE entry."vendorId" = commission."vendorId"
    AND entry."deduplicationKey" = 'commission-ledger:v1|opening:' || commission."id"
);


UPDATE "AffiliateCommission" AS commission
SET "netReferenceAmountCents" = GREATEST(
  0,
  transaction."netAmountCents"
    - transaction."refundedAmountCents"
    + COALESCE(refund_totals."gatewayFeeRefundCents", 0)
    + COALESCE(refund_totals."platformFeeRefundCents", 0)
)
FROM "PaymentTransaction" AS transaction
LEFT JOIN (
  SELECT
    "paymentTransactionId",
    SUM("gatewayFeeRefundCents") AS "gatewayFeeRefundCents",
    SUM("platformFeeRefundCents") AS "platformFeeRefundCents"
  FROM "RefundRecord"
  WHERE "status" = 'processed'
  GROUP BY "paymentTransactionId"
) AS refund_totals ON refund_totals."paymentTransactionId" = transaction."id"
WHERE commission."sourceType" = 'webhook'
  AND commission."sourceId" = transaction."id"
  AND commission."vendorId" = transaction."vendorId";

CREATE OR REPLACE FUNCTION public."AffiliateCommissionLedgerEntry_reject_mutation"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'AffiliateCommissionLedgerEntry is append-only';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_affiliate_commission_rule_snapshot_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."affiliateId" IS DISTINCT FROM OLD."affiliateId"
    OR NEW."monthKey" IS DISTINCT FROM OLD."monthKey"
    OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
    OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
    OR NEW."deduplicationKey" IS DISTINCT FROM OLD."deduplicationKey"
    OR NEW."referralCode" IS DISTINCT FROM OLD."referralCode"
    OR NEW."orderNumber" IS DISTINCT FROM OLD."orderNumber"
    OR NEW."orderAmountCents" IS DISTINCT FROM OLD."orderAmountCents"
    OR NEW."commissionBaseAmountCents" IS DISTINCT FROM OLD."commissionBaseAmountCents"
    OR NEW."commissionRateBps" IS DISTINCT FROM OLD."commissionRateBps"
    OR NEW."commissionAmountCents" IS DISTINCT FROM OLD."commissionAmountCents"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."recipientRole" IS DISTINCT FROM OLD."recipientRole"
    OR NEW."uplineLevel" IS DISTINCT FROM OLD."uplineLevel"
    OR NEW."commissionRuleSetId" IS DISTINCT FROM OLD."commissionRuleSetId"
    OR NEW."commissionRuleVersion" IS DISTINCT FROM OLD."commissionRuleVersion"
    OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
    OR NEW."matchedTier" IS DISTINCT FROM OLD."matchedTier"
    OR NEW."appliedRateBps" IS DISTINCT FROM OLD."appliedRateBps"
    OR NEW."calculationSnapshot" IS DISTINCT FROM OLD."calculationSnapshot"
    OR NEW."monthlySalesBeforeCents" IS DISTINCT FROM OLD."monthlySalesBeforeCents"
    OR NEW."monthlySalesAfterCents" IS DISTINCT FROM OLD."monthlySalesAfterCents"
    OR NEW."orderQuantity" IS DISTINCT FROM OLD."orderQuantity"
    OR NEW."cumulativeSalesBeforeCount" IS DISTINCT FROM OLD."cumulativeSalesBeforeCount"
    OR NEW."cumulativeSalesAfterCount" IS DISTINCT FROM OLD."cumulativeSalesAfterCount"
  THEN
    RAISE EXCEPTION 'AffiliateCommission rule snapshot is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'AffiliateCommission_rule_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_commerce_order_refund_limit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  order_paid INTEGER;
  order_total INTEGER;
BEGIN
  SELECT "paidAmountCents", "totalAmountCents"
  INTO order_paid, order_total
  FROM "CommerceOrder"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderId";

  IF FOUND AND NEW."cumulativeAmountCents" > LEAST(order_paid, order_total) THEN
    RAISE EXCEPTION 'Commerce order refund exceeds the paid order amount.'
      USING ERRCODE = '23514', CONSTRAINT = 'CommerceOrderRefund_order_limit_check';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_commission_rule_identity_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."maxTotalRateBps" IS DISTINCT FROM OLD."maxTotalRateBps"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'CommissionRuleSet policy identity is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'CommissionRuleSet_identity_immutable';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_entitlement_fulfillment_type()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  item_type "CommerceFulfillmentType";
BEGIN
  SELECT "fulfillmentType" INTO item_type
  FROM "CommerceOrderItem"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderItemId";
  IF FOUND AND item_type NOT IN ('digital', 'course') THEN
    RAISE EXCEPTION 'Commerce entitlement requires a digital or course order item.'
      USING ERRCODE = '23514', CONSTRAINT = 'CommerceEntitlement_item_type_check';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_linked_commerce_order_refund_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SupportRefundHandoffRefund" AS link
    WHERE link."vendorId" = OLD."vendorId" AND link."refundId" = OLD."id"
  ) AND (
    NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."paymentTransactionId" IS DISTINCT FROM OLD."paymentTransactionId"
    OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
    OR NEW."status" IS DISTINCT FROM OLD."status"
  ) THEN
    RAISE EXCEPTION 'A canonical refund used by a support handoff is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'CommerceOrderRefund_support_link_immutable_check';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_service_fulfillment_type()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  item_type "CommerceFulfillmentType";
BEGIN
  SELECT "fulfillmentType" INTO item_type
  FROM "CommerceOrderItem"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderItemId";
  IF FOUND AND item_type <> 'service' THEN
    RAISE EXCEPTION 'Service fulfillment requires a service order item.'
      USING ERRCODE = '23514', CONSTRAINT = 'ServiceFulfillment_item_type_check';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_shipping_fulfillment_type()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  item_type "CommerceFulfillmentType";
BEGIN
  SELECT "fulfillmentType" INTO item_type
  FROM "CommerceOrderItem"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderItemId";
  IF FOUND AND item_type <> 'physical' THEN
    RAISE EXCEPTION 'Shipping fulfillment requires a physical order item.'
      USING ERRCODE = '23514', CONSTRAINT = 'ShippingFulfillment_item_type_check';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_stream_usage_reconciliation_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."monthKey" IS DISTINCT FROM OLD."monthKey"
    OR NEW."sourceDigest" IS DISTINCT FROM OLD."sourceDigest"
    OR NEW."sourceReference" IS DISTINCT FROM OLD."sourceReference"
    OR NEW."providerWatchMinutes" IS DISTINCT FROM OLD."providerWatchMinutes"
    OR NEW."providerStorageMinutes" IS DISTINCT FROM OLD."providerStorageMinutes"
    OR NEW."internalWatchSeconds" IS DISTINCT FROM OLD."internalWatchSeconds"
    OR NEW."internalWatchMinutes" IS DISTINCT FROM OLD."internalWatchMinutes"
    OR NEW."differenceMinutes" IS DISTINCT FROM OLD."differenceMinutes"
    OR NEW."evidenceKind" IS DISTINCT FROM OLD."evidenceKind"
    OR NEW."capturedAt" IS DISTINCT FROM OLD."capturedAt"
    OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
    OR NEW."createdByActorLabel" IS DISTINCT FROM OLD."createdByActorLabel"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Stream usage reconciliation snapshot is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'StreamUsageReconciliation_immutable_check';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD."status" <> 'MISMATCH'
    OR NEW."status" <> 'RESOLVED'
  ) THEN
    RAISE EXCEPTION 'Only a mismatch may transition to resolved.'
      USING ERRCODE = '23514', CONSTRAINT = 'StreamUsageReconciliation_transition_check';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_support_refund_handoff_order()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  order_payment_id TEXT;
  order_status "CommerceOrderStatus";
  order_paid INTEGER;
  order_refunded INTEGER;
  completion_link_count INTEGER;
  completion_amount INTEGER;
  invalid_completion_count INTEGER;
BEGIN
  SELECT "primaryPaymentTransactionId", "status", "paidAmountCents", "refundedAmountCents"
  INTO order_payment_id, order_status, order_paid, order_refunded
  FROM "CommerceOrder"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderId";

  IF NOT FOUND
    OR order_payment_id IS DISTINCT FROM NEW."paymentTransactionId"
    OR order_status NOT IN ('paid', 'partially_refunded', 'refunded')
  THEN
    RAISE EXCEPTION 'Support refund handoff does not match a refundable canonical order.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_order_check';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."supportCaseId" IS DISTINCT FROM OLD."supportCaseId"
    OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
    OR NEW."paymentTransactionId" IS DISTINCT FROM OLD."paymentTransactionId"
    OR NEW."requestedByMemberId" IS DISTINCT FROM OLD."requestedByMemberId"
    OR NEW."requestedAmountCents" IS DISTINCT FROM OLD."requestedAmountCents"
    OR NEW."reasonEncryptedEnvelope" IS DISTINCT FROM OLD."reasonEncryptedEnvelope"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Support refund handoff commercial identity is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_immutable_check';
  END IF;

  IF TG_OP = 'INSERT' AND NEW."requestedAmountCents" > order_paid - order_refunded THEN
    RAISE EXCEPTION 'Support refund handoff exceeds the remaining refundable amount.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_remaining_check';
  END IF;

  IF NEW."status" = 'completed' THEN
    SELECT
      COUNT(*)::INTEGER,
      COALESCE(SUM(link."amountCentsSnapshot"), 0)::INTEGER,
      COUNT(*) FILTER (
        WHERE refund."id" IS NULL
          OR refund."status" IS DISTINCT FROM 'processed'
          OR refund."paymentTransactionId" IS DISTINCT FROM NEW."paymentTransactionId"
          OR refund."amountCents" IS DISTINCT FROM link."amountCentsSnapshot"
      )::INTEGER
    INTO completion_link_count, completion_amount, invalid_completion_count
    FROM "SupportRefundHandoffRefund" AS link
    LEFT JOIN "CommerceOrderRefund" AS refund
      ON refund."vendorId" = link."vendorId"
      AND refund."orderId" = link."orderId"
      AND refund."id" = link."refundId"
    WHERE link."vendorId" = NEW."vendorId"
      AND link."handoffId" = NEW."id"
      AND link."orderId" = NEW."orderId";

    IF completion_link_count < 1
      OR completion_amount <> NEW."requestedAmountCents"
      OR invalid_completion_count > 0
      OR NOT EXISTS (
        SELECT 1
        FROM "SupportRefundHandoffRefund" AS anchor
        WHERE anchor."vendorId" = NEW."vendorId"
          AND anchor."handoffId" = NEW."id"
          AND anchor."refundId" = NEW."completedRefundId"
      )
    THEN
      RAISE EXCEPTION 'Support refund completion requires exact processed canonical refund links.'
        USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_completion_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_support_refund_handoff_refund()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  handoff_status "SupportRefundHandoffStatus";
  handoff_order_id TEXT;
  handoff_payment_id TEXT;
  refund_amount INTEGER;
  refund_status "CommerceOrderRefundStatus";
  refund_payment_id TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Support refund completion links are immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoffRefund_immutable_check';
  END IF;

  SELECT "status", "orderId", "paymentTransactionId"
  INTO handoff_status, handoff_order_id, handoff_payment_id
  FROM "SupportRefundHandoff"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."handoffId";

  SELECT "amountCents", "status", "paymentTransactionId"
  INTO refund_amount, refund_status, refund_payment_id
  FROM "CommerceOrderRefund"
  WHERE "vendorId" = NEW."vendorId"
    AND "orderId" = NEW."orderId"
    AND "id" = NEW."refundId";

  IF handoff_status IS DISTINCT FROM 'reviewing'
    OR handoff_order_id IS DISTINCT FROM NEW."orderId"
    OR refund_status IS DISTINCT FROM 'processed'
    OR refund_payment_id IS DISTINCT FROM handoff_payment_id
    OR refund_amount IS DISTINCT FROM NEW."amountCentsSnapshot"
  THEN
    RAISE EXCEPTION 'Support refund link must reference a matching processed canonical refund.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoffRefund_reference_check';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reject_commission_product_override_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Commission product overrides are append-only.'
    USING ERRCODE = '23514', CONSTRAINT = 'CommissionProductOverride_immutable';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reject_commission_rule_detail_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Commission rule version details are append-only.'
    USING ERRCODE = '23514', CONSTRAINT = 'CommissionRuleDetail_immutable';
END;
$function$
;

ALTER TABLE public."Affiliate" DROP CONSTRAINT IF EXISTS "Affiliate_commissionRateBps_bounds";
ALTER TABLE public."Affiliate" ADD CONSTRAINT "Affiliate_commissionRateBps_bounds" CHECK ((("commissionRateBps" >= 0) AND ("commissionRateBps" <= 10000)));
ALTER TABLE public."AffiliateCommission" DROP CONSTRAINT IF EXISTS "AffiliateCommission_amount_by_sourceType";
ALTER TABLE public."AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_amount_by_sourceType" CHECK (((("sourceType" = 'refund_adjustment'::text) AND ("orderAmountCents" <= "commissionAmountCents") AND ("commissionAmountCents" <= 0)) OR (("sourceType" <> 'refund_adjustment'::text) AND ("orderAmountCents" >= 0) AND ("commissionAmountCents" >= 0) AND ("commissionAmountCents" <= "orderAmountCents"))));
ALTER TABLE public."AffiliateCommission" DROP CONSTRAINT IF EXISTS "AffiliateCommission_commissionRateBps_bounds";
ALTER TABLE public."AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_commissionRateBps_bounds" CHECK ((("commissionRateBps" >= 0) AND ("commissionRateBps" <= 10000)));
ALTER TABLE public."AffiliateCommission" DROP CONSTRAINT IF EXISTS "AffiliateCommission_deduplicationKey_nonblank";
ALTER TABLE public."AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_deduplicationKey_nonblank" CHECK ((btrim("deduplicationKey") <> ''::text));
ALTER TABLE public."AffiliateCommission" DROP CONSTRAINT IF EXISTS "AffiliateCommission_quantity_snapshot_check";
ALTER TABLE public."AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_quantity_snapshot_check" CHECK (((("orderQuantity" IS NULL) AND ("cumulativeSalesBeforeCount" IS NULL) AND ("cumulativeSalesAfterCount" IS NULL)) OR (("orderQuantity" >= 1) AND ("cumulativeSalesBeforeCount" >= 0) AND ("cumulativeSalesAfterCount" = ("cumulativeSalesBeforeCount" + "orderQuantity")))));
ALTER TABLE public."AffiliateCommission" DROP CONSTRAINT IF EXISTS "AffiliateCommission_rule_snapshot_check";
ALTER TABLE public."AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_rule_snapshot_check" CHECK (((("commissionRuleSetId" IS NULL) AND ("commissionRuleVersion" IS NULL) AND ("policyVersion" IS NULL) AND ("monthlySalesBeforeCents" IS NULL) AND ("monthlySalesAfterCents" IS NULL) AND ("orderQuantity" IS NULL) AND ("cumulativeSalesBeforeCount" IS NULL) AND ("cumulativeSalesAfterCount" IS NULL)) OR (("commissionRuleSetId" IS NOT NULL) AND ("commissionRuleVersion" IS NOT NULL) AND ("policyVersion" IS NOT NULL) AND ("appliedRateBps" IS NOT NULL) AND ("matchedTier" IS NOT NULL) AND ("calculationSnapshot" IS NOT NULL) AND ((("monthlySalesBeforeCents" IS NOT NULL) AND ("monthlySalesAfterCents" IS NOT NULL) AND ("orderQuantity" IS NULL) AND ("cumulativeSalesBeforeCount" IS NULL) AND ("cumulativeSalesAfterCount" IS NULL)) OR (("monthlySalesBeforeCents" IS NULL) AND ("monthlySalesAfterCents" IS NULL) AND ("orderQuantity" IS NOT NULL) AND ("cumulativeSalesBeforeCount" IS NOT NULL) AND ("cumulativeSalesAfterCount" IS NOT NULL))))));
ALTER TABLE public."AffiliateCommission" DROP CONSTRAINT IF EXISTS "AffiliateCommission_sourceType_nonblank";
ALTER TABLE public."AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_sourceType_nonblank" CHECK ((btrim("sourceType") <> ''::text));
ALTER TABLE public."AffiliateCommissionLedgerEntry" DROP CONSTRAINT IF EXISTS "AffiliateCommissionLedgerEntry_amount_direction";
ALTER TABLE public."AffiliateCommissionLedgerEntry" ADD CONSTRAINT "AffiliateCommissionLedgerEntry_amount_direction" CHECK ((("entryType" = 'opening_balance'::public."AffiliateCommissionLedgerEntryType") OR (("entryType" = 'accrual'::public."AffiliateCommissionLedgerEntryType") AND ("amountCents" > 0)) OR (("entryType" = ANY (ARRAY['refund'::public."AffiliateCommissionLedgerEntryType", 'reversal'::public."AffiliateCommissionLedgerEntryType", 'dispute_lost'::public."AffiliateCommissionLedgerEntryType"])) AND ("amountCents" < 0)) OR (("entryType" = ANY (ARRAY['dispute_opened'::public."AffiliateCommissionLedgerEntryType", 'dispute_released'::public."AffiliateCommissionLedgerEntryType"])) AND ("amountCents" = 0))));
ALTER TABLE public."AffiliateCommissionLedgerEntry" DROP CONSTRAINT IF EXISTS "AffiliateCommissionLedgerEntry_deduplicationKey_nonblank";
ALTER TABLE public."AffiliateCommissionLedgerEntry" ADD CONSTRAINT "AffiliateCommissionLedgerEntry_deduplicationKey_nonblank" CHECK ((btrim("deduplicationKey") <> ''::text));
ALTER TABLE public."AffiliateCommissionLedgerEntry" DROP CONSTRAINT IF EXISTS "AffiliateCommissionLedgerEntry_dispute_case_required";
ALTER TABLE public."AffiliateCommissionLedgerEntry" ADD CONSTRAINT "AffiliateCommissionLedgerEntry_dispute_case_required" CHECK (((("entryType" = ANY (ARRAY['dispute_opened'::public."AffiliateCommissionLedgerEntryType", 'dispute_released'::public."AffiliateCommissionLedgerEntryType", 'dispute_lost'::public."AffiliateCommissionLedgerEntryType"])) AND (btrim(COALESCE("disputeCaseId", ''::text)) <> ''::text)) OR ("entryType" <> ALL (ARRAY['dispute_opened'::public."AffiliateCommissionLedgerEntryType", 'dispute_released'::public."AffiliateCommissionLedgerEntryType", 'dispute_lost'::public."AffiliateCommissionLedgerEntryType"]))));
ALTER TABLE public."AffiliateCommissionLedgerEntry" DROP CONSTRAINT IF EXISTS "AffiliateCommissionLedgerEntry_eventIdentity_nonblank";
ALTER TABLE public."AffiliateCommissionLedgerEntry" ADD CONSTRAINT "AffiliateCommissionLedgerEntry_eventIdentity_nonblank" CHECK ((btrim("eventIdentity") <> ''::text));
ALTER TABLE public."AffiliateCommissionLedgerEntry" DROP CONSTRAINT IF EXISTS "AffiliateCommissionLedgerEntry_providerName_nonblank";
ALTER TABLE public."AffiliateCommissionLedgerEntry" ADD CONSTRAINT "AffiliateCommissionLedgerEntry_providerName_nonblank" CHECK ((btrim("providerName") <> ''::text));
ALTER TABLE public."AffiliatePayout" DROP CONSTRAINT IF EXISTS "AffiliatePayout_compliance_amounts_nonnegative";
ALTER TABLE public."AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_compliance_amounts_nonnegative" CHECK (((("grossAmountCents" IS NULL) OR ("grossAmountCents" >= 0)) AND (("withholdingTaxCents" IS NULL) OR ("withholdingTaxCents" >= 0)) AND (("nhiSupplementaryTaxCents" IS NULL) OR ("nhiSupplementaryTaxCents" >= 0)) AND (("bankFeeCents" IS NULL) OR ("bankFeeCents" >= 0)) AND (("netPayoutAmountCents" IS NULL) OR ("netPayoutAmountCents" >= 0))));
ALTER TABLE public."AffiliatePayout" DROP CONSTRAINT IF EXISTS "AffiliatePayout_finalAmountCents_nonnegative";
ALTER TABLE public."AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_finalAmountCents_nonnegative" CHECK (("finalAmountCents" >= 0));
ALTER TABLE public."AffiliatePayout" DROP CONSTRAINT IF EXISTS "AffiliatePayout_outcomeReason_length";
ALTER TABLE public."AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_outcomeReason_length" CHECK ((("outcomeReason" IS NULL) OR ((btrim("outcomeReason") <> ''::text) AND ((char_length("outcomeReason") >= 1) AND (char_length("outcomeReason") <= 500)))));
ALTER TABLE public."BuyerSupportOrderGrant" DROP CONSTRAINT IF EXISTS "BuyerSupportOrderGrant_cookie_key_check";
ALTER TABLE public."BuyerSupportOrderGrant" ADD CONSTRAINT "BuyerSupportOrderGrant_cookie_key_check" CHECK (("cookieKey" ~ '^[a-f0-9]{32}$'::text));
ALTER TABLE public."BuyerSupportOrderGrant" DROP CONSTRAINT IF EXISTS "BuyerSupportOrderGrant_expiry_check";
ALTER TABLE public."BuyerSupportOrderGrant" ADD CONSTRAINT "BuyerSupportOrderGrant_expiry_check" CHECK (("expiresAt" > "createdAt"));
ALTER TABLE public."BuyerSupportOrderGrant" DROP CONSTRAINT IF EXISTS "BuyerSupportOrderGrant_revocation_check";
ALTER TABLE public."BuyerSupportOrderGrant" ADD CONSTRAINT "BuyerSupportOrderGrant_revocation_check" CHECK ((("revokedAt" IS NULL) OR ("revokedAt" >= "createdAt")));
ALTER TABLE public."BuyerSupportOrderGrant" DROP CONSTRAINT IF EXISTS "BuyerSupportOrderGrant_rotation_check";
ALTER TABLE public."BuyerSupportOrderGrant" ADD CONSTRAINT "BuyerSupportOrderGrant_rotation_check" CHECK (("rotationCount" >= 0));
ALTER TABLE public."BuyerSupportOrderGrant" DROP CONSTRAINT IF EXISTS "BuyerSupportOrderGrant_token_hash_check";
ALTER TABLE public."BuyerSupportOrderGrant" ADD CONSTRAINT "BuyerSupportOrderGrant_token_hash_check" CHECK (("tokenHash" ~ '^[a-f0-9]{64}$'::text));
ALTER TABLE public."CommerceEntitlement" DROP CONSTRAINT IF EXISTS "CommerceEntitlement_access_pair_check";
ALTER TABLE public."CommerceEntitlement" ADD CONSTRAINT "CommerceEntitlement_access_pair_check" CHECK ((("accessEncryptedEnvelope" IS NULL) = ("accessMaskedSummary" IS NULL)));
ALTER TABLE public."CommerceEntitlement" DROP CONSTRAINT IF EXISTS "CommerceEntitlement_granted_access_check";
ALTER TABLE public."CommerceEntitlement" ADD CONSTRAINT "CommerceEntitlement_granted_access_check" CHECK (((status <> 'granted'::public."CommerceEntitlementStatus") OR ("accessEncryptedEnvelope" IS NOT NULL)));
ALTER TABLE public."CommerceEntitlement" DROP CONSTRAINT IF EXISTS "CommerceEntitlement_lifecycle_check";
ALTER TABLE public."CommerceEntitlement" ADD CONSTRAINT "CommerceEntitlement_lifecycle_check" CHECK ((((status = 'pending'::public."CommerceEntitlementStatus") AND ("grantedAt" IS NULL) AND ("revokedAt" IS NULL)) OR ((status = 'granted'::public."CommerceEntitlementStatus") AND ("grantedAt" IS NOT NULL) AND ("revokedAt" IS NULL) AND ("accessEncryptedEnvelope" IS NOT NULL)) OR ((status = 'revoked'::public."CommerceEntitlementStatus") AND ("revokedAt" IS NOT NULL) AND ("accessEncryptedEnvelope" IS NULL) AND ("accessMaskedSummary" IS NULL))));
ALTER TABLE public."CommerceEntitlement" DROP CONSTRAINT IF EXISTS "CommerceEntitlement_revision_check";
ALTER TABLE public."CommerceEntitlement" ADD CONSTRAINT "CommerceEntitlement_revision_check" CHECK ((revision > 0));
ALTER TABLE public."CommerceOrder" DROP CONSTRAINT IF EXISTS "CommerceOrder_amounts_check";
ALTER TABLE public."CommerceOrder" ADD CONSTRAINT "CommerceOrder_amounts_check" CHECK ((("subtotalAmountCents" >= 0) AND ("totalAmountCents" >= 0) AND ("paidAmountCents" >= 0) AND ("refundedAmountCents" >= 0) AND ("paidAmountCents" <= "totalAmountCents") AND ("refundedAmountCents" <= "paidAmountCents")));
ALTER TABLE public."CommerceOrder" DROP CONSTRAINT IF EXISTS "CommerceOrder_buyer_envelope_check";
ALTER TABLE public."CommerceOrder" ADD CONSTRAINT "CommerceOrder_buyer_envelope_check" CHECK ((length("buyerEncryptedEnvelope") > 0));
ALTER TABLE public."CommerceOrder" DROP CONSTRAINT IF EXISTS "CommerceOrder_buyer_masks_check";
ALTER TABLE public."CommerceOrder" ADD CONSTRAINT "CommerceOrder_buyer_masks_check" CHECK (((length("buyerMaskedName") > 0) AND (length("buyerMaskedEmail") > 0)));
ALTER TABLE public."CommerceOrder" DROP CONSTRAINT IF EXISTS "CommerceOrder_currency_check";
ALTER TABLE public."CommerceOrder" ADD CONSTRAINT "CommerceOrder_currency_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));
ALTER TABLE public."CommerceOrder" DROP CONSTRAINT IF EXISTS "CommerceOrder_identity_hash_check";
ALTER TABLE public."CommerceOrder" ADD CONSTRAINT "CommerceOrder_identity_hash_check" CHECK (("checkoutIdentityHash" ~ '^[A-Za-z0-9_-]{43}$'::text));
ALTER TABLE public."CommerceOrder" DROP CONSTRAINT IF EXISTS "CommerceOrder_shipping_pair_check";
ALTER TABLE public."CommerceOrder" ADD CONSTRAINT "CommerceOrder_shipping_pair_check" CHECK (((("shippingEncryptedEnvelope" IS NULL) AND ("shippingMaskedSummary" IS NULL)) OR (("shippingEncryptedEnvelope" IS NOT NULL) AND ("shippingMaskedSummary" IS NOT NULL) AND (length("shippingEncryptedEnvelope") > 0) AND (length("shippingMaskedSummary") > 0))));
ALTER TABLE public."CommerceOrderItem" DROP CONSTRAINT IF EXISTS "CommerceOrderItem_amounts_check";
ALTER TABLE public."CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_amounts_check" CHECK ((("unitPriceCents" >= 0) AND (quantity > 0) AND ("lineTotalCents" >= 0) AND (("lineTotalCents")::bigint = (("unitPriceCents")::bigint * (quantity)::bigint))));
ALTER TABLE public."CommerceOrderRefund" DROP CONSTRAINT IF EXISTS "CommerceOrderRefund_amounts_check";
ALTER TABLE public."CommerceOrderRefund" ADD CONSTRAINT "CommerceOrderRefund_amounts_check" CHECK ((("amountCents" > 0) AND ("cumulativeAmountCents" >= "amountCents")));
ALTER TABLE public."CommissionProductOverride" DROP CONSTRAINT IF EXISTS "CommissionProductOverride_rateBps_check";
ALTER TABLE public."CommissionProductOverride" ADD CONSTRAINT "CommissionProductOverride_rateBps_check" CHECK ((("rateBps" >= 0) AND ("rateBps" <= 10000)));
ALTER TABLE public."CommissionQuantityTier" DROP CONSTRAINT IF EXISTS "CommissionQuantityTier_values_check";
ALTER TABLE public."CommissionQuantityTier" ADD CONSTRAINT "CommissionQuantityTier_values_check" CHECK ((("minQuantity" >= 1) AND (("maxQuantity" IS NULL) OR ("maxQuantity" >= "minQuantity")) AND (("rateBps" >= 0) AND ("rateBps" <= 10000))));
ALTER TABLE public."CommissionRateTier" DROP CONSTRAINT IF EXISTS "CommissionRateTier_values_check";
ALTER TABLE public."CommissionRateTier" ADD CONSTRAINT "CommissionRateTier_values_check" CHECK ((("minMonthlySalesCents" >= 0) AND (("rateBps" >= 0) AND ("rateBps" <= 10000))));
ALTER TABLE public."CommissionRuleSet" DROP CONSTRAINT IF EXISTS "CommissionRuleSet_currency_check";
ALTER TABLE public."CommissionRuleSet" ADD CONSTRAINT "CommissionRuleSet_currency_check" CHECK ((currency ~ '^[A-Z]{3}$'::text));
ALTER TABLE public."CommissionRuleSet" DROP CONSTRAINT IF EXISTS "CommissionRuleSet_maxTotalRateBps_check";
ALTER TABLE public."CommissionRuleSet" ADD CONSTRAINT "CommissionRuleSet_maxTotalRateBps_check" CHECK ((("maxTotalRateBps" >= 1) AND ("maxTotalRateBps" <= 10000)));
ALTER TABLE public."CommissionUplineLevel" DROP CONSTRAINT IF EXISTS "CommissionUplineLevel_values_check";
ALTER TABLE public."CommissionUplineLevel" ADD CONSTRAINT "CommissionUplineLevel_values_check" CHECK ((((level >= 1) AND (level <= 8)) AND (("bonusRateBps" >= 1) AND ("bonusRateBps" <= 10000))));
ALTER TABLE public."CourseCommissionAllocation" DROP CONSTRAINT IF EXISTS "CourseCommissionAllocation_amounts_valid";
ALTER TABLE public."CourseCommissionAllocation" ADD CONSTRAINT "CourseCommissionAllocation_amounts_valid" CHECK ((("grossAmountCents" > 0) AND (("shareBps" >= 1) AND ("shareBps" <= 10000)) AND ("amountCents" > 0) AND ("amountCents" <= "grossAmountCents")));
ALTER TABLE public."CourseCommissionAllocation" DROP CONSTRAINT IF EXISTS "CourseCommissionAllocation_policyVersion_positive";
ALTER TABLE public."CourseCommissionAllocation" ADD CONSTRAINT "CourseCommissionAllocation_policyVersion_positive" CHECK (("policyVersion" > 0));
ALTER TABLE public."CourseCommissionAllocation" DROP CONSTRAINT IF EXISTS "CourseCommissionAllocation_recipientRole_valid";
ALTER TABLE public."CourseCommissionAllocation" ADD CONSTRAINT "CourseCommissionAllocation_recipientRole_valid" CHECK (("recipientRole" = ANY (ARRAY['content_owner'::text, 'promoter'::text])));
ALTER TABLE public."CourseCommissionLedgerEntry" DROP CONSTRAINT IF EXISTS "CourseCommissionLedgerEntry_amount_direction_valid";
ALTER TABLE public."CourseCommissionLedgerEntry" ADD CONSTRAINT "CourseCommissionLedgerEntry_amount_direction_valid" CHECK ((("entryType" = 'opening_balance'::public."CourseCommissionLedgerEntryType") OR (("entryType" = 'accrual'::public."CourseCommissionLedgerEntryType") AND ("amountCents" > 0)) OR (("entryType" = ANY (ARRAY['refund'::public."CourseCommissionLedgerEntryType", 'reversal'::public."CourseCommissionLedgerEntryType", 'dispute_lost'::public."CourseCommissionLedgerEntryType"])) AND ("amountCents" < 0)) OR (("entryType" = ANY (ARRAY['dispute_opened'::public."CourseCommissionLedgerEntryType", 'dispute_released'::public."CourseCommissionLedgerEntryType"])) AND ("amountCents" = 0))));
ALTER TABLE public."Live" DROP CONSTRAINT IF EXISTS "Live_lifecycle_check";
ALTER TABLE public."Live" ADD CONSTRAINT "Live_lifecycle_check" CHECK ((("endedAt" IS NULL) OR ("startedAt" IS NULL) OR ("endedAt" >= "startedAt")));
ALTER TABLE public."Live" DROP CONSTRAINT IF EXISTS "Live_liveReminderOffsetMinutes_check";
ALTER TABLE public."Live" ADD CONSTRAINT "Live_liveReminderOffsetMinutes_check" CHECK (("liveReminderOffsetMinutes" = ANY (ARRAY[15, 30, 60, 180, 1440])));
ALTER TABLE public."Live" DROP CONSTRAINT IF EXISTS "Live_replay_lifecycle_check";
ALTER TABLE public."Live" ADD CONSTRAINT "Live_replay_lifecycle_check" CHECK ((("replayAvailableUntil" IS NULL) OR ("endedAt" IS NULL) OR ("replayAvailableUntil" >= "endedAt")));
ALTER TABLE public."Live" DROP CONSTRAINT IF EXISTS "Live_team_owner_pair_check";
ALTER TABLE public."Live" ADD CONSTRAINT "Live_team_owner_pair_check" CHECK ((("teamId" IS NOT NULL) OR ("seminarOwnerMembershipId" IS NULL)));
ALTER TABLE public."LiveChatMessage" DROP CONSTRAINT IF EXISTS "LiveChatMessage_body_check";
ALTER TABLE public."LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_body_check" CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 1000)));
ALTER TABLE public."LiveChatMessage" DROP CONSTRAINT IF EXISTS "LiveChatMessage_identity_check";
ALTER TABLE public."LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_identity_check" CHECK ((((source = 'viewer'::text) AND ("formSubmissionId" IS NOT NULL) AND ("roleId" IS NULL)) OR ((source = ANY (ARRAY['scheduled'::text, 'staff'::text])) AND ("roleId" IS NOT NULL))));
ALTER TABLE public."LiveChatMessage" DROP CONSTRAINT IF EXISTS "LiveChatMessage_source_check";
ALTER TABLE public."LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_source_check" CHECK ((source = ANY (ARRAY['viewer'::text, 'scheduled'::text, 'staff'::text])));
ALTER TABLE public."LiveChatMessage" DROP CONSTRAINT IF EXISTS "LiveChatMessage_status_check";
ALTER TABLE public."LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_status_check" CHECK ((status = ANY (ARRAY['visible'::text, 'hidden'::text])));
ALTER TABLE public."LiveNotificationRule" DROP CONSTRAINT IF EXISTS "LiveNotificationRule_offsetMinutes_check";
ALTER TABLE public."LiveNotificationRule" ADD CONSTRAINT "LiveNotificationRule_offsetMinutes_check" CHECK ((("offsetMinutes" >= 0) AND ("offsetMinutes" <= 10080)));
ALTER TABLE public."LiveNotificationRule" DROP CONSTRAINT IF EXISTS "LiveNotificationRule_sortOrder_check";
ALTER TABLE public."LiveNotificationRule" ADD CONSTRAINT "LiveNotificationRule_sortOrder_check" CHECK ((("sortOrder" >= 0) AND ("sortOrder" <= 7)));
ALTER TABLE public."LiveNotificationRule" DROP CONSTRAINT IF EXISTS "LiveNotificationRule_trigger_check";
ALTER TABLE public."LiveNotificationRule" ADD CONSTRAINT "LiveNotificationRule_trigger_check" CHECK ((trigger = ANY (ARRAY['before_live'::text, 'during_live'::text, 'post_live_followup'::text])));
ALTER TABLE public."LiveProduct" DROP CONSTRAINT IF EXISTS "LiveProduct_offerPriceCents_check";
ALTER TABLE public."LiveProduct" ADD CONSTRAINT "LiveProduct_offerPriceCents_check" CHECK ((("offerPriceCents" IS NULL) OR ("offerPriceCents" >= 0)));
ALTER TABLE public."LiveReminderReconciliationJob" DROP CONSTRAINT IF EXISTS "LiveReminderReconciliationJob_attemptCount_check";
ALTER TABLE public."LiveReminderReconciliationJob" ADD CONSTRAINT "LiveReminderReconciliationJob_attemptCount_check" CHECK ((("attemptCount" >= 0) AND ("maxAttempts" > 0) AND ("attemptCount" <= "maxAttempts")));
ALTER TABLE public."LiveReminderReconciliationJob" DROP CONSTRAINT IF EXISTS "LiveReminderReconciliationJob_cursor_check";
ALTER TABLE public."LiveReminderReconciliationJob" ADD CONSTRAINT "LiveReminderReconciliationJob_cursor_check" CHECK ((("cursorCreatedAt" IS NULL) = ("cursorId" IS NULL)));
ALTER TABLE public."LiveReminderReconciliationJob" DROP CONSTRAINT IF EXISTS "LiveReminderReconciliationJob_lifecycle_check";
ALTER TABLE public."LiveReminderReconciliationJob" ADD CONSTRAINT "LiveReminderReconciliationJob_lifecycle_check" CHECK ((lifecycle = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'superseded'::text, 'failed'::text])));
ALTER TABLE public."LiveReminderReconciliationJob" DROP CONSTRAINT IF EXISTS "LiveReminderReconciliationJob_reminderOffsetMinutes_check";
ALTER TABLE public."LiveReminderReconciliationJob" ADD CONSTRAINT "LiveReminderReconciliationJob_reminderOffsetMinutes_check" CHECK (("reminderOffsetMinutes" = ANY (ARRAY[15, 30, 60, 180, 1440])));
ALTER TABLE public."PartnerFunnelPageShareSetting" DROP CONSTRAINT IF EXISTS "PartnerFunnelPageShareSetting_token_check";
ALTER TABLE public."PartnerFunnelPageShareSetting" ADD CONSTRAINT "PartnerFunnelPageShareSetting_token_check" CHECK ((("accessMode" <> 'TOKEN_REQUIRED'::public."TeamPageAccessMode") OR ("tokenHash" IS NOT NULL)));
ALTER TABLE public."PartnerFunnelPageShareSetting" DROP CONSTRAINT IF EXISTS "PartnerFunnelPageShareSetting_usage_check";
ALTER TABLE public."PartnerFunnelPageShareSetting" ADD CONSTRAINT "PartnerFunnelPageShareSetting_usage_check" CHECK ((("useCount" >= 0) AND (("maxUses" IS NULL) OR (("maxUses" >= 0) AND ("useCount" <= "maxUses")))));
ALTER TABLE public."PartnerProductSlotOverride" DROP CONSTRAINT IF EXISTS "PartnerProductSlotOverride_target_check";
ALTER TABLE public."PartnerProductSlotOverride" ADD CONSTRAINT "PartnerProductSlotOverride_target_check" CHECK ((("productId" IS NOT NULL) OR ("overrideUrl" IS NOT NULL)));
ALTER TABLE public."Product" DROP CONSTRAINT IF EXISTS "Product_commerceDomain_valid";
ALTER TABLE public."Product" ADD CONSTRAINT "Product_commerceDomain_valid" CHECK (("commerceDomain" = ANY (ARRAY['merchant'::text, 'course'::text])));
ALTER TABLE public."Product" DROP CONSTRAINT IF EXISTS "Product_coursePolicyVersion_positive";
ALTER TABLE public."Product" ADD CONSTRAINT "Product_coursePolicyVersion_positive" CHECK (("coursePolicyVersion" > 0));
ALTER TABLE public."Product" DROP CONSTRAINT IF EXISTS "Product_coursePromoterShareBps_valid";
ALTER TABLE public."Product" ADD CONSTRAINT "Product_coursePromoterShareBps_valid" CHECK ((("coursePromoterShareBps" IS NULL) OR (("coursePromoterShareBps" >= 1) AND ("coursePromoterShareBps" <= 9999))));
ALTER TABLE public."Product" DROP CONSTRAINT IF EXISTS "Product_revision_check";
ALTER TABLE public."Product" ADD CONSTRAINT "Product_revision_check" CHECK ((revision > 0));
ALTER TABLE public."RegistrationForm" DROP CONSTRAINT IF EXISTS "RegistrationForm_countdownMinutes_check";
ALTER TABLE public."RegistrationForm" ADD CONSTRAINT "RegistrationForm_countdownMinutes_check" CHECK ((("countdownMinutes" IS NULL) OR (("countdownMinutes" >= 0) AND ("countdownMinutes" <= 10080))));
ALTER TABLE public."RegistrationForm" DROP CONSTRAINT IF EXISTS "RegistrationForm_maxVisibleSessions_check";
ALTER TABLE public."RegistrationForm" ADD CONSTRAINT "RegistrationForm_maxVisibleSessions_check" CHECK ((("maxVisibleSessions" >= 0) AND ("maxVisibleSessions" <= 99)));
ALTER TABLE public."ServiceFulfillment" DROP CONSTRAINT IF EXISTS "ServiceFulfillment_revision_check";
ALTER TABLE public."ServiceFulfillment" ADD CONSTRAINT "ServiceFulfillment_revision_check" CHECK ((revision > 0));
ALTER TABLE public."ServiceFulfillment" DROP CONSTRAINT IF EXISTS "ServiceFulfillment_timestamps_check";
ALTER TABLE public."ServiceFulfillment" ADD CONSTRAINT "ServiceFulfillment_timestamps_check" CHECK ((((status <> ALL (ARRAY['scheduled'::public."ServiceFulfillmentStatus", 'completed'::public."ServiceFulfillmentStatus"])) OR ("scheduledAt" IS NOT NULL)) AND ((status <> 'completed'::public."ServiceFulfillmentStatus") OR ("completedAt" IS NOT NULL)) AND ((status <> 'cancelled'::public."ServiceFulfillmentStatus") OR ("cancelledAt" IS NOT NULL))));
ALTER TABLE public."ShippingFulfillment" DROP CONSTRAINT IF EXISTS "ShippingFulfillment_revision_check";
ALTER TABLE public."ShippingFulfillment" ADD CONSTRAINT "ShippingFulfillment_revision_check" CHECK ((revision > 0));
ALTER TABLE public."ShippingFulfillment" DROP CONSTRAINT IF EXISTS "ShippingFulfillment_timestamps_check";
ALTER TABLE public."ShippingFulfillment" ADD CONSTRAINT "ShippingFulfillment_timestamps_check" CHECK ((((status <> ALL (ARRAY['shipped'::public."ShippingFulfillmentStatus", 'refund_review'::public."ShippingFulfillmentStatus", 'delivered'::public."ShippingFulfillmentStatus", 'returned'::public."ShippingFulfillmentStatus"])) OR ("shippedAt" IS NOT NULL)) AND ((status <> 'refund_review'::public."ShippingFulfillmentStatus") OR ("refundReviewAt" IS NOT NULL)) AND ((status <> 'delivered'::public."ShippingFulfillmentStatus") OR ("deliveredAt" IS NOT NULL)) AND ((status <> 'returned'::public."ShippingFulfillmentStatus") OR ("returnedAt" IS NOT NULL)) AND ((status <> 'cancelled'::public."ShippingFulfillmentStatus") OR ("cancelledAt" IS NOT NULL))));
ALTER TABLE public."StreamOperationsAlert" DROP CONSTRAINT IF EXISTS "StreamOperationsAlert_dedup_check";
ALTER TABLE public."StreamOperationsAlert" ADD CONSTRAINT "StreamOperationsAlert_dedup_check" CHECK (((length(btrim("dedupKey")) >= 1) AND (length(btrim("dedupKey")) <= 200)));
ALTER TABLE public."StreamOperationsAlert" DROP CONSTRAINT IF EXISTS "StreamOperationsAlert_lifecycle_check";
ALTER TABLE public."StreamOperationsAlert" ADD CONSTRAINT "StreamOperationsAlert_lifecycle_check" CHECK ((((status = 'OPEN'::public."StreamOperationsAlertStatus") AND ("acknowledgedByActorId" IS NULL) AND ("acknowledgedByActorLabel" IS NULL) AND ("acknowledgedAt" IS NULL) AND ("resolvedByActorId" IS NULL) AND ("resolvedByActorLabel" IS NULL) AND ("resolvedAt" IS NULL)) OR ((status = 'ACKNOWLEDGED'::public."StreamOperationsAlertStatus") AND (length(btrim("acknowledgedByActorId")) > 0) AND (length(btrim("acknowledgedByActorLabel")) > 0) AND ("acknowledgedAt" IS NOT NULL) AND ("resolvedByActorId" IS NULL) AND ("resolvedByActorLabel" IS NULL) AND ("resolvedAt" IS NULL)) OR ((status = 'RESOLVED'::public."StreamOperationsAlertStatus") AND (length(btrim("resolvedByActorId")) > 0) AND (length(btrim("resolvedByActorLabel")) > 0) AND ("resolvedAt" IS NOT NULL))));
ALTER TABLE public."StreamOperationsAlert" DROP CONSTRAINT IF EXISTS "StreamOperationsAlert_message_check";
ALTER TABLE public."StreamOperationsAlert" ADD CONSTRAINT "StreamOperationsAlert_message_check" CHECK (((length(btrim(message)) >= 1) AND (length(btrim(message)) <= 1000)));
ALTER TABLE public."StreamOperationsAlert" DROP CONSTRAINT IF EXISTS "StreamOperationsAlert_metadata_check";
ALTER TABLE public."StreamOperationsAlert" ADD CONSTRAINT "StreamOperationsAlert_metadata_check" CHECK (((metadata IS NULL) OR (jsonb_typeof(metadata) = 'object'::text)));
ALTER TABLE public."StreamOperationsAlert" DROP CONSTRAINT IF EXISTS "StreamOperationsAlert_month_check";
ALTER TABLE public."StreamOperationsAlert" ADD CONSTRAINT "StreamOperationsAlert_month_check" CHECK (("monthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text));
ALTER TABLE public."StreamOperationsAlert" DROP CONSTRAINT IF EXISTS "StreamOperationsAlert_provider_check";
ALTER TABLE public."StreamOperationsAlert" ADD CONSTRAINT "StreamOperationsAlert_provider_check" CHECK (((provider IS NULL) OR (provider ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'::text)));
ALTER TABLE public."StreamUsageReconciliation" DROP CONSTRAINT IF EXISTS "StreamUsageReconciliation_digest_check";
ALTER TABLE public."StreamUsageReconciliation" ADD CONSTRAINT "StreamUsageReconciliation_digest_check" CHECK (("sourceDigest" ~ '^[a-f0-9]{64}$'::text));
ALTER TABLE public."StreamUsageReconciliation" DROP CONSTRAINT IF EXISTS "StreamUsageReconciliation_lifecycle_check";
ALTER TABLE public."StreamUsageReconciliation" ADD CONSTRAINT "StreamUsageReconciliation_lifecycle_check" CHECK ((((status = ANY (ARRAY['MATCHED'::public."StreamUsageReconciliationStatus", 'MISMATCH'::public."StreamUsageReconciliationStatus"])) AND (resolution IS NULL) AND ("resolutionNote" IS NULL) AND ("resolvedByActorId" IS NULL) AND ("resolvedByActorLabel" IS NULL) AND ("resolvedAt" IS NULL)) OR ((status = 'RESOLVED'::public."StreamUsageReconciliationStatus") AND (resolution IS NOT NULL) AND ((length(btrim("resolutionNote")) >= 10) AND (length(btrim("resolutionNote")) <= 500)) AND (length(btrim("resolvedByActorId")) > 0) AND (length(btrim("resolvedByActorLabel")) > 0) AND ("resolvedAt" IS NOT NULL))));
ALTER TABLE public."StreamUsageReconciliation" DROP CONSTRAINT IF EXISTS "StreamUsageReconciliation_month_check";
ALTER TABLE public."StreamUsageReconciliation" ADD CONSTRAINT "StreamUsageReconciliation_month_check" CHECK (("monthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text));
ALTER TABLE public."StreamUsageReconciliation" DROP CONSTRAINT IF EXISTS "StreamUsageReconciliation_provider_check";
ALTER TABLE public."StreamUsageReconciliation" ADD CONSTRAINT "StreamUsageReconciliation_provider_check" CHECK ((provider ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'::text));
ALTER TABLE public."StreamUsageReconciliation" DROP CONSTRAINT IF EXISTS "StreamUsageReconciliation_source_reference_check";
ALTER TABLE public."StreamUsageReconciliation" ADD CONSTRAINT "StreamUsageReconciliation_source_reference_check" CHECK ((("sourceReference" IS NULL) OR (((length(btrim("sourceReference")) >= 1) AND (length(btrim("sourceReference")) <= 120)) AND ("sourceReference" ~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,119}$'::text))));
ALTER TABLE public."StreamUsageReconciliation" DROP CONSTRAINT IF EXISTS "StreamUsageReconciliation_totals_check";
ALTER TABLE public."StreamUsageReconciliation" ADD CONSTRAINT "StreamUsageReconciliation_totals_check" CHECK ((("providerWatchMinutes" >= 0) AND (("providerStorageMinutes" IS NULL) OR ("providerStorageMinutes" >= 0)) AND ("internalWatchSeconds" >= 0) AND ("internalWatchMinutes" >= 0)));
ALTER TABLE public."SupportCase" DROP CONSTRAINT IF EXISTS "SupportCase_creator_check";
ALTER TABLE public."SupportCase" ADD CONSTRAINT "SupportCase_creator_check" CHECK (((("createdByMemberId" IS NOT NULL) AND ("createdByBuyerGrantId" IS NULL)) OR (("createdByMemberId" IS NULL) AND ("createdByBuyerGrantId" IS NOT NULL))));
ALTER TABLE public."SupportCase" DROP CONSTRAINT IF EXISTS "SupportCase_intake_key_check";
ALTER TABLE public."SupportCase" ADD CONSTRAINT "SupportCase_intake_key_check" CHECK (("intakeKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::text));
ALTER TABLE public."SupportCase" DROP CONSTRAINT IF EXISTS "SupportCase_lifecycle_check";
ALTER TABLE public."SupportCase" ADD CONSTRAINT "SupportCase_lifecycle_check" CHECK ((((status = ANY (ARRAY['open'::public."SupportCaseStatus", 'in_progress'::public."SupportCaseStatus", 'waiting_customer'::public."SupportCaseStatus", 'waiting_finance'::public."SupportCaseStatus"])) AND ("resolvedAt" IS NULL) AND ("closedAt" IS NULL)) OR ((status = 'resolved'::public."SupportCaseStatus") AND ("resolvedAt" IS NOT NULL) AND ("closedAt" IS NULL)) OR ((status = 'closed'::public."SupportCaseStatus") AND ("resolvedAt" IS NOT NULL) AND ("closedAt" IS NOT NULL))));
ALTER TABLE public."SupportCase" DROP CONSTRAINT IF EXISTS "SupportCase_number_check";
ALTER TABLE public."SupportCase" ADD CONSTRAINT "SupportCase_number_check" CHECK (("caseNumber" ~ '^SC-[0-9]{8}-[A-F0-9]{8}$'::text));
ALTER TABLE public."SupportCase" DROP CONSTRAINT IF EXISTS "SupportCase_response_due_check";
ALTER TABLE public."SupportCase" ADD CONSTRAINT "SupportCase_response_due_check" CHECK (("responseDueAt" > "createdAt"));
ALTER TABLE public."SupportCase" DROP CONSTRAINT IF EXISTS "SupportCase_revision_check";
ALTER TABLE public."SupportCase" ADD CONSTRAINT "SupportCase_revision_check" CHECK ((revision > 0));
ALTER TABLE public."SupportCaseEvent" DROP CONSTRAINT IF EXISTS "SupportCaseEvent_actor_check";
ALTER TABLE public."SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_actor_check" CHECK (((((("actorMemberId" IS NOT NULL))::integer + (("actorUserId" IS NOT NULL))::integer) + (("actorBuyerGrantId" IS NOT NULL))::integer) = 1));
ALTER TABLE public."SupportCaseEvent" DROP CONSTRAINT IF EXISTS "SupportCaseEvent_buyer_audience_check";
ALTER TABLE public."SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_buyer_audience_check" CHECK ((("actorBuyerGrantId" IS NULL) OR (audience = 'buyer'::public."SupportCaseEventAudience")));
ALTER TABLE public."SupportCaseEvent" DROP CONSTRAINT IF EXISTS "SupportCaseEvent_buyer_order_check";
ALTER TABLE public."SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_buyer_order_check" CHECK (((("actorBuyerGrantId" IS NULL) AND ("actorBuyerOrderId" IS NULL)) OR (("actorBuyerGrantId" IS NOT NULL) AND ("actorBuyerOrderId" IS NOT NULL))));
ALTER TABLE public."SupportCaseEvent" DROP CONSTRAINT IF EXISTS "SupportCaseEvent_dedup_check";
ALTER TABLE public."SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_dedup_check" CHECK (((length(btrim("dedupKey")) >= 1) AND (length(btrim("dedupKey")) <= 160)));
ALTER TABLE public."SupportCaseEvent" DROP CONSTRAINT IF EXISTS "SupportCaseEvent_payload_check";
ALTER TABLE public."SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_payload_check" CHECK ((("payloadEncryptedEnvelope" IS NULL) OR (length("payloadEncryptedEnvelope") > 0)));
ALTER TABLE public."SupportRefundHandoff" DROP CONSTRAINT IF EXISTS "SupportRefundHandoff_amount_check";
ALTER TABLE public."SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_amount_check" CHECK (("requestedAmountCents" > 0));
ALTER TABLE public."SupportRefundHandoff" DROP CONSTRAINT IF EXISTS "SupportRefundHandoff_lifecycle_check";
ALTER TABLE public."SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_lifecycle_check" CHECK ((((status = 'requested'::public."SupportRefundHandoffStatus") AND ("reviewedByActorId" IS NULL) AND ("reviewedAt" IS NULL) AND ("completedRefundId" IS NULL) AND ("completedAt" IS NULL)) OR ((status = ANY (ARRAY['reviewing'::public."SupportRefundHandoffStatus", 'declined'::public."SupportRefundHandoffStatus"])) AND ("reviewedByActorId" IS NOT NULL) AND ("reviewedAt" IS NOT NULL) AND ("completedRefundId" IS NULL) AND ("completedAt" IS NULL)) OR ((status = 'completed'::public."SupportRefundHandoffStatus") AND ("reviewedByActorId" IS NOT NULL) AND ("reviewedAt" IS NOT NULL) AND ("completedRefundId" IS NOT NULL) AND ("completedAt" IS NOT NULL))));
ALTER TABLE public."SupportRefundHandoff" DROP CONSTRAINT IF EXISTS "SupportRefundHandoff_reason_check";
ALTER TABLE public."SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_reason_check" CHECK ((length("reasonEncryptedEnvelope") > 0));
ALTER TABLE public."SupportRefundHandoff" DROP CONSTRAINT IF EXISTS "SupportRefundHandoff_revision_check";
ALTER TABLE public."SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_revision_check" CHECK ((revision > 0));
ALTER TABLE public."SupportRefundHandoffRefund" DROP CONSTRAINT IF EXISTS "SupportRefundHandoffRefund_amount_check";
ALTER TABLE public."SupportRefundHandoffRefund" ADD CONSTRAINT "SupportRefundHandoffRefund_amount_check" CHECK (("amountCentsSnapshot" > 0));
ALTER TABLE public."TeamFunnelTemplateVersion" DROP CONSTRAINT IF EXISTS "TeamFunnelTemplateVersion_version_check";
ALTER TABLE public."TeamFunnelTemplateVersion" ADD CONSTRAINT "TeamFunnelTemplateVersion_version_check" CHECK ((version > 0));
ALTER TABLE public."TeamMembership" DROP CONSTRAINT IF EXISTS "TeamMembership_lifecycle_check";
ALTER TABLE public."TeamMembership" ADD CONSTRAINT "TeamMembership_lifecycle_check" CHECK ((("leftAt" IS NULL) OR ("leftAt" >= "joinedAt")));
ALTER TABLE public."TeamMembershipRelationship" DROP CONSTRAINT IF EXISTS "TeamMembershipRelationship_distinct_members_check";
ALTER TABLE public."TeamMembershipRelationship" ADD CONSTRAINT "TeamMembershipRelationship_distinct_members_check" CHECK (("uplineMembershipId" <> "downlineMembershipId"));
ALTER TABLE public."TeamMembershipRelationship" DROP CONSTRAINT IF EXISTS "TeamMembershipRelationship_period_check";
ALTER TABLE public."TeamMembershipRelationship" ADD CONSTRAINT "TeamMembershipRelationship_period_check" CHECK ((("endedAt" IS NULL) OR ("endedAt" > "effectiveAt")));

CREATE OR REPLACE TRIGGER "AffiliateCommissionLedgerEntry_reject_delete" BEFORE DELETE ON public."AffiliateCommissionLedgerEntry" FOR EACH ROW EXECUTE FUNCTION public."AffiliateCommissionLedgerEntry_reject_mutation"();
CREATE OR REPLACE TRIGGER "AffiliateCommissionLedgerEntry_reject_update" BEFORE UPDATE ON public."AffiliateCommissionLedgerEntry" FOR EACH ROW EXECUTE FUNCTION public."AffiliateCommissionLedgerEntry_reject_mutation"();
CREATE OR REPLACE TRIGGER "AffiliateCommission_rule_snapshot_immutable_trigger" BEFORE UPDATE ON public."AffiliateCommission" FOR EACH ROW EXECUTE FUNCTION public.enforce_affiliate_commission_rule_snapshot_immutable();
CREATE OR REPLACE TRIGGER "CommerceEntitlement_item_type_trigger" BEFORE INSERT OR UPDATE ON public."CommerceEntitlement" FOR EACH ROW EXECUTE FUNCTION public.enforce_entitlement_fulfillment_type();
CREATE OR REPLACE TRIGGER "CommerceOrderRefund_order_limit_trigger" BEFORE INSERT OR UPDATE ON public."CommerceOrderRefund" FOR EACH ROW EXECUTE FUNCTION public.enforce_commerce_order_refund_limit();
CREATE OR REPLACE TRIGGER "CommerceOrderRefund_support_link_immutable_trigger" BEFORE UPDATE OF "vendorId", "orderId", id, "paymentTransactionId", "amountCents", status ON public."CommerceOrderRefund" FOR EACH ROW EXECUTE FUNCTION public.enforce_linked_commerce_order_refund_immutable();
CREATE OR REPLACE TRIGGER "CommissionProductOverride_immutable_trigger" BEFORE UPDATE ON public."CommissionProductOverride" FOR EACH ROW EXECUTE FUNCTION public.reject_commission_product_override_update();
CREATE OR REPLACE TRIGGER "CommissionQuantityTier_immutable_trigger" BEFORE UPDATE ON public."CommissionQuantityTier" FOR EACH ROW EXECUTE FUNCTION public.reject_commission_rule_detail_update();
CREATE OR REPLACE TRIGGER "CommissionRateTier_immutable_trigger" BEFORE UPDATE ON public."CommissionRateTier" FOR EACH ROW EXECUTE FUNCTION public.reject_commission_rule_detail_update();
CREATE OR REPLACE TRIGGER "CommissionRuleSet_identity_immutable_trigger" BEFORE UPDATE ON public."CommissionRuleSet" FOR EACH ROW EXECUTE FUNCTION public.enforce_commission_rule_identity_immutable();
CREATE OR REPLACE TRIGGER "CommissionUplineLevel_immutable_trigger" BEFORE UPDATE ON public."CommissionUplineLevel" FOR EACH ROW EXECUTE FUNCTION public.reject_commission_rule_detail_update();
CREATE OR REPLACE TRIGGER "ServiceFulfillment_item_type_trigger" BEFORE INSERT OR UPDATE ON public."ServiceFulfillment" FOR EACH ROW EXECUTE FUNCTION public.enforce_service_fulfillment_type();
CREATE OR REPLACE TRIGGER "ShippingFulfillment_item_type_trigger" BEFORE INSERT OR UPDATE ON public."ShippingFulfillment" FOR EACH ROW EXECUTE FUNCTION public.enforce_shipping_fulfillment_type();
CREATE OR REPLACE TRIGGER "StreamUsageReconciliation_immutable_trigger" BEFORE UPDATE ON public."StreamUsageReconciliation" FOR EACH ROW EXECUTE FUNCTION public.enforce_stream_usage_reconciliation_immutable();
CREATE OR REPLACE TRIGGER "SupportRefundHandoffRefund_reference_trigger" BEFORE INSERT OR DELETE OR UPDATE ON public."SupportRefundHandoffRefund" FOR EACH ROW EXECUTE FUNCTION public.enforce_support_refund_handoff_refund();
CREATE OR REPLACE TRIGGER "SupportRefundHandoff_order_trigger" BEFORE INSERT OR UPDATE ON public."SupportRefundHandoff" FOR EACH ROW EXECUTE FUNCTION public.enforce_support_refund_handoff_order();

DROP INDEX IF EXISTS public."TeamMembershipRelationship_one_active_upline";
CREATE UNIQUE INDEX "TeamMembershipRelationship_one_active_upline" ON public."TeamMembershipRelationship" USING btree ("downlineMembershipId") WHERE ("endedAt" IS NULL);
DROP INDEX IF EXISTS public."CommissionRuleSet_one_active_currency_key";
CREATE UNIQUE INDEX "CommissionRuleSet_one_active_currency_key" ON public."CommissionRuleSet" USING btree ("vendorId", currency) WHERE (status = 'ACTIVE'::public."CommissionRuleStatus");
DROP INDEX IF EXISTS public."LiveQuestion_one_spotlight_per_live_key";
CREATE UNIQUE INDEX "LiveQuestion_one_spotlight_per_live_key" ON public."LiveQuestion" USING btree ("liveId") WHERE (status = 'spotlight'::public."LiveQuestionStatus");
DROP INDEX IF EXISTS public."ConsultationBooking_active_slot_key";
CREATE UNIQUE INDEX "ConsultationBooking_active_slot_key" ON public."ConsultationBooking" USING btree ("vendorId", "eventId", "startTime") WHERE (status = 'scheduled'::public."ConsultationBookingStatus");

-- Every original row and field must remain byte-equivalent (including status).
DO $$ DECLARE t record; hash text; n bigint; BEGIN
 FOR t IN SELECT * FROM audit_original_rows LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(md5(row_to_json(r)::text), %L ORDER BY md5(row_to_json(r)::text)), %L)), count(*) FROM (SELECT %s FROM public.%I) r', '', '', t.columns_sql,t.table_name) INTO hash,n;
  IF hash IS DISTINCT FROM t.digest OR n<>t.row_count THEN RAISE EXCEPTION 'Original data changed in table %',t.table_name; END IF;
 END LOOP;
END $$;
-- Only migration bookkeeping changes after preservation checks. Keep failed rows
-- with an explicit rollback marker; baseline receipts must not claim SQL replay.
UPDATE "_prisma_migrations" SET rolled_back_at=CURRENT_TIMESTAMP WHERE finished_at IS NULL AND rolled_back_at IS NULL;
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'4f17cce8e03f7802af4490de69aec45f3b83d066f32969af6d1e83a36eca29af','20260709090000_postgresql_baseline',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260709090000_postgresql_baseline' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'d34c09f41894ca2f00292811cf4639414b7a5a61aa36c11ec6ce72c6fa808217','20260709110000_auth_sessions',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260709110000_auth_sessions' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'4e1a69b54f8f62dd5658a42310f903465c62310ccbde2da347c649f942989604','20260709113000_vendor_member_status',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260709113000_vendor_member_status' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'c830dba87f6dfe76905fc63ef998bfe7116e46709f595a2263891214309877df','20260709170000_password_reset_tokens',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260709170000_password_reset_tokens' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'bff0e2bd20a5e7f99adfa09de02379ee4839f3952a5f454106407e99a7a2f1f8','20260709193000_user_mfa',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260709193000_user_mfa' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'e8105c529474a422c6478c36c9bfe85d601925db3f841d90086b1baf8ca665ec','20260721133000_inventory_reservations',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260721133000_inventory_reservations' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'0704707fb33212e8982cb8f11ce24d630904facda65efbdd78f482a351500b3b','20260724150000_harden_supabase_data_api',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260724150000_harden_supabase_data_api' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'6d493faa761fab27314275fc35c64422ee50a4d94109f82b4e5d902adf47c853','20260725112500_harden_tenant_ledger_foreign_keys',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260725112500_harden_tenant_ledger_foreign_keys' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'632179b160230790c7bcd6f3617a6a4af309565fe2c805f24e5d2ebab2a90f10','20260725230000_encrypt_payout_bank_accounts',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260725230000_encrypt_payout_bank_accounts' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'b0fbab1283f6a3df64cb18095c74d1eb8194f6138eb8e6a7a48ea97d0969f5ce','20260725231500_harden_affiliate_commissions',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260725231500_harden_affiliate_commissions' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'e51b6c425330c7bcb473e61b983fe1a348e1528b4b6f9d2306b903b17f1e5651','20260728183500_harden_affiliate_commission_identity_and_status',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260728183500_harden_affiliate_commission_identity_and_status' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'ab77c334d80eba03eec7952dbc5564d9c359dfb940a7502dd958312b026e6a65','20260728210000_add_affiliate_commission_accounting_ledger',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260728210000_add_affiliate_commission_accounting_ledger' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'8df5ed38b140d740c5dbf285202a8414a3572461484cff6dcdfc2e684dcc644a','20260806090000_affiliate_payout_contract',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260806090000_affiliate_payout_contract' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'4d244bd45da00d583b50755454c50eaa8ddbb590c6018ce9715ca50d01b6b032','20260807080000_course_fg_allocation',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807080000_course_fg_allocation' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'c96d93385d779f1fe78b28d73e7fcc8c452d5579d772833f2beba8c10d96bdef','20260807100000_course_payout_read_model',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807100000_course_payout_read_model' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'5e90845c8530e98f13b936b764318c8f924b248eba022fb47db1f9945f400dbf','20260807110000_platform_referral_attribution',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807110000_platform_referral_attribution' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'0c10df360a621975fe6c3c745c643eb6fa1761d1964c56151eb24e41af4d78f9','20260807130000_stream_usage_attribution_ledger',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807130000_stream_usage_attribution_ledger' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'8aa7530ef6f7175b29f4ae8f48c5b1a38749132047faeb0cdf3771f73b144643','20260807150000_platform_referral_commission_ledger',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807150000_platform_referral_commission_ledger' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'4a284f9b257d38d326752f494de0ec8b391c7a0e26d05b6ce4409e63f40d17eb','20260807170000_platform_referral_payout_read_model',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807170000_platform_referral_payout_read_model' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'f8a38d0b1fd9fec599c72546ff71dd1528705dba32efd8332f6243829534a689','20260807190000_checkout_idempotency',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807190000_checkout_idempotency' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'11adb7c66958bb97e0a54eb952224c9357939d9b5685f122a402152f69bdf22e','20260807210000_affiliate_gross_net_reference',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807210000_affiliate_gross_net_reference' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'24e0aa626c365f4ae7f1fc34c19eb69dad556a0b988d958367cf78425cadff33','20260807220000_course_gross_net_reference',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807220000_course_gross_net_reference' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'b2d176861491f82ba0115fd91117809f0d092453e38cee825bd31cd9a11391f3','20260807221000_platform_referral_initial_only',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807221000_platform_referral_initial_only' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'81a72ba94a95ac1fde39b4fe2a22173efd916e314872de149e938a03fca41bdb','20260807222000_affiliate_payout_gross_net_reference',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807222000_affiliate_payout_gross_net_reference' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'f20bcdd3a584b5dcb3dcb2bececa827be1ce75e70483bf0c375ae16a45f51343','20260807230000_live_viewer_quota_admission',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260807230000_live_viewer_quota_admission' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'808533103176968672d737a4d17efbcd3f9a13d742d7be0c6fd3e2280db88696','20260808010000_live_product_tenant_binding',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808010000_live_product_tenant_binding' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'1fa145fa0044352eeed616645f08f97e05760572f762439cb11fc4f7940c5277','20260808020000_live_resource_tenant_binding',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808020000_live_resource_tenant_binding' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'cf3614f3bc2683b0b9ba89d39be6c6f8bfba8756e1044ef89c328394e321a3b3','20260808030000_stream_usage_attribution_allocation',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808030000_stream_usage_attribution_allocation' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'bb2871d71d0c8f63b4028cbc458c87917b36cc7cb2d5216095dd7b8025555d64','20260808040000_partner_live_share',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808040000_partner_live_share' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'7ad2fdf87ef5d1c2f1b389f937db7a79c07e87b0cc02cc1684443a49365d663e','20260808050000_platform_referral_dispute_ledger',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808050000_platform_referral_dispute_ledger' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'5677b81f680b394b69a3b075d092dfe5ea911c00d1ab9af45716c749f608d985','20260808060000_payment_method_reference',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808060000_payment_method_reference' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'c6e7c0086c13d74899b7b493dd31fdb4ecf06b1395befda5b44e192a3bc72c19','20260808070000_merchant_payout_outcome_reference',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808070000_merchant_payout_outcome_reference' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'88a012f1f1a23b092e70a76cdc4845c1f7be24bd940e057a4d3cc237df23b1b5','20260808073000_affiliate_payout_outcome_reference',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808073000_affiliate_payout_outcome_reference' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'11f01d139c18d69e1f5e7ceec7b4645beaf6660791caa1820e567db9e3dcbe4c','20260808080000_g7_03_media_assets',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808080000_g7_03_media_assets' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'1f67f3d3efc4b7def1aace97954fb5428210b923467623e57f8158a5fcf527fc','20260808094500_g7_03_live_studio_drafts',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808094500_g7_03_live_studio_drafts' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'e5dda497cee70bf0bca99fa78eccda5fde5ffb8324892dde919841b10e8eab3e','20260808110000_g7_04_commerce_orders',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808110000_g7_04_commerce_orders' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'526cee1c75c60de258c65ea8707f26fa0a9245f16c37d9145ca44842b5ff0840','20260808203000_g7_07_email_delivery',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808203000_g7_07_email_delivery' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'c96c9eb6e20edb6ad79ea6387deda2aa5761440f549be157e768ddf70667f657','20260808220500_g7_09_support_cases',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808220500_g7_09_support_cases' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'e7da9fd1fe5e3a5080456ccc1b58b996ee163af0ba89eb9d75d70034cb0c77da','20260808233000_g7_09c_buyer_support_access',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808233000_g7_09c_buyer_support_access' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'f63a7350cb507f16ce148f15bebd309288334f2ad96e2b06320b859f7d6f249f','20260808235500_g7_10_product_catalog_safety',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260808235500_g7_10_product_catalog_safety' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'bab8561ac3f62009e08596a757b87d700ff7bb43a86edb3dee5429a425e97b6c','20260809000000_g7_12_stream_usage_reconciliation',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260809000000_g7_12_stream_usage_reconciliation' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'671065fe09a866d440560a4e4dff39937a83d3f340e9dd43c338ef5ae4e48935','20260809010000_g7_13_analytics_authenticity',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260809010000_g7_13_analytics_authenticity' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'0d6ce5f12a21ff5588c5fc4c939cc768ef4f49b53088106462f585e4005e70c4','20260809020000_g7_13b_form_submission_verification',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260809020000_g7_13b_form_submission_verification' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'9af5626356988fdb745749698cb4287165968a78bef10f753ad6ec71d64ac21d','20260809030000_g7_21_live_reminder_email',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260809030000_g7_21_live_reminder_email' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'c14a46ac66502f226f2bd12a337210696088dacf156e6a1e79b5c7d4757120ef','20260809040000_g7_23_live_reminder_reconciliation',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260809040000_g7_23_live_reminder_reconciliation' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'6bd8a58fab97e2148d4ee7a2d201a2d90d8dac304fd9cc0755cbcc7b1f5bf6bd','20260809050000_g7_26_split_refund_handoff',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260809050000_g7_26_split_refund_handoff' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'560602078220b86debe3a3b2392375eb1adb9d651426629b86771f7dae66fc8a','20260809060000_g7_28_affiliate_payout_outcome_reason',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260809060000_g7_28_affiliate_payout_outcome_reason' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'697a3e62608fb813481b2f62209b9c6131dc6f31f806018570284eca458a2b49','20260809070000_g7_35_shipping_refund_states',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260809070000_g7_35_shipping_refund_states' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'5d971c861df27657d99ae9102b232ab4c1aaf10cb8833740de1c7fe8e7f483ec','20260809071000_g7_35_shipping_refund_lifecycle',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260809071000_g7_35_shipping_refund_lifecycle' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'4e4eb804ade4b104050a400fb1e01aafb6c4af17c42313b09eff2e5b1a3cb3f4','20260809072000_g7_48_product_delivery_snapshot',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260809072000_g7_48_product_delivery_snapshot' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'bbeab14cb0b81f0210a449b3e7d366537cdc83329825d5ae62355632c96f5714','20260810051000_g7_54_form_submission_search_indexes',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260810051000_g7_54_form_submission_search_indexes' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'51af411f676e785fc82a68fa4824a8d53ebb0f130a93383f47b213d327e7dfb4','20260810060000_g7_55_email_delivery_operations',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260810060000_g7_55_email_delivery_operations' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'6ccee7158957cf60b0f630393750424bdea5c0e7a2a12c620b2133efd076b59e','20260815090000_g8_01_one_stop_webinar_domain',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260815090000_g8_01_one_stop_webinar_domain' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'5ba053a8973dc54e2140466cc3cd106a32481153cdf1c30e55f32792303e524b','20260815100000_g8_02_interaction_role_semantics',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260815100000_g8_02_interaction_role_semantics' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'942c8871c68975dda98edf1f4a516f2a4839468f6e25826dfea530920f9acad4','20260817120000_wp2_brand_sender_settings',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260817120000_wp2_brand_sender_settings' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'9b68ae25f5f135d2b97d9118c646fd3f24030c74a029d03c980539eb5d370726','20260818090000_custom_checkout_fields',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260818090000_custom_checkout_fields' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'0a7f8b04430e60a358a2bda9c83202892af7e5786d40700b67d60f47d12941e4','20260819090000_wp1_video_archive_state',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260819090000_wp1_video_archive_state' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'95b362b08d8ff52b1135a3789feb84478e5c3ee202c1d97acfb738f523355131','20260905090000_affiliate_portal',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260905090000_affiliate_portal' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'7df2728160a13a078b0935151953091d65e1501d7c005c4b814077cbf1976365','20260905113000_line_official_account',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260905113000_line_official_account' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'c50960911a3a8a529419266140e681b3419d855a665b454b4f33e7092bd6541f','20260905160000_tiered_multilevel_commission',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260905160000_tiered_multilevel_commission' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'550be4bf5cdaa5261ad95b1d42897af60cea9597a726a403cbd705644e3e2954','20260906003000_advanced_live_interactions',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260906003000_advanced_live_interactions' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'6ea6d1a6129a39bb6d70980b7d17f1170a7c1bf345569d6efe38ecb1879fbbd4','20260906013000_smart_automation_workflows',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260906013000_smart_automation_workflows' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'a8300a6f3f8152ed97f9b074c23ff73708eb474520bf62f3e3f98e08d99da8d7','20260907090000_live_lucky_draw_purchase_claim',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260907090000_live_lucky_draw_purchase_claim' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'e9135600c31278b31074936f30226e5311d8575fd2750850deeb0f3a99c1b0df','20260907180000_live_qa_spotlight',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260907180000_live_qa_spotlight' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'b4335a2975d457013d83c6faf2e1be9c10562f6a92adb8a6a1bc6c96f38903f8','20260907200000_affiliate_payout_taiwan_withholding',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260907200000_affiliate_payout_taiwan_withholding' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'a46eaaa287c9f87c8b831b1d33f4903f0fbfa2345fcd56589aa4397ff08993cc','20260907213000_versioned_tiered_commission_snapshots',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260907213000_versioned_tiered_commission_snapshots' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'27c1dd31e23a11e38599def0e69f6b75a32be2a740486e80f66c1e752e3e06fe','20260907220000_quantity_commission_tiers',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260907220000_quantity_commission_tiers' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'9428ec325c64d46ce990ed4734f65ae4f8870df13c8a90eb99c78a9f9a84bacb','20260907221500_quantity_commission_snapshot_contract',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260907221500_quantity_commission_snapshot_contract' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'453c2c77939eb1e09925279cc17129ee99888f3799fd3676e17432043e145c3a','20260907230000_registration_form_funnel_blocks',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260907230000_registration_form_funnel_blocks' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'3b31bf146fd2d00ee6cf543345153d3f065d6dac9f619832a810dee939a5126e','20260908031500_taiwan_b2c_electronic_invoice',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260908031500_taiwan_b2c_electronic_invoice' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'43286f2e77f239c23b3c41f3e8c945e0f2ef9ca4b837d47bae15e703f3ddfad6','20260908090000_vendor_feature_toggles',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260908090000_vendor_feature_toggles' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'2f9a8b2587ed501952eed7261244bd3b149fee4e0237032c36d30401337eaf16','20260908100000_consultation_booking',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260908100000_consultation_booking' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'960fb0156c4ac3c3d4071f19c67ddfd303a0e119b7677a94fcd19ac9582846f3','20260908113000_automation_customer_funnel_identity',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260908113000_automation_customer_funnel_identity' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'a3a5dd1b38b6345b33b4d157713d7a14348ebdb684ac76d129e7469f7b3710cf','20260908143000_customer_crm_cockpit',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260908143000_customer_crm_cockpit' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'91b087fab5336d5ef787ec93350e95c90339b41688060f83f866f69129b422d8','20260908230000_evergreen_webinar_vendor_settings',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260908230000_evergreen_webinar_vendor_settings' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'10f1e276daf4d9aa4e1b056279ef25335b231fc764b8664a85790cda64303c3a','20260909100000_student_portal_access_tokens',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260909100000_student_portal_access_tokens' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'d09cc865119451876b6d4c468128bbf90ee9b8e8a4a3e1c4b94cf668ac38246f','20260909143000_line_rich_menu',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260909143000_line_rich_menu' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count,logs) SELECT gen_random_uuid()::text,'8e5dcad20023f755211393fdc0ae9056c30955a6b8e698340a52d6c526d57c97','20260909190000_flagship_growth_delivery',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,'Baselined by verified data-preserving local legacy bridge; not a replay of historical migration SQL' WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260909190000_flagship_growth_delivery' AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
COMMIT;
