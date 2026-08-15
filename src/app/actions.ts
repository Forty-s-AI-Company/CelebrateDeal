"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  requireFinanceAdmin,
  requireVendorFinance,
  requireVendorManager,
  requireVendorManagerContext,
} from "@/lib/auth";
import { auditSnapshot, requestAuditMeta, writeAuditLog } from "@/lib/audit";
import { AffiliateCommissionRateBps } from "@/lib/affiliate-commission";
import { appendCommissionLedgerEntry, commissionLedgerBalance } from "@/lib/affiliate-commission-accounting";
import { encryptBankAccount, maskBankAccount, resolveStoredBankAccount } from "@/lib/bank-account";
import { monthRange, payoutBatchNumber } from "@/lib/billing";
import { BillingCycleError, generateSettlementForVendor } from "@/lib/billing-cycle";
import { assertServerActionSecurity } from "@/lib/csrf";
import { retryWebhookEvent } from "@/lib/webhook-retry";
import { getDb } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment-providers";
import { RefundProviderError } from "@/lib/payment-providers/types";
import {
  applyPaymentRefundAccounting,
  calculateNetReferenceAmountCents,
} from "@/lib/payment-refund-accounting";
import { toSlug } from "@/lib/format";
import { parseLiveQuotaPolicyForm, LiveQuotaPolicyValidationError, type LiveQuotaPolicy } from "@/lib/live-quota-policy";
import { liveStudioDraftFromFormData } from "@/lib/live-studio-draft-client";
import type { LiveStudioDraftPayload } from "@/lib/live-studio-draft";
import {
  createLiveReminderReconciliationSnapshot,
  queueLiveReminderReconciliation,
  type LiveReminderReconciliationSnapshot,
  type LiveReminderTemplateSnapshot,
} from "@/lib/live-reminder-reconciliation";
import { assertPaymentMethodReferenceForQuota, PaymentMethodReferenceRequiredError } from "@/lib/payment-method-reference";
import { parseInteractionTriggerSeconds } from "@/lib/interaction-timeline";
import { normalizeInteractionEventDraft } from "@/lib/interaction-event";
import {
  INTERACTION_ROLE_AVATAR_MODES,
  isCanonicalInteractionRolePresetUrl,
  parseInteractionRoleBoolean,
  normalizeInteractionRoleDraft,
  type InteractionRoleAvatarMode,
  type NormalizedInteractionRole,
} from "@/lib/interaction-role";
import {
  hasUsableMessageTemplateContent,
  LIVE_REMINDER_EMAIL_TEMPLATE_WHERE,
  normalizeMessageTemplateDraft,
  REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
  type MessageTemplateActionError,
  type MessageTemplateActionState,
  type MessageTemplateFormDraft,
} from "@/lib/message-template";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";
import {
  getLivePublishReadiness,
  requiresLivePublishReadiness,
} from "@/lib/live-publish-readiness";
import { ImageAssetReferenceError, resolveReadyImageAsset } from "@/lib/image-assets";
import { isLiveVideoReady, liveReadyVideoWhere } from "@/lib/live-video-readiness";
import { BlacklistIdentifierType, normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";
import { assertIanaTimeZone, parseZonedDateTimeLocal } from "@/lib/zoned-date-time";
import { canMarkPayoutBatchExported, canTransitionPayoutItem, derivePayoutBatchStatus, PayoutItemTargetStatus } from "@/lib/payout-state";
import { selectPayoutAccount } from "@/lib/payout-account";
import { CoursePayoutMutationConflict, syncCoursePayoutsForSettlement } from "@/lib/course-payout-accounting";
import {
  createVendorMemberAction as createVendorMemberActionImpl,
  deactivateVendorMemberAction as deactivateVendorMemberActionImpl,
  resendVendorMemberInvitationAction as resendVendorMemberInvitationActionImpl,
} from "./actions/vendor-member-actions";
import { voidAffiliateCommissionAction as voidAffiliateCommissionActionImpl } from "./actions/affiliate-actions";
import {
  confirmMfaEnrollmentAction as confirmMfaEnrollmentActionImpl,
  confirmPasswordResetAction as confirmPasswordResetActionImpl,
  dismissRecoveryCodesAction as dismissRecoveryCodesActionImpl,
  loginAction as loginActionImpl,
  logoutAction as logoutActionImpl,
  regenerateRecoveryCodesAction as regenerateRecoveryCodesActionImpl,
  requestPasswordResetAction as requestPasswordResetActionImpl,
  revokeAllSessionsAction as revokeAllSessionsActionImpl,
  revokeOtherSessionsAction as revokeOtherSessionsActionImpl,
  sendPasswordResetSmokeAction as sendPasswordResetSmokeActionImpl,
  startMfaEnrollmentAction as startMfaEnrollmentActionImpl,
  updatePasswordAction as updatePasswordActionImpl,
  verifyMfaAction as verifyMfaActionImpl,
} from "./actions/auth-security-actions";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function safeExternalUrl(value: string | null, label: string) {
  if (!value) return null;

  const safeUrl = parseSafeExternalHttpUrl(value);
  if (!safeUrl) throw new Error(`${label}必須是有效的 HTTP 或 HTTPS 完整網址。`);
  return safeUrl;
}

function optionalExternalUrl(formData: FormData, key: string, label: string) {
  return safeExternalUrl(optionalText(formData, key), label);
}

function requiredExternalUrl(formData: FormData, key: string, label: string) {
  const safeUrl = parseSafeExternalHttpUrl(text(formData, key));
  if (!safeUrl) throw new Error(`${label}必須是有效的 HTTP 或 HTTPS 完整網址。`);
  return safeUrl;
}

function intValue(formData: FormData, key: string, fallback = 0) {
  const parsed = Number.parseInt(text(formData, key, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moneyToCents(formData: FormData, key: string, fallback = 0) {
  const value = text(formData, key);
  if (!value) return fallback;
  const parsed = Number.parseFloat(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : fallback;
}

class RefundValidationError extends Error {}
class PayoutBatchClaimConflict extends Error {}
class SettlementMutationConflict extends Error {}
class AffiliatePayoutMutationConflict extends Error {}

function managerAuditIdentity(auth: Awaited<ReturnType<typeof requireVendorManagerContext>>["auth"]) {
  return {
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? "vendor_manager",
  };
}

function isDatabaseTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "P2025" || error.code === "P2034");
}

function isRecordNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

function isSettlementMutationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "P2002" || error.code === "P2025" || error.code === "P2034");
}

function isAffiliatePayoutMutationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "P2002" || error.code === "P2025" || error.code === "P2034");
}

function isSerializationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

const REFUND_TRANSACTION_MAX_ATTEMPTS = 3;

// Keep the legacy public action surface stable while the auth/security domain
// owns its implementation in a dedicated file-level `use server` module.
export async function loginAction(formData: FormData) {
  return loginActionImpl(formData);
}

export async function logoutAction(formData: FormData) {
  return logoutActionImpl(formData);
}

export type BrandSettingsFormValues = {
  name: string;
  slug: string;
  primaryColor: string;
  ctaColor: string;
  timezone: string;
  supportEmail: string;
  logoUrl: string;
  /** 只在表單與 action state 中傳遞 opaque asset id；page 可省略此欄位。 */
  logoAssetId?: string;
};

export type BrandSettingsActionState = {
  status: "idle" | "error";
  message: string;
  values: BrandSettingsFormValues;
};

const INVALID_BRAND_TIMEZONE_MESSAGE = "時區格式無效，請輸入有效的 IANA 時區，例如 Asia/Taipei。";
const INVALID_BRAND_LOGO_MESSAGE = "品牌 Logo 來源無效，請完成上傳、移除未完成的檔案，或改用有效的 HTTP/HTTPS 圖片網址。";
const INVALID_BRAND_LOGO_ASSET_MESSAGE = "品牌 Logo 圖片資產無效，請重新上傳。";
const INVALID_BRAND_LOGO_PHASE_MESSAGE = "品牌 Logo 上傳尚未完成，請完成上傳或移除未完成的檔案。";
const BRAND_LOGO_URL_MAX_LENGTH = 2048;

type BrandSettingsValidationCode = "invalid_timezone" | "invalid_logo";

class BrandSettingsValidationError extends Error {
  constructor(
    readonly code: BrandSettingsValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "BrandSettingsValidationError";
  }
}

function submittedBrandSettingsValues(formData: FormData): BrandSettingsFormValues {
  const boundedValue = (key: string, maxLength: number) => {
    const submitted = formData.get(key);
    return typeof submitted === "string" ? submitted.slice(0, maxLength) : "";
  };

  return {
    name: boundedValue("name", 160),
    slug: boundedValue("slug", 160),
    primaryColor: boundedValue("primaryColor", 32),
    ctaColor: boundedValue("ctaColor", 32),
    timezone: boundedValue("timezone", 128),
    supportEmail: boundedValue("supportEmail", 320),
    logoUrl: boundedValue("logoUrl", BRAND_LOGO_URL_MAX_LENGTH),
    logoAssetId: boundedValue("logoAssetId", 128),
  };
}

type ValidatedBrandSettings = {
  timezone: string;
  logoUrl: string | null;
  logoAssetId: string | null;
};

async function validateBrandSettings(vendorId: string, formData: FormData): Promise<ValidatedBrandSettings> {
  const timezone = text(formData, "timezone", "Asia/Taipei");
  try {
    assertIanaTimeZone(timezone);
  } catch {
    throw new BrandSettingsValidationError("invalid_timezone", INVALID_BRAND_TIMEZONE_MESSAGE);
  }

  const submittedPhase = formData.get("logoUploadPhase");
  const logoUploadPhase = submittedPhase === null
    ? ""
    : typeof submittedPhase === "string"
      ? submittedPhase.trim()
      : "__invalid__";
  if (!["", "idle", "success"].includes(logoUploadPhase)) {
    throw new BrandSettingsValidationError("invalid_logo", INVALID_BRAND_LOGO_PHASE_MESSAGE);
  }

  const submittedAssetId = formData.get("logoAssetId");
  const logoAssetId = submittedAssetId === null
    ? null
    : typeof submittedAssetId === "string"
      ? submittedAssetId.trim() || null
      : "__invalid__";
  if (logoAssetId === "__invalid__") {
    throw new BrandSettingsValidationError("invalid_logo", INVALID_BRAND_LOGO_ASSET_MESSAGE);
  }

  if (logoAssetId) {
    try {
      const logoAsset = await resolveReadyImageAsset(getDb(), { vendorId, assetId: logoAssetId });
      if (!logoAsset) throw new BrandSettingsValidationError("invalid_logo", INVALID_BRAND_LOGO_ASSET_MESSAGE);
      return { timezone, logoUrl: logoAsset.publicUrl, logoAssetId: logoAsset.id };
    } catch (error) {
      if (error instanceof ImageAssetReferenceError) {
        throw new BrandSettingsValidationError("invalid_logo", INVALID_BRAND_LOGO_ASSET_MESSAGE);
      }
      throw error;
    }
  }

  const submittedLogoUrl = formData.get("logoUrl");
  const logoUrlInput = submittedLogoUrl === null
    ? ""
    : typeof submittedLogoUrl === "string"
      ? submittedLogoUrl.trim()
      : "__invalid__";
  if (logoUrlInput.length > BRAND_LOGO_URL_MAX_LENGTH) {
    throw new BrandSettingsValidationError("invalid_logo", INVALID_BRAND_LOGO_MESSAGE);
  }
  const logoUrl = logoUrlInput === ""
    ? null
    : parseSafeExternalHttpUrl(logoUrlInput === "__invalid__" ? null : logoUrlInput);
  if (logoUrlInput !== "" && !logoUrl) {
    throw new BrandSettingsValidationError("invalid_logo", INVALID_BRAND_LOGO_MESSAGE);
  }

  return { timezone, logoUrl, logoAssetId: null };
}

async function updateBrandSettings(vendorId: string, formData: FormData, validated: ValidatedBrandSettings) {
  await getDb().vendor.update({
    where: { id: vendorId },
    data: {
      name: text(formData, "name"),
      slug: toSlug(text(formData, "slug")),
      logoUrl: validated.logoUrl,
      primaryColor: text(formData, "primaryColor", "#2563eb"),
      ctaColor: text(formData, "ctaColor", "#f97316"),
      timezone: validated.timezone,
      supportEmail: optionalText(formData, "supportEmail"),
    },
  });
}

/**
 * 保留既有直接呼叫的 Server Action 介面；新品牌頁使用下方 state action，
 * 讓可修正的驗證錯誤不需要把表單內容塞進 URL。
 */
export async function saveBrandSettingsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  let validated: ValidatedBrandSettings;
  try {
    validated = await validateBrandSettings(vendor.id, formData);
  } catch (error) {
    if (error instanceof BrandSettingsValidationError) {
      redirect(`/settings/brand?error=${error.code}`);
    }
    throw error;
  }
  await updateBrandSettings(vendor.id, formData, validated);
  revalidatePath("/settings/brand");
}

export async function saveBrandSettingsActionState(
  _previousState: BrandSettingsActionState,
  formData: FormData,
): Promise<BrandSettingsActionState> {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const values = submittedBrandSettingsValues(formData);
  let validated: ValidatedBrandSettings;
  try {
    validated = await validateBrandSettings(vendor.id, formData);
  } catch (error) {
    if (error instanceof BrandSettingsValidationError) {
      return { status: "error", message: error.message, values };
    }
    throw error;
  }

  await updateBrandSettings(vendor.id, formData, validated);
  revalidatePath("/settings/brand");
  redirect("/settings/brand");
}

export async function saveTrackingSettingsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  await getDb().trackingSetting.upsert({
    where: { vendorId: vendor.id },
    create: {
      vendorId: vendor.id,
      facebookPixelId: optionalText(formData, "facebookPixelId"),
      tiktokPixelId: optionalText(formData, "tiktokPixelId"),
      googleTagManagerId: optionalText(formData, "googleTagManagerId"),
      enablePageView: formData.get("enablePageView") === "on",
      enableLeadEvent: formData.get("enableLeadEvent") === "on",
      enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
    },
    update: {
      facebookPixelId: optionalText(formData, "facebookPixelId"),
      tiktokPixelId: optionalText(formData, "tiktokPixelId"),
      googleTagManagerId: optionalText(formData, "googleTagManagerId"),
      enablePageView: formData.get("enablePageView") === "on",
      enableLeadEvent: formData.get("enableLeadEvent") === "on",
      enablePurchaseEvent: formData.get("enablePurchaseEvent") === "on",
    },
  });
  revalidatePath("/settings/tracking");
}

export async function updatePasswordAction(formData: FormData) {
  return updatePasswordActionImpl(formData);
}

export async function requestPasswordResetAction(formData: FormData) {
  return requestPasswordResetActionImpl(formData);
}

export async function confirmPasswordResetAction(formData: FormData) {
  return confirmPasswordResetActionImpl(formData);
}

export async function startMfaEnrollmentAction(formData: FormData) {
  return startMfaEnrollmentActionImpl(formData);
}

export async function confirmMfaEnrollmentAction(formData: FormData) {
  return confirmMfaEnrollmentActionImpl(formData);
}

export async function verifyMfaAction(formData: FormData) {
  return verifyMfaActionImpl(formData);
}

export async function dismissRecoveryCodesAction(formData: FormData) {
  return dismissRecoveryCodesActionImpl(formData);
}

export async function regenerateRecoveryCodesAction(formData: FormData) {
  return regenerateRecoveryCodesActionImpl(formData);
}

export async function sendPasswordResetSmokeAction(formData: FormData) {
  return sendPasswordResetSmokeActionImpl(formData);
}

// A file-level `use server` module must expose direct async function exports.
// Wrapping the isolated vendor-member actions keeps their public import path
// stable while allowing Next.js to register each root action at build time.
export async function createVendorMemberAction(formData: FormData) {
  return createVendorMemberActionImpl(formData);
}

export async function deactivateVendorMemberAction(formData: FormData) {
  return deactivateVendorMemberActionImpl(formData);
}

export async function resendVendorMemberInvitationAction(formData: FormData) {
  return resendVendorMemberInvitationActionImpl(formData);
}

export async function voidAffiliateCommissionAction(formData: FormData) {
  return voidAffiliateCommissionActionImpl(formData);
}

export async function revokeOtherSessionsAction(formData: FormData) {
  return revokeOtherSessionsActionImpl(formData);
}

export async function revokeAllSessionsAction(formData: FormData) {
  return revokeAllSessionsActionImpl(formData);
}

export async function upsertVideoAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const invalidVideoPath = id
    ? `/videos/${encodeURIComponent(id)}/edit?error=invalid_video`
    : "/videos/new?error=invalid_video";
  if (id && id.length > 128) redirect("/videos/new?error=invalid_video");
  const db = getDb();
  const thumbnailAssetId = optionalText(formData, "thumbnailAssetId");
  const invalidImageAssetPath = id
    ? `/videos/${encodeURIComponent(id)}/edit?error=invalid_image_asset`
    : "/videos/new?error=invalid_image_asset";
  const thumbnailAsset = await resolveReadyImageAsset(db, { vendorId: vendor.id, assetId: thumbnailAssetId })
    .catch(() => redirect(invalidImageAssetPath));
  const thumbnailUrl = thumbnailAsset?.publicUrl
    ?? optionalExternalUrl(formData, "thumbnailUrl", "影片縮圖網址");
  const editableData = {
    title: text(formData, "title"),
    description: optionalText(formData, "description"),
    thumbnailUrl,
    thumbnailAssetId: thumbnailAsset?.id ?? null,
    durationSec: intValue(formData, "durationSec"),
    estimatedMinutes: intValue(formData, "estimatedMinutes"),
  };

  if (id) {
    const existingVideo = await db.video.findFirst({
      where: { id, vendorId: vendor.id },
      select: {
        id: true,
        sourceType: true,
        status: true,
        cloudflareReadyToStream: true,
        cloudflareLiveInputUid: true,
        liveInputStatus: true,
      },
    });
    if (!existingVideo) redirect("/videos?error=not_found");
    if (existingVideo.sourceType !== "url" && !isLiveVideoReady(existingVideo)) {
      redirect(`/videos/${encodeURIComponent(id)}/edit?error=video_processing`);
    }

    const data = existingVideo.sourceType === "url"
      ? {
          ...editableData,
          videoUrl: requiredExternalUrl(formData, "videoUrl", "影片網址"),
          status: text(formData, "status") === "archived" ? "archived" : "ready",
        }
      : editableData;
    await db.video.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    const externalVideoUrl = parseSafeExternalHttpUrl(text(formData, "videoUrl"));
    if (!externalVideoUrl) redirect(invalidVideoPath);
    await db.video.create({
      data: {
        ...editableData,
        vendorId: vendor.id,
        sourceType: "url",
        videoUrl: externalVideoUrl,
        status: "ready",
      },
    });
  }

  redirect("/videos");
}

export async function upsertFormAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  let rawFields: unknown;
  try {
    rawFields = JSON.parse(text(formData, "fields", "[]"));
  } catch {
    redirect(id ? `/forms/${encodeURIComponent(id)}/edit?error=invalid_fields` : "/forms/new?error=invalid_fields");
  }
  const fields = parseRegistrationFormFields(rawFields);
  if (!fields.success) {
    redirect(id ? `/forms/${encodeURIComponent(id)}/edit?error=invalid_fields` : "/forms/new?error=invalid_fields");
  }

  const data = {
    name: text(formData, "name"),
    slug: toSlug(text(formData, "slug")),
    headline: text(formData, "headline"),
    description: optionalText(formData, "description"),
    submitLabel: text(formData, "submitLabel", "送出報名"),
    fields: fields.data as Prisma.InputJsonValue,
    successMessage: text(formData, "successMessage", "已收到你的資料，開播前會再提醒你。"),
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().registrationForm.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().registrationForm.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/forms");
}

function messageTemplateFormDraft(formData: FormData): MessageTemplateFormDraft {
  const boundedValue = (key: string, maximum: number) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.slice(0, maximum + 1) : "";
  };
  return {
    name: boundedValue("name", 160),
    channel: boundedValue("channel", 32),
    trigger: boundedValue("trigger", 64),
    subject: boundedValue("subject", 200),
    body: boundedValue("body", 20_000),
    isActive: formData.get("isActive") === "on",
  };
}

function messageTemplateActionError(
  previousState: MessageTemplateActionState,
  error: MessageTemplateActionError,
  draft: MessageTemplateFormDraft,
  expectedUpdatedAt: string | null = null,
): MessageTemplateActionState {
  return {
    status: "error",
    error,
    draft,
    expectedUpdatedAt,
    version: previousState.version + 1,
  };
}

export async function upsertTemplateAction(
  previousState: MessageTemplateActionState,
  formData: FormData,
): Promise<MessageTemplateActionState> {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const id = optionalText(formData, "id");
  const expectedUpdatedAtValue = optionalText(formData, "expectedUpdatedAt");
  const expectedUpdatedAt = expectedUpdatedAtValue ? new Date(expectedUpdatedAtValue) : null;
  const expectedUpdatedAtIsValid = Boolean(
    expectedUpdatedAt
    && !Number.isNaN(expectedUpdatedAt.getTime())
    && expectedUpdatedAt.toISOString() === expectedUpdatedAtValue,
  );
  const submittedDraft = messageTemplateFormDraft(formData);
  if (
    id
    && (
      id.length > 128
      || !expectedUpdatedAtIsValid
    )
  ) {
    return messageTemplateActionError(previousState, "invalid_template", submittedDraft);
  }
  const normalized = normalizeMessageTemplateDraft(submittedDraft);
  if (!normalized.success) {
    return messageTemplateActionError(
      previousState,
      "invalid_template",
      submittedDraft,
      expectedUpdatedAtIsValid ? expectedUpdatedAtValue : null,
    );
  }
  const data = normalized.data;

  const db = getDb();
  let outcome: {
    template: Awaited<ReturnType<typeof db.messageTemplate.create>>;
    reconciliationStatuses: string[];
  };
  try {
    outcome = await db.$transaction(async (tx) => {
      const template = id
        ? await tx.messageTemplate.update({ where: { id, vendorId: vendor.id, updatedAt: expectedUpdatedAt ?? undefined }, data })
        : await tx.messageTemplate.create({ data: { ...data, vendorId: vendor.id } });
      if (!id) return { template, reconciliationStatuses: [] };

      const linkedLives = await tx.live.findMany({
        where: { vendorId: vendor.id, liveReminderTemplateId: template.id },
        select: { id: true, title: true, status: true, scheduledAt: true, liveReminderOffsetMinutes: true },
      });
      const reconciliationStatuses: string[] = [];
      for (const live of linkedLives) {
        const queued = await queueLiveReminderReconciliation(tx, createLiveReminderReconciliationSnapshot({
          vendorId: vendor.id,
          liveId: live.id,
          liveTitle: live.title,
          liveStatus: live.status,
          scheduledAt: live.scheduledAt,
          reminderOffsetMinutes: live.liveReminderOffsetMinutes,
          template,
        }));
        reconciliationStatuses.push(queued.status);
      }
      return { template, reconciliationStatuses };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      const current = id
        ? await db.messageTemplate.findFirst({
            where: { id, vendorId: vendor.id },
            select: { updatedAt: true },
          })
        : null;
      return messageTemplateActionError(
        previousState,
        current ? "conflict" : "missing_template",
        submittedDraft,
        current?.updatedAt.toISOString() ?? null,
      );
    }
    throw error;
  }
  const { template, reconciliationStatuses } = outcome;

  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: id ? "message_template_updated" : "message_template_created",
    targetType: "MessageTemplate",
    targetId: template.id,
    after: auditSnapshot({
      name: data.name,
      channel: data.channel,
      trigger: data.trigger,
      isActive: data.isActive,
      hasSubject: true,
      bodyLength: data.body.length,
    }),
  });

  redirect(reconciliationStatuses.length > 0
    ? "/messages/templates?notice=reminders_reconciling"
    : "/messages/templates");
}

async function requireLiveQuotaPaymentMethod(
  db: PrismaClient,
  vendorId: string,
  quotaPolicy: Pick<LiveQuotaPolicy, "customAllocations" | "memberQuotas" | "pageQuotas" | "quotaPayerScope">,
  id: string | null,
  draftId: string,
) {
  const quotaMemberIds = [
    ...quotaPolicy.customAllocations.map((allocation) => allocation.membershipId),
    ...quotaPolicy.memberQuotas.map((quota) => quota.membershipId),
  ];
  if (quotaMemberIds.length === 0 && quotaPolicy.pageQuotas.length === 0) return;
  try {
    await assertPaymentMethodReferenceForQuota(db, {
      vendorId,
      payerScope: quotaPolicy.quotaPayerScope,
      memberIds: quotaMemberIds,
    });
  } catch (error) {
    if (error instanceof PaymentMethodReferenceRequiredError) redirect(
      id
        ? `/lives/${encodeURIComponent(id)}/edit?error=payment_method_required`
        : `/lives/new?error=payment_method_required&draft=${encodeURIComponent(draftId)}`,
    );
    throw error;
  }
}

function hasInvalidLiveReferences(input: {
  liveMissing: boolean;
  productCount: number;
  expectedProductCount: number;
  videoMissing: boolean;
  formMissing: boolean;
  templateMissing: boolean;
  reminderTemplateMissing: boolean;
  scriptMissing: boolean;
  affiliateMissing: boolean;
  customMembershipMissing: boolean;
  quotaPageCount: number;
  expectedQuotaPageCount: number;
}) {
  return input.liveMissing
    || input.productCount !== input.expectedProductCount
    || input.videoMissing
    || input.formMissing
    || input.templateMissing
    || input.reminderTemplateMissing
    || input.scriptMissing
    || input.affiliateMissing
    || input.customMembershipMissing
    || input.quotaPageCount !== input.expectedQuotaPageCount;
}

function isMissingDefaultAffiliate(
  code: string | null,
  affiliate: { id: string } | null,
) {
  return code !== null && affiliate === null;
}

function optionalDraftReference(value: string) {
  return value ? value : null;
}

type LiveMutationData = {
  title: string;
  slug: string;
  description: string | null;
  scheduledAt: Date;
  status: string;
  videoId: string | null;
  formId: string | null;
  messageTemplateId: string | null;
  liveReminderTemplateId: string | null;
  liveReminderOffsetMinutes: number;
  interactionScriptId: string | null;
  heroImageUrl: string | null;
  heroImageAssetId: string | null;
  accentCopy: string | null;
  replayEnabled: boolean;
  streamMode: string;
  quotaPolicy: Prisma.InputJsonValue;
};

function parseLiveDraftClaim(formData: FormData, liveId: string | null) {
  const draftId = optionalText(formData, "liveDraftId");
  const revisionText = text(formData, "liveDraftRevision");
  const revision = /^\d{1,9}$/u.test(revisionText) ? Number.parseInt(revisionText, 10) : 0;
  const conflictPath = liveId
    ? `/lives/${encodeURIComponent(liveId)}/edit?error=draft_conflict`
    : `/lives/new?error=draft_conflict${draftId ? `&draft=${encodeURIComponent(draftId)}` : ""}`;
  if (!draftId || draftId.length > 128 || revision < 1) redirect(conflictPath);
  return { draftId, revision, conflictPath };
}

const liveStatusTransitions: Readonly<Record<string, ReadonlySet<string>>> = {
  draft: new Set(["draft", "scheduled"]),
  scheduled: new Set(["draft", "scheduled", "live"]),
  live: new Set(["live", "ended"]),
  ended: new Set(["draft", "ended", "scheduled"]),
};

function requestedLiveStatus(
  formData: FormData,
  liveId: string | null,
  draftId: string,
  currentStatus: string | null,
) {
  const status = text(formData, "status", "draft");
  const transitionAllowed = liveId
    ? Boolean(currentStatus && liveStatusTransitions[currentStatus]?.has(status))
    : status === "draft" || status === "scheduled";
  if (!transitionAllowed) {
    redirect(
      liveId
        ? `/lives/${encodeURIComponent(liveId)}/edit?error=invalid_status`
        : `/lives/new?error=invalid_status&draft=${encodeURIComponent(draftId)}`,
    );
  }
  return status;
}

async function commitLiveDraft(input: {
  db: PrismaClient;
  vendorId: string;
  liveId: string | null;
  draftId: string;
  revision: number;
  expectedDraftPayload: LiveStudioDraftPayload;
  data: LiveMutationData;
  productIds: string[];
  reminderReconciliationSnapshot: LiveReminderReconciliationSnapshot | null;
}) {
  const transitionAt = new Date();
  if (input.liveId) {
    return input.db.$transaction(async (tx) => {
      const claimedDraft = await tx.liveStudioDraft.updateMany({
        where: {
          id: input.draftId,
          vendorId: input.vendorId,
          liveId: input.liveId,
          revision: input.revision,
          payload: { equals: input.expectedDraftPayload as Prisma.InputJsonValue },
          consumedAt: null,
          expiresAt: { gt: transitionAt },
        },
        data: { revision: { increment: 1 } },
      });
      if (claimedDraft.count !== 1) return null;
      await tx.live.update({ where: { id: input.liveId!, vendorId: input.vendorId }, data: input.data });
      await tx.liveProduct.deleteMany({ where: { liveId: input.liveId! } });
      for (const [index, productId] of input.productIds.entries()) {
        await tx.liveProduct.create({
          data: { vendorId: input.vendorId, liveId: input.liveId!, productId, sortOrder: index + 1, isPinned: index === 0 },
        });
      }
      const reminderReconciliation = input.reminderReconciliationSnapshot
        ? await queueLiveReminderReconciliation(tx, input.reminderReconciliationSnapshot, transitionAt)
        : null;
      return {
        id: input.liveId!,
        created: false,
        reminderReconciliationStatus: reminderReconciliation?.status ?? null,
      };
    });
  }

  return input.db.$transaction(async (tx) => {
    const claimedDraft = await tx.liveStudioDraft.updateMany({
      where: {
        id: input.draftId,
        vendorId: input.vendorId,
        liveId: null,
        revision: input.revision,
        payload: { equals: input.expectedDraftPayload as Prisma.InputJsonValue },
        consumedAt: null,
        expiresAt: { gt: transitionAt },
      },
      data: { consumedAt: transitionAt },
    });
    if (claimedDraft.count !== 1) return null;
    const live = await tx.live.create({
      data: {
        ...input.data,
        vendorId: input.vendorId,
        products: {
          create: input.productIds.map((productId, index) => ({
            vendorId: input.vendorId,
            productId,
            sortOrder: index + 1,
            isPinned: index === 0,
          })),
        },
      },
    });
    return { id: live.id, created: true, reminderReconciliationStatus: null };
  });
}

function parseSubmittedLiveDraft(
  formData: FormData,
  liveId: string | null,
  draftId: string,
  vendorTimeZone: string,
) {
  const suffix = liveId ? "" : `&draft=${encodeURIComponent(draftId)}`;
  const invalidDraftPath = liveId
    ? `/lives/${encodeURIComponent(liveId)}/edit?error=invalid_draft`
    : `/lives/new?error=invalid_draft${suffix}`;
  let payload: LiveStudioDraftPayload;
  try {
    payload = liveStudioDraftFromFormData(formData, 4);
  } catch {
    redirect(invalidDraftPath);
  }
  const slug = toSlug(payload.slug);
  if (!payload.title || !slug || !payload.scheduledAt) {
    redirect(invalidDraftPath);
  }
  let scheduledAt: Date;
  try {
    scheduledAt = parseZonedDateTimeLocal(payload.scheduledAt, vendorTimeZone);
  } catch {
    redirect(invalidDraftPath);
  }
  return { payload, scheduledAt, slug, suffix };
}

function parseSubmittedLiveQuotaPolicy(
  payload: LiveStudioDraftPayload,
  liveId: string | null,
  createDraftSuffix: string,
) {
  try {
    return parseLiveQuotaPolicyForm({
      affiliateMode: payload.affiliateMode,
      defaultAffiliateCode: payload.defaultAffiliateCode || null,
      maxConcurrentViewers: Number.parseInt(payload.maxConcurrentViewers, 10),
      stopWhenCreditsBelow: Number.parseInt(payload.stopWhenCreditsBelow, 10),
      quotaPayerScope: payload.quotaPayerScope,
      usageAttributionMode: payload.usageAttributionMode,
      splitOwnerBps: Number.parseInt(payload.splitOwnerBps, 10),
      splitPromoterBps: Number.parseInt(payload.splitPromoterBps, 10),
      customAllocations: payload.customAllocations || null,
      memberQuotas: payload.memberQuotas || null,
      pageQuotas: payload.pageQuotas || null,
    });
  } catch (error) {
    if (error instanceof LiveQuotaPolicyValidationError) redirect(
      liveId
        ? `/lives/${encodeURIComponent(liveId)}/edit?error=invalid_policy`
        : `/lives/new?error=invalid_policy${createDraftSuffix}`,
    );
    throw error;
  }
}

async function resolveSubmittedLiveReferences(input: {
  db: PrismaClient;
  vendorId: string;
  liveId: string | null;
  productIds: string[];
  videoId: string | null;
  formId: string | null;
  messageTemplateId: string | null;
  liveReminderTemplateId: string | null;
  interactionScriptId: string | null;
  defaultAffiliateCode: string | null;
  heroImageAssetId: string | null;
  quotaPageIds: string[];
  invalidReferencePath: string;
}) {
  const [existingLive, products, video, registrationForm, messageTemplate, liveReminderTemplate, interactionScript, defaultAffiliate, heroImageAsset, quotaPages] = await Promise.all([
    input.liveId
      ? input.db.live.findFirst({
          where: { id: input.liveId, vendorId: input.vendorId },
          select: {
            id: true,
            title: true,
            status: true,
            scheduledAt: true,
            liveReminderTemplateId: true,
            liveReminderOffsetMinutes: true,
          },
        })
      : Promise.resolve(null),
    input.productIds.length > 0
      ? input.db.product.findMany({ where: { vendorId: input.vendorId, id: { in: input.productIds }, isActive: true, fulfillmentTypeConfirmed: true }, select: { id: true } })
      : Promise.resolve([]),
    input.videoId ? input.db.video.findFirst({ where: liveReadyVideoWhere(input.vendorId, input.videoId), select: { id: true } }) : Promise.resolve(null),
    input.formId ? input.db.registrationForm.findFirst({
      where: { id: input.formId, vendorId: input.vendorId, isActive: true },
      select: { id: true, fields: true },
    }) : Promise.resolve(null),
    input.messageTemplateId ? input.db.messageTemplate.findFirst({
      where: {
        id: input.messageTemplateId,
        vendorId: input.vendorId,
        ...REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
      },
      select: { id: true, subject: true, body: true },
    }) : Promise.resolve(null),
    input.liveReminderTemplateId ? input.db.messageTemplate.findFirst({
      where: {
        id: input.liveReminderTemplateId,
        vendorId: input.vendorId,
        ...LIVE_REMINDER_EMAIL_TEMPLATE_WHERE,
      },
      select: {
        id: true,
        vendorId: true,
        channel: true,
        trigger: true,
        subject: true,
        body: true,
        isActive: true,
        updatedAt: true,
      },
    }) : Promise.resolve(null),
    input.interactionScriptId ? input.db.interactionScript.findFirst({ where: { id: input.interactionScriptId, vendorId: input.vendorId, status: "published" }, select: { id: true } }) : Promise.resolve(null),
    input.defaultAffiliateCode ? input.db.affiliate.findFirst({
      where: { vendorId: input.vendorId, code: input.defaultAffiliateCode, isActive: true },
      select: { id: true },
    }) : Promise.resolve(null),
    resolveReadyImageAsset(input.db, { vendorId: input.vendorId, assetId: input.heroImageAssetId })
      .catch(() => redirect(input.invalidReferencePath)),
    input.quotaPageIds.length > 0
      ? input.db.partnerFunnelPage.findMany({ where: { vendorId: input.vendorId, id: { in: input.quotaPageIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  return { existingLive, products, video, registrationForm, messageTemplate, liveReminderTemplate, interactionScript, defaultAffiliate, heroImageAsset, quotaPages };
}

function requireSubmittedLivePublishReadiness(input: {
  liveId: string | null;
  draftId: string;
  requestedStatus: string;
  replayEnabled: boolean;
  studioPreset: LiveStudioDraftPayload["studioPreset"];
  productCount: number;
  productsReady: boolean;
  videoReady: boolean;
  registrationFormFields: unknown;
  registrationEmail: { subject: string | null; body: string } | null;
  liveReminderEmail: { subject: string | null; body: string } | null;
  interactionScriptReady: boolean;
}) {
  const readiness = getLivePublishReadiness({
    studioPreset: input.studioPreset,
    productCount: input.productCount,
    productsReady: input.productsReady,
    videoReady: input.videoReady,
    formReady: parseRegistrationFormFields(input.registrationFormFields).success,
    registrationEmailReady: Boolean(input.registrationEmail && hasUsableMessageTemplateContent(input.registrationEmail)),
    liveReminderEmailReady: Boolean(input.liveReminderEmail && hasUsableMessageTemplateContent(input.liveReminderEmail)),
    interactionScriptReady: input.interactionScriptReady,
  });
  if (!requiresLivePublishReadiness(input.requestedStatus, input.replayEnabled) || readiness.ready) return;
  redirect(
    input.liveId
      ? `/lives/${encodeURIComponent(input.liveId)}/edit?error=publish_not_ready`
      : `/lives/new?error=publish_not_ready&draft=${encodeURIComponent(input.draftId)}`,
  );
}

function liveReminderSnapshotAfterUpdate(input: {
  vendorId: string;
  liveId: string | null;
  existingLive: {
    title: string;
    status: string;
    scheduledAt: Date;
    liveReminderTemplateId: string | null;
    liveReminderOffsetMinutes: number;
  } | null;
  requestedTitle: string;
  requestedStatus: string;
  scheduledAt: Date;
  reminderOffsetMinutes: number;
  template: LiveReminderTemplateSnapshot | null;
}) {
  const existing = input.existingLive;
  if (!input.liveId || !existing) return null;
  const previousActive = ["scheduled", "live"].includes(existing.status);
  const nextActive = ["scheduled", "live"].includes(input.requestedStatus);
  const templateId = input.template?.id ?? null;
  const changed = existing.title !== input.requestedTitle
    || existing.scheduledAt.getTime() !== input.scheduledAt.getTime()
    || existing.liveReminderTemplateId !== templateId
    || existing.liveReminderOffsetMinutes !== input.reminderOffsetMinutes
    || (previousActive !== nextActive && (existing.liveReminderTemplateId !== null || templateId !== null));
  if (!changed) return null;
  return createLiveReminderReconciliationSnapshot({
    vendorId: input.vendorId,
    liveId: input.liveId,
    liveTitle: input.requestedTitle,
    liveStatus: input.requestedStatus,
    scheduledAt: input.scheduledAt,
    reminderOffsetMinutes: input.reminderOffsetMinutes,
    template: input.template,
  });
}

function liveReminderReconciliationNotice(status: string | null) {
  if (!status) return null;
  return ["cancelled", "reused_cancelled"].includes(status)
    ? "reminders_cancelled"
    : "reminders_reconciling";
}

export async function upsertLiveAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const draftClaim = parseLiveDraftClaim(formData, id);
  const parsedSubmission = parseSubmittedLiveDraft(formData, id, draftClaim.draftId, vendor.timezone);
  const submittedDraft = parsedSubmission.payload;
  const scheduledAt = parsedSubmission.scheduledAt;
  const createDraftSuffix = parsedSubmission.suffix;
  const rawProductIds = submittedDraft.productIds;
  const productIds = [...new Set(rawProductIds.map((productId) => productId.trim()).filter(Boolean))];
  const videoId = optionalDraftReference(submittedDraft.videoId);
  const formId = optionalDraftReference(submittedDraft.formId);
  const messageTemplateId = optionalDraftReference(submittedDraft.messageTemplateId);
  const liveReminderTemplateId = optionalDraftReference(submittedDraft.liveReminderTemplateId);
  const interactionScriptId = optionalDraftReference(submittedDraft.interactionScriptId);
  const heroImageAssetId = optionalDraftReference(submittedDraft.heroImageAssetId);
  const quotaPolicy = parseSubmittedLiveQuotaPolicy(submittedDraft, id, createDraftSuffix);
  const invalidReferencePath = id
    ? `/lives/${encodeURIComponent(id)}/edit?error=invalid_reference`
    : `/lives/new?error=invalid_reference${createDraftSuffix}`;
  const referenceIds = [id, videoId, formId, messageTemplateId, liveReminderTemplateId, interactionScriptId, heroImageAssetId, ...productIds].filter(
    (value): value is string => value !== null,
  );
  if (productIds.length > 100 || rawProductIds.length !== productIds.length || referenceIds.some((value) => value.length > 128)) {
    redirect(invalidReferencePath);
  }
  const db = getDb();
  const quotaMembershipIds = [
    ...quotaPolicy.customAllocations.map((allocation) => allocation.membershipId),
    ...quotaPolicy.memberQuotas.map((quota) => quota.membershipId),
  ];
  const quotaPageIds = quotaPolicy.pageQuotas.map((quota) => quota.pageId);
  const references = await resolveSubmittedLiveReferences({
    db,
    vendorId: vendor.id,
    liveId: id,
    productIds,
    videoId,
    formId,
    messageTemplateId,
    liveReminderTemplateId,
    interactionScriptId,
    defaultAffiliateCode: quotaPolicy.defaultAffiliateCode,
    heroImageAssetId,
    quotaPageIds,
    invalidReferencePath,
  });
  const {
    existingLive,
    products,
    video,
    registrationForm,
    messageTemplate,
    liveReminderTemplate,
    interactionScript,
    defaultAffiliate,
    heroImageAsset,
    quotaPages,
  } = references;
  const customMemberships = quotaMembershipIds.length > 0
    ? await db.teamMembership.findMany({
        where: {
          vendorId: vendor.id,
          id: { in: [...new Set(quotaMembershipIds)] },
          status: "ACTIVE",
          leftAt: null,
        },
        select: { id: true, teamId: true },
      })
    : [];
  const membershipKeys = new Set(customMemberships.map((membership) => `${membership.teamId}:${membership.id}`));
  const hasInvalidCustomMembership = quotaPolicy.customAllocations.some(
    (allocation) => !membershipKeys.has(`${allocation.teamId}:${allocation.membershipId}`),
  );
  const hasInvalidMemberQuota = quotaPolicy.memberQuotas.some(
    (quota) => !membershipKeys.has(`${quota.teamId}:${quota.membershipId}`),
  );
  const hasInvalidReference = hasInvalidLiveReferences({
    liveMissing: id !== null && !existingLive,
    productCount: products.length,
    expectedProductCount: productIds.length,
    videoMissing: videoId !== null && !video,
    formMissing: formId !== null && !registrationForm,
    templateMissing: messageTemplateId !== null && !messageTemplate,
    reminderTemplateMissing: liveReminderTemplateId !== null && !liveReminderTemplate,
    scriptMissing: interactionScriptId !== null && !interactionScript,
    affiliateMissing: isMissingDefaultAffiliate(quotaPolicy.defaultAffiliateCode, defaultAffiliate),
    customMembershipMissing: hasInvalidCustomMembership || hasInvalidMemberQuota,
    quotaPageCount: quotaPages.length,
    expectedQuotaPageCount: new Set(quotaPageIds).size,
  });
  if (hasInvalidReference) {
    redirect(invalidReferencePath);
  }
  await requireLiveQuotaPaymentMethod(db, vendor.id, quotaPolicy, id, draftClaim.draftId);
  const requestedStatus = requestedLiveStatus(formData, id, draftClaim.draftId, existingLive?.status ?? null);
  requireSubmittedLivePublishReadiness({
    liveId: id,
    draftId: draftClaim.draftId,
    requestedStatus,
    replayEnabled: submittedDraft.replayEnabled,
    studioPreset: submittedDraft.studioPreset,
    productCount: productIds.length,
    productsReady: products.length === productIds.length,
    videoReady: Boolean(video),
    registrationFormFields: registrationForm?.fields,
    registrationEmail: messageTemplate,
    liveReminderEmail: liveReminderTemplate,
    interactionScriptReady: Boolean(interactionScript),
  });
  let heroImageUrl;
  try {
    heroImageUrl = heroImageAsset?.publicUrl ?? safeExternalUrl(submittedDraft.heroImageUrl || null, "直播主視覺網址");
  } catch {
    redirect(invalidReferencePath);
  }
  const data = {
    title: submittedDraft.title,
    slug: parsedSubmission.slug,
    description: submittedDraft.description || null,
    scheduledAt,
    status: requestedStatus,
    videoId,
    formId,
    messageTemplateId,
    liveReminderTemplateId,
    liveReminderOffsetMinutes: Number(submittedDraft.liveReminderOffsetMinutes),
    interactionScriptId,
    heroImageUrl,
    heroImageAssetId: heroImageAsset?.id ?? null,
    accentCopy: submittedDraft.accentCopy || null,
    replayEnabled: submittedDraft.replayEnabled,
    streamMode: submittedDraft.streamMode,
    quotaPolicy: quotaPolicy as Prisma.InputJsonValue,
  };

  const reminderReconciliationSnapshot = liveReminderSnapshotAfterUpdate({
    vendorId: vendor.id,
    liveId: id,
    existingLive,
    requestedTitle: data.title,
    requestedStatus,
    scheduledAt,
    reminderOffsetMinutes: data.liveReminderOffsetMinutes,
    template: liveReminderTemplate,
  });

  const committed = await commitLiveDraft({
    db,
    vendorId: vendor.id,
    liveId: id,
    draftId: draftClaim.draftId,
    revision: draftClaim.revision,
    expectedDraftPayload: submittedDraft,
    data,
    productIds,
    reminderReconciliationSnapshot,
  });
  if (!committed) redirect(draftClaim.conflictPath);
  if (committed.created) redirect(`/lives/${committed.id}/preview`);
  const reconciliationNotice = liveReminderReconciliationNotice(committed.reminderReconciliationStatus);
  redirect(`/lives/${committed.id}/edit${reconciliationNotice ? `?notice=${reconciliationNotice}` : ""}`);
}

export type InteractionRoleFormValues = {
  id: string;
  name: string;
  avatarUrl: string;
  avatarAssetId: string;
  avatarMode: InteractionRoleAvatarMode | "";
  avatarUploadPhase: string;
  label: string;
  roleType: string;
  tone: string;
  isActive: boolean;
  isScheduled: boolean;
};

export type InteractionRoleActionState = {
  status: "idle" | "error";
  message: string;
  values: InteractionRoleFormValues;
};

export const initialInteractionRoleActionState: InteractionRoleActionState = {
  status: "idle",
  message: "",
  values: {
    id: "",
    name: "",
    avatarUrl: "",
    avatarAssetId: "",
    avatarMode: "",
    avatarUploadPhase: "",
    label: "",
    roleType: "official",
    tone: "",
    isActive: true,
    isScheduled: false,
  },
};

class InteractionRoleInputError extends Error {}
class InteractionRoleMissingError extends Error {}

function boundedInteractionRoleValue(formData: FormData, key: string, maximum: number) {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function submittedInteractionRoleMode(formData: FormData): string {
  const avatarMode = text(formData, "avatarMode");
  const legacyMode = text(formData, "mode");
  if (avatarMode && legacyMode && avatarMode !== legacyMode) {
    throw new InteractionRoleInputError("頭像模式無效。");
  }
  return avatarMode || legacyMode;
}

function submittedInteractionRoleUploadPhase(formData: FormData) {
  const value = formData.get("avatarUploadPhase");
  return value === null ? "" : typeof value === "string" ? value.trim() : "__invalid__";
}

function submittedInteractionRoleValues(formData: FormData): InteractionRoleFormValues {
  const rawAvatarUrl = boundedInteractionRoleValue(formData, "avatarUrl", 2_048).trim();
  const avatarUrl = parseSafeExternalHttpUrl(rawAvatarUrl) ?? "";
  const avatarMode = text(formData, "avatarMode");
  const legacyMode = text(formData, "mode");
  const mode = avatarMode && legacyMode && avatarMode !== legacyMode ? "" : avatarMode || legacyMode;
  return {
    id: boundedInteractionRoleValue(formData, "id", 128),
    name: boundedInteractionRoleValue(formData, "name", 160),
    avatarUrl,
    avatarAssetId: boundedInteractionRoleValue(formData, "avatarAssetId", 128),
    avatarMode: (INTERACTION_ROLE_AVATAR_MODES as readonly string[]).includes(mode)
      ? mode as InteractionRoleAvatarMode
      : "",
    avatarUploadPhase: boundedInteractionRoleValue(formData, "avatarUploadPhase", 32),
    label: boundedInteractionRoleValue(formData, "label", 80),
    roleType: boundedInteractionRoleValue(formData, "roleType", 64),
    tone: boundedInteractionRoleValue(formData, "tone", 500),
    isActive: parseInteractionRoleBoolean(formData.get("isActive")),
    isScheduled: parseInteractionRoleBoolean(formData.get("isScheduled")),
  };
}

async function resolveInteractionRoleAvatar(vendorId: string, formData: FormData) {
  const rawAvatarUrl = optionalText(formData, "avatarUrl") ?? "";
  const avatarModeValue = submittedInteractionRoleMode(formData);
  const avatarUploadPhase = submittedInteractionRoleUploadPhase(formData);
  const hasExplicitMode = avatarModeValue !== "";
  const avatarAssetIdValue = formData.get("avatarAssetId");
  if (avatarAssetIdValue !== null && typeof avatarAssetIdValue !== "string") {
    throw new InteractionRoleInputError("角色頭像圖片資產無效，請重新上傳。");
  }
  const avatarAssetId = typeof avatarAssetIdValue === "string" ? avatarAssetIdValue.trim() || null : null;

  if (hasExplicitMode && !(INTERACTION_ROLE_AVATAR_MODES as readonly string[]).includes(avatarModeValue)) {
    throw new InteractionRoleInputError("頭像模式無效。");
  }
  const avatarMode = hasExplicitMode ? avatarModeValue as InteractionRoleAvatarMode : null;

  if (avatarMode === "preset") {
    if (avatarAssetId || (avatarUploadPhase && avatarUploadPhase !== "idle")) {
      throw new InteractionRoleInputError("預設頭像模式無效。");
    }
    if (!isCanonicalInteractionRolePresetUrl(rawAvatarUrl)) {
      throw new InteractionRoleInputError("預設頭像不受支援。");
    }
    return rawAvatarUrl;
  }

  if (avatarMode === "custom" || avatarAssetId) {
    if (!(["", "idle", "success"] as const).includes(avatarUploadPhase as "" | "idle" | "success")) {
      throw new InteractionRoleInputError("自訂頭像上傳狀態無效。");
    }
    if (avatarAssetId) {
      if (avatarUploadPhase !== "success") {
        throw new InteractionRoleInputError("自訂頭像上傳尚未完成。");
      }
      let asset;
      try {
        asset = await resolveReadyImageAsset(getDb(), { vendorId, assetId: avatarAssetId });
      } catch (error) {
        if (error instanceof ImageAssetReferenceError) {
          throw new InteractionRoleInputError("角色頭像圖片資產無效，請重新上傳。");
        }
        throw error;
      }
      return asset?.publicUrl ?? null;
    }
    if (avatarUploadPhase === "success") {
      throw new InteractionRoleInputError("自訂頭像上傳尚未完成。");
    }
  }

  const safeAvatarUrl = rawAvatarUrl ? parseSafeExternalHttpUrl(rawAvatarUrl) : null;
  if (rawAvatarUrl && !safeAvatarUrl) throw new InteractionRoleInputError("角色頭像必須是安全的 HTTP 或 HTTPS 完整網址。");
  return safeAvatarUrl;
}

async function persistInteractionRole(input: {
  vendorId: string;
  id: string | null;
  data: NormalizedInteractionRole;
}) {
  try {
    return input.id
      ? await getDb().interactionRole.update({ where: { id: input.id, vendorId: input.vendorId }, data: input.data })
      : await getDb().interactionRole.create({ data: { ...input.data, vendorId: input.vendorId } });
  } catch (error) {
    if (isRecordNotFoundError(error)) throw new InteractionRoleMissingError();
    throw error;
  }
}

function interactionRoleAuditData(data: {
  roleType: string;
  isActive: boolean;
  isScheduled: boolean;
  avatarUrl: string | null;
}) {
  return auditSnapshot({
    roleType: data.roleType,
    isActive: data.isActive,
    isScheduled: data.isScheduled,
    hasAvatar: Boolean(data.avatarUrl),
  });
}

async function persistAndAuditInteractionRole(input: {
  vendorId: string;
  auth: Awaited<ReturnType<typeof requireVendorManagerContext>>["auth"];
  id: string | null;
  data: NormalizedInteractionRole;
}) {
  const role = await persistInteractionRole(input);
  await writeAuditLog({
    vendorId: input.vendorId,
    ...managerAuditIdentity(input.auth),
    action: input.id ? "interaction_role_updated" : "interaction_role_created",
    targetType: "InteractionRole",
    targetId: role.id,
    after: interactionRoleAuditData(input.data),
  });
  return role;
}

async function normalizedInteractionRoleData(vendorId: string, formData: FormData) {
  const id = optionalText(formData, "id");
  if (id && id.length > 128) throw new InteractionRoleInputError("角色識別碼無效。");
  const avatarUrl = await resolveInteractionRoleAvatar(vendorId, formData);
  const avatarModeValue = submittedInteractionRoleMode(formData);
  const validation = normalizeInteractionRoleDraft({
    name: text(formData, "name"),
    avatarUrl,
    avatarMode: avatarModeValue === "preset" ? "preset" : null,
    label: optionalText(formData, "label"),
    roleType: text(formData, "roleType", "official"),
    tone: optionalText(formData, "tone"),
    isActive: parseInteractionRoleBoolean(formData.get("isActive")),
    isScheduled: parseInteractionRoleBoolean(formData.get("isScheduled")),
  });
  if (!validation.success) throw new InteractionRoleInputError(validation.error);
  return validation.data;
}

export async function upsertInteractionRoleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const id = optionalText(formData, "id");
  const invalidRolePath = id
    ? `/interaction-roles/${encodeURIComponent(id)}/edit?error=invalid_role`
    : "/interaction-roles/new?error=invalid_role";
  if (id && id.length > 128) redirect("/interaction-roles/new?error=invalid_role");

  let data;
  try {
    data = await normalizedInteractionRoleData(vendor.id, formData);
    await persistAndAuditInteractionRole({ vendorId: vendor.id, auth, id, data });
  } catch (error) {
    if (error instanceof InteractionRoleInputError) redirect(invalidRolePath);
    if (error instanceof ImageAssetReferenceError) redirect(invalidRolePath);
    if (error instanceof InteractionRoleMissingError) redirect("/interaction-roles/new?error=missing_role");
    throw error;
  }

  redirect("/interaction-roles");
}

export async function upsertInteractionRoleActionState(
  _previousState: InteractionRoleActionState,
  formData: FormData,
): Promise<InteractionRoleActionState> {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const values = submittedInteractionRoleValues(formData);
  try {
    const data = await normalizedInteractionRoleData(vendor.id, formData);
    await persistAndAuditInteractionRole({ vendorId: vendor.id, auth, id: optionalText(formData, "id"), data });
  } catch (error) {
    if (error instanceof InteractionRoleInputError) {
      return { status: "error", message: error.message, values };
    }
    if (error instanceof ImageAssetReferenceError) {
      return {
        status: "error",
        message: "角色頭像圖片資產無效，請重新上傳。",
        values,
      };
    }
    if (error instanceof InteractionRoleMissingError) {
      return { status: "error", message: "這個角色已不存在或不屬於目前商店。", values };
    }
    throw error;
  }

  redirect("/interaction-roles");
}

export async function deleteInteractionRoleAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const id = text(formData, "id");
  if (!id || id.length > 128) redirect("/interaction-roles/new?error=invalid_role");
  const role = await (async () => {
    try {
      return await getDb().interactionRole.delete({
        where: { id, vendorId: vendor.id },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        redirect("/interaction-roles/new?error=missing_role");
      }
      throw error;
    }
  })();
  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: "interaction_role_deleted",
    targetType: "InteractionRole",
    targetId: role.id,
    before: auditSnapshot({
      name: role.name,
      label: role.label,
      roleType: role.roleType,
      isActive: role.isActive,
    }),
  });
  redirect("/interaction-roles/new");
}

function roleAvatar(seed: string) {
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&radius=18`;
}

const systemRoleLibrary = [
  { name: "開場 AI 主持人", label: "官方角色", roleType: "official", tone: "熱情但不吵，負責歡迎、提醒流程與整理重點", avatarUrl: roleAvatar("host-blue"), isScheduled: true },
  { name: "官方商品顧問", label: "官方角色", roleType: "official", tone: "清楚說明商品差異、價格與適合族群", avatarUrl: roleAvatar("advisor-cyan"), isScheduled: true },
  { name: "優惠提醒助手", label: "官方角色", roleType: "official", tone: "在關鍵節點提醒限時優惠與表單，不過度催促", avatarUrl: roleAvatar("reminder-rose"), isScheduled: true },
  { name: "客服 Q&A 助手", label: "官方角色", roleType: "official", tone: "簡短回答常見問題，引導私訊或表單", avatarUrl: roleAvatar("qa-indigo"), isScheduled: true },
  { name: "保養知識顧問", label: "官方角色", roleType: "official", tone: "用生活化方式補充使用情境與注意事項", avatarUrl: roleAvatar("care-teal"), isScheduled: true },
  { name: "成交節奏助手", label: "官方角色", roleType: "official", tone: "在商品浮出時整理賣點與 CTA", avatarUrl: roleAvatar("sales-amber"), isScheduled: true },
  { name: "直播小編", label: "官方角色", roleType: "official", tone: "像品牌小編一樣親切補充直播資訊", avatarUrl: roleAvatar("editor-purple"), isScheduled: true },
  { name: "提醒通知助手", label: "官方角色", roleType: "official", tone: "提醒報名、優惠到期、庫存與下一段重點", avatarUrl: roleAvatar("assistant-lime"), isScheduled: true },
  { name: "售後關懷助手", label: "官方角色", roleType: "official", tone: "說明出貨、保固、退換貨與客服入口", avatarUrl: roleAvatar("support-green"), isScheduled: true },
  { name: "限時活動主持", label: "官方角色", roleType: "official", tone: "在促銷段落帶節奏，強調活動時間與組合價值", avatarUrl: roleAvatar("promo-red"), isScheduled: true },
];

export async function importSystemRolesAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const db = getDb();
  const existing = await db.interactionRole.findMany({
    where: {
      vendorId: vendor.id,
      name: { in: systemRoleLibrary.map((role) => role.name) },
    },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((role) => role.name));

  const imported = await db.interactionRole.createMany({
    data: systemRoleLibrary
      .filter((role) => !existingNames.has(role.name))
      .map((role) => ({ ...role, vendorId: vendor.id, isActive: true, isScheduled: true })),
  });

  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: "interaction_role_library_imported",
    targetType: "InteractionRole",
    targetId: vendor.id,
    after: auditSnapshot({ requestedCount: systemRoleLibrary.length, importedCount: imported.count }),
  });

  revalidatePath("/interaction-roles");
  redirect("/interaction-roles");
}

export async function upsertInteractionScriptAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const id = optionalText(formData, "id");
  const db = getDb();
  const roleIds = formData.getAll("roleId").map(String);
  const eventTypes = formData.getAll("eventType").map(String);
  const parsedTriggerSecs = formData.getAll("triggerSec").map((value) => parseInteractionTriggerSeconds(String(value)));
  const titles = formData.getAll("eventTitle").map(String);
  const messages = formData.getAll("message").map(String);
  const productIds = formData.getAll("productId").map(String);
  const ctaLabels = formData.getAll("ctaLabel").map(String);
  const ctaUrls = formData.getAll("ctaUrl").map(String);
  const invalidEventPath = id
    ? `/interaction-scripts/${encodeURIComponent(id)}/edit?error=invalid_event`
    : "/interaction-scripts/new?error=invalid_event";

  if (eventTypes.length > 200) {
    redirect(invalidEventPath);
  }
  if (eventTypes.length === 0 || [roleIds, titles, messages, productIds, ctaLabels, ctaUrls]
    .some((column) => column.length !== eventTypes.length)) {
    redirect(invalidEventPath);
  }
  if (parsedTriggerSecs.length !== eventTypes.length || parsedTriggerSecs.some((triggerSec) => triggerSec === null)) {
    redirect(invalidEventPath);
  }
  const triggerSecs = parsedTriggerSecs.map((triggerSec) => {
    if (triggerSec === null) redirect(invalidEventPath);
    return triggerSec;
  });

  const eventResults = eventTypes.map((eventType, index) => normalizeInteractionEventDraft({
      eventType,
      triggerSec: triggerSecs[index],
      title: titles[index],
      message: messages[index],
      productId: productIds[index],
      ctaLabel: ctaLabels[index],
      ctaUrl: ctaUrls[index],
      roleId: roleIds[index],
    }, index));
  if (eventResults.some((result) => !result.success)) redirect(invalidEventPath);
  const events = eventResults.flatMap((result) => result.success ? [result.data] : []);

  const referencedRoleIds = [...new Set(events.flatMap((event) => event.roleId ? [event.roleId] : []))];
  const referencedProductIds = [...new Set(events.flatMap((event) => event.productId ? [event.productId] : []))];
  const invalidReferencePath = id
    ? `/interaction-scripts/${encodeURIComponent(id)}/edit?error=invalid_reference`
    : "/interaction-scripts/new?error=invalid_reference";
  if ([id, ...referencedRoleIds, ...referencedProductIds].some((value) => value && value.length > 128)) {
    redirect(invalidReferencePath);
  }
  const [referencedRoles, referencedProducts] = await Promise.all([
    referencedRoleIds.length > 0
      ? db.interactionRole.findMany({
          where: { vendorId: vendor.id, id: { in: referencedRoleIds }, isActive: true },
          select: { id: true },
        })
      : Promise.resolve([]),
    referencedProductIds.length > 0
      ? db.product.findMany({
          where: { vendorId: vendor.id, id: { in: referencedProductIds }, isActive: true, fulfillmentTypeConfirmed: true },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  if (referencedRoles.length !== referencedRoleIds.length || referencedProducts.length !== referencedProductIds.length) {
    redirect(invalidReferencePath);
  }

  const name = text(formData, "name");
  const description = optionalText(formData, "description");
  const status = text(formData, "status", "draft");
  if (!name || name.length > 160 || (description?.length ?? 0) > 1_000 || (status !== "draft" && status !== "published")) {
    redirect(invalidEventPath);
  }
  const data = { name, description, status };

  let scriptId = id;
  if (id) {
    try {
      await db.$transaction([
        db.interactionScript.update({ where: { id, vendorId: vendor.id }, data }),
        db.interactionEvent.deleteMany({ where: { scriptId: id } }),
        ...events.map((event) => db.interactionEvent.create({ data: { ...event, scriptId: id } })),
      ]);
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        redirect("/interaction-scripts?error=missing_script");
      }
      throw error;
    }
  } else {
    const script = await db.interactionScript.create({
      data: {
        ...data,
        vendorId: vendor.id,
        events: { create: events },
      },
    });
    scriptId = script.id;
  }

  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: id ? "interaction_script_updated" : "interaction_script_created",
    targetType: "InteractionScript",
    targetId: scriptId,
    after: auditSnapshot({ name, status, eventCount: events.length }),
  });

  redirect("/interaction-scripts");
}

export async function unbindInteractionScriptFromLiveAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const scriptId = text(formData, "id");
  const liveId = text(formData, "liveId");

  if (!scriptId || !liveId || scriptId.length > 128 || liveId.length > 128) {
    throw new Error("直播不存在或未綁定此互動腳本。");
  }

  const updateResult = await getDb().live.updateMany({
    where: {
      id: liveId,
      vendorId: vendor.id,
      interactionScriptId: scriptId,
      interactionScript: { is: { id: scriptId, vendorId: vendor.id } },
    },
    data: { interactionScriptId: null },
  });

  if (updateResult.count !== 1) {
    throw new Error("直播不存在或未綁定此互動腳本。");
  }

  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: "interaction_script_unbound_from_live",
    targetType: "Live",
    targetId: liveId,
    before: auditSnapshot({ interactionScriptId: scriptId }),
    after: auditSnapshot({ interactionScriptId: null }),
  });

  revalidatePath("/interaction-scripts");
  revalidatePath(`/interaction-scripts/${scriptId}/edit`);
  revalidatePath("/lives");
  revalidatePath(`/lives/${liveId}/edit`);
}

export async function duplicateInteractionScriptAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const id = text(formData, "id");
  if (!id || id.length > 128) redirect("/interaction-scripts");
  const db = getDb();
  const script = await db.interactionScript.findFirst({
    where: { id, vendorId: vendor.id },
    include: { events: { orderBy: { triggerSec: "asc" } } },
  });
  if (!script) {
    redirect("/interaction-scripts");
  }

  const eventResults = script.events.map((event, index) => normalizeInteractionEventDraft({
    eventType: event.eventType,
    triggerSec: event.triggerSec,
    title: event.title,
    message: event.message,
    productId: event.productId,
    ctaLabel: event.ctaLabel,
    ctaUrl: event.ctaUrl,
    roleId: event.roleId,
  }, index));
  if (eventResults.some((result) => !result.success)) {
    redirect("/interaction-scripts?error=invalid_event");
  }
  const normalizedEvents = eventResults.flatMap((result) => result.success ? [result.data] : []);
  const referencedRoleIds = [...new Set(normalizedEvents.flatMap((event) => event.roleId ? [event.roleId] : []))];
  const referencedProductIds = [...new Set(normalizedEvents.flatMap((event) => event.productId ? [event.productId] : []))];
  const [referencedRoles, referencedProducts] = await Promise.all([
    referencedRoleIds.length > 0
      ? db.interactionRole.findMany({
          where: { vendorId: vendor.id, id: { in: referencedRoleIds }, isActive: true },
          select: { id: true },
        })
      : Promise.resolve([]),
    referencedProductIds.length > 0
      ? db.product.findMany({
          where: { vendorId: vendor.id, id: { in: referencedProductIds }, isActive: true },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  if (referencedRoles.length !== referencedRoleIds.length || referencedProducts.length !== referencedProductIds.length) {
    redirect("/interaction-scripts?error=invalid_reference");
  }
  const duplicateNameSuffix = " 複本";
  const duplicateName = `${script.name.slice(0, 160 - duplicateNameSuffix.length)}${duplicateNameSuffix}`;

  const duplicate = await db.interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: duplicateName,
      description: script.description,
      status: "draft",
      events: {
        create: normalizedEvents.map((event, index) => ({
          eventType: event.eventType,
          triggerSec: event.triggerSec,
          title: event.title,
          message: event.message,
          productId: event.productId,
          ctaLabel: event.ctaLabel,
          ctaUrl: event.ctaUrl,
          roleId: event.roleId,
          metadata: script.events[index]?.metadata as Prisma.InputJsonValue,
        })),
      },
    },
  });

  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: "interaction_script_duplicated",
    targetType: "InteractionScript",
    targetId: duplicate.id,
    after: auditSnapshot({ sourceScriptId: script.id, name: duplicateName, status: "draft", eventCount: normalizedEvents.length }),
  });

  revalidatePath("/interaction-scripts");
  redirect("/interaction-scripts");
}

export async function deleteInteractionScriptAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const auditActor = managerAuditIdentity(auth);
  const id = text(formData, "id");
  if (!id || id.length > 128) redirect("/interaction-scripts");
  const script = await (async () => {
    try {
      return await getDb().interactionScript.delete({
        where: { id, vendorId: vendor.id },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        redirect("/interaction-scripts?error=missing_script");
      }
      throw error;
    }
  })();
  await writeAuditLog({
    vendorId: vendor.id,
    ...auditActor,
    action: "interaction_script_deleted",
    targetType: "InteractionScript",
    targetId: script.id,
    before: auditSnapshot({ name: script.name, status: script.status }),
  });
  revalidatePath("/interaction-scripts");
  redirect("/interaction-scripts");
}

export async function upsertBlacklistAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const identifierType = BlacklistIdentifierType.safeParse(text(formData, "identifierType", "email"));
  const identifier = identifierType.success
    ? normalizeBlacklistIdentifier(identifierType.data, text(formData, "identifier"))
    : null;
  if (!identifierType.success || !identifier) {
    redirect("/blacklists?error=invalid_identifier");
  }
  await getDb().blacklist.create({
    data: {
      vendorId: vendor.id,
      identifier,
      identifierType: identifierType.data,
      reason: text(formData, "reason"),
      notes: optionalText(formData, "notes"),
    },
  });
  revalidatePath("/blacklists");
}

export async function unblockBlacklistAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = text(formData, "id");
  await getDb().blacklist.update({
    where: { id, vendorId: vendor.id },
    data: {
      isActive: false,
      unblockedAt: new Date(),
    },
  });
  revalidatePath("/blacklists");
}

export async function upsertAffiliateAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const commissionRate = AffiliateCommissionRateBps.safeParse(
    Number(text(formData, "commissionRateBps")),
  );
  if (!commissionRate.success) {
    redirect("/affiliates?error=invalid_commission_rate");
  }
  const data = {
    name: text(formData, "name"),
    code: text(formData, "code").toUpperCase(),
    source: optionalText(formData, "source"),
    contactEmail: optionalText(formData, "contactEmail"),
    commissionRateBps: commissionRate.data,
    isActive: formData.get("isActive") === "on",
  };

  if (id) {
    await getDb().affiliate.update({ where: { id, vendorId: vendor.id }, data });
  } else {
    await getDb().affiliate.create({ data: { ...data, vendorId: vendor.id } });
  }

  redirect("/affiliates");
}

export async function generateSettlementAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const vendorId = text(formData, "vendorId");
  const monthKey = text(formData, "monthKey");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    redirect("/admin/billing/settlements?error=missing");
  }

  let result;
  try {
    result = await generateSettlementForVendor(vendorId, monthKey);
  } catch (error) {
    if (error instanceof BillingCycleError) {
      if (error.code === "locked") redirect("/admin/billing/settlements?error=locked");
      if (error.code === "negative_payout") redirect("/admin/billing/settlements?error=negative_payout");
      if (error.code === "terminal_invoice_amount_conflict") redirect("/admin/billing/settlements?error=invoice_conflict");
      if (error.code === "conflict") redirect("/admin/billing/settlements?error=conflict");
      redirect("/admin/billing/settlements?error=missing");
    }
    if (error instanceof SettlementMutationConflict || isSettlementMutationConflict(error)) {
      redirect("/admin/billing/settlements?error=conflict");
    }
    throw error;
  }

  await writeAuditLog({
    vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "generate_settlement",
    targetType: "Settlement",
    targetId: result.settlement.id,
    before: auditSnapshot(result.existingSettlement),
    after: auditSnapshot({ settlement: result.settlement, calculation: result.calculation, invoice: result.invoice }),
  });

  revalidatePath("/admin/billing/settlements");
  revalidatePath("/billing/settlements");
  revalidatePath("/billing/invoices");
  redirect("/admin/billing/settlements");
}

export async function updateSettlementAdjustmentAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const adjustmentAmountCents = moneyToCents(formData, "adjustmentAmount");
  const adjustmentReason = optionalText(formData, "adjustmentReason");
  const settlement = await getDb().settlement.findUnique({ where: { id } });
  if (!settlement || settlement.lockedAt) {
    redirect("/admin/billing/settlements?error=locked");
  }
  const finalPayoutAmountCents = settlement.payoutableAmountCents + adjustmentAmountCents;
  if (finalPayoutAmountCents < 0) {
    redirect("/admin/billing/settlements?error=negative_payout");
  }

  const db = getDb();
  let updated;
  try {
    updated = await db.$transaction(async (tx) => {
      const result = await tx.settlement.updateMany({
        where: { id, lockedAt: null, updatedAt: settlement.updatedAt },
        data: {
          adjustmentAmountCents,
          adjustmentReason,
          reviewedBy: member.id,
          finalPayoutAmountCents,
        },
      });
      if (result.count !== 1) throw new SettlementMutationConflict();
      const saved = await tx.settlement.findUnique({ where: { id } });
      if (!saved) throw new SettlementMutationConflict();
      return saved;
    });
  } catch (error) {
    if (error instanceof SettlementMutationConflict || isSettlementMutationConflict(error)) {
      redirect("/admin/billing/settlements?error=conflict");
    }
    throw error;
  }

  await writeAuditLog({
    vendorId: settlement.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "update_settlement_adjustment",
    targetType: "Settlement",
    targetId: settlement.id,
    before: auditSnapshot(settlement),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/settlements");
}

export async function lockSettlementAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const settlement = await getDb().settlement.findUnique({ where: { id } });
  if (!settlement) {
    redirect("/admin/billing/settlements?error=missing");
  }
  if (settlement.lockedAt) {
    redirect("/admin/billing/settlements?error=locked");
  }
  if (settlement.finalPayoutAmountCents < 0) {
    redirect("/admin/billing/settlements?error=negative_payout");
  }

  const db = getDb();
  let updated;
  try {
    updated = await db.$transaction(async (tx) => {
      const lockedAt = new Date();
      const result = await tx.settlement.updateMany({
        where: { id, lockedAt: null, updatedAt: settlement.updatedAt },
        data: {
          status: "locked",
          lockedAt,
          lockedBy: member.id,
          reviewedBy: member.id,
        },
      });
      if (result.count !== 1) throw new SettlementMutationConflict();

      const locked = await tx.settlement.findUnique({ where: { id } });
      if (!locked) throw new SettlementMutationConflict();
      await tx.affiliateCommission.updateMany({
        where: { vendorId: settlement.vendorId, monthKey: settlement.monthKey, status: { in: ["pending", "approved"] } },
        data: { status: "locked", settledAt: lockedAt },
      });

      // Affiliate payouts are merchant-owned payables, not platform payout
      // items. Derive them from the immutable ledger and keep the identity
      // boundary in the database's vendor/affiliate/month unique key.
      const lockedCommissions = await tx.affiliateCommission.findMany({
        where: {
          vendorId: settlement.vendorId,
          monthKey: settlement.monthKey,
          status: "locked",
          affiliateId: { not: null },
        },
        select: {
          id: true,
          affiliateId: true,
          commissionBaseAmountCents: true,
          netReferenceAmountCents: true,
        },
      });
      const payoutSnapshotsByAffiliate = new Map<string, {
        commissionAmountCents: number;
        grossSalesAmountCents: number;
        netReferenceAmountCents: number;
      }>();
      for (const commission of lockedCommissions) {
        if (!commission.affiliateId) continue;
        const balance = await commissionLedgerBalance(tx, settlement.vendorId, commission.id);
        const current = payoutSnapshotsByAffiliate.get(commission.affiliateId) ?? {
          commissionAmountCents: 0,
          grossSalesAmountCents: 0,
          netReferenceAmountCents: 0,
        };
        const next = {
          commissionAmountCents: current.commissionAmountCents + balance,
          grossSalesAmountCents: current.grossSalesAmountCents + commission.commissionBaseAmountCents,
          netReferenceAmountCents: current.netReferenceAmountCents + commission.netReferenceAmountCents,
        };
        if (next.commissionAmountCents < 0) throw new SettlementMutationConflict();
        payoutSnapshotsByAffiliate.set(commission.affiliateId, next);
      }

      for (const [affiliateId, snapshot] of payoutSnapshotsByAffiliate) {
        const { commissionAmountCents, grossSalesAmountCents, netReferenceAmountCents } = snapshot;
        // A zero balance is a valid locked commission state but is not an
        // amount payable to a merchant's affiliate.
        if (commissionAmountCents === 0) continue;

        const existingPayout = await tx.affiliatePayout.findUnique({
          where: {
            vendorId_affiliateId_monthKey: {
              vendorId: settlement.vendorId,
              affiliateId,
              monthKey: settlement.monthKey,
            },
          },
        });
        if (existingPayout) {
          if (
            existingPayout.commissionAmountCents !== commissionAmountCents
            || existingPayout.adjustmentAmountCents !== 0
            || existingPayout.finalAmountCents !== commissionAmountCents
            || (typeof existingPayout.grossSalesAmountCents === "number" && existingPayout.grossSalesAmountCents !== grossSalesAmountCents)
            || (typeof existingPayout.netReferenceAmountCents === "number" && existingPayout.netReferenceAmountCents !== netReferenceAmountCents)
          ) {
            throw new SettlementMutationConflict();
          }
          continue;
        }

        await tx.affiliatePayout.create({
          data: {
            vendorId: settlement.vendorId,
            affiliateId,
            monthKey: settlement.monthKey,
            commissionAmountCents,
            adjustmentAmountCents: 0,
            finalAmountCents: commissionAmountCents,
            grossSalesAmountCents,
            netReferenceAmountCents,
            status: "pending",
          },
        });
      }
      // Course F/G payables are a separate merchant-owned read model. They
      // are grouped by recipient membership and original transaction month;
      // this never implies a bank/KYC/tax check or an external payment.
      await syncCoursePayoutsForSettlement(tx, {
        vendorId: settlement.vendorId,
        monthKey: settlement.monthKey,
        ...monthRange(settlement.monthKey),
      });
      return locked;
    });
  } catch (error) {
    if (error instanceof SettlementMutationConflict || error instanceof CoursePayoutMutationConflict || isSettlementMutationConflict(error)) {
      redirect("/admin/billing/settlements?error=conflict");
    }
    throw error;
  }

  await writeAuditLog({
    vendorId: settlement.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "lock_settlement",
    targetType: "Settlement",
    targetId: settlement.id,
    before: auditSnapshot(settlement),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/settlements");
  revalidatePath("/billing/settlements");
  redirect("/admin/billing/settlements");
}

export async function recordAffiliatePayoutOutcomeAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor, member } = await requireVendorFinance("/affiliates/commissions");
  const id = text(formData, "id");
  const status = text(formData, "status");
  const reason = text(formData, "reason");
  const outcomeReference = optionalText(formData, "outcomeReference");
  if (
    !id
    || id.length > 200
    || (status !== "paid" && status !== "void")
    || reason.length < 1
    || reason.length > 500
    || (status === "paid" && (!outcomeReference || outcomeReference.length > 200))
  ) {
    redirect("/affiliates/commissions?error=invalid_payout");
  }

  const auditMeta = await requestAuditMeta();
  try {
    await getDb().$transaction(async (tx) => {
      const payout = await tx.affiliatePayout.findFirst({
        where: { id, vendorId: vendor.id },
      });
      if (!payout) throw new AffiliatePayoutMutationConflict();
      if (
        payout.payoutItemId !== null
        || payout.finalAmountCents <= 0
        || payout.finalAmountCents !== payout.commissionAmountCents + payout.adjustmentAmountCents
      ) {
        throw new AffiliatePayoutMutationConflict();
      }
      if (payout.status === "paid" && !payout.paidAt) throw new AffiliatePayoutMutationConflict();
      if (payout.status === "void" && payout.paidAt) throw new AffiliatePayoutMutationConflict();
      if (payout.status === status) return;
      if (payout.status !== "pending") throw new AffiliatePayoutMutationConflict();

      const commissions = await tx.affiliateCommission.findMany({
        where: {
          vendorId: vendor.id,
          affiliateId: payout.affiliateId,
          monthKey: payout.monthKey,
        },
        select: { id: true, affiliateId: true, status: true },
      });
      if (commissions.length === 0 || commissions.some((commission) => commission.status !== "locked" || commission.affiliateId !== payout.affiliateId)) {
        throw new AffiliatePayoutMutationConflict();
      }

      const balances = [] as Array<{ id: string; amountCents: number }>;
      let commissionTotalCents = 0;
      for (const commission of commissions) {
        const amountCents = await commissionLedgerBalance(tx, vendor.id, commission.id);
        if (amountCents < 0) throw new AffiliatePayoutMutationConflict();
        balances.push({ id: commission.id, amountCents });
        commissionTotalCents += amountCents;
      }
      if (commissionTotalCents !== payout.commissionAmountCents) throw new AffiliatePayoutMutationConflict();

      const transitionedAt = new Date();
      if (status === "void") {
        for (const balance of balances) {
          if (balance.amountCents === 0) continue;
          await appendCommissionLedgerEntry(tx, {
            vendorId: vendor.id,
            affiliateCommissionId: balance.id,
            entryType: "reversal",
            providerName: "merchant",
            eventIdentity: `affiliate-payout:void:${payout.id}:${balance.id}`,
            amountCents: -balance.amountCents,
            occurredAt: transitionedAt,
          });
        }
      }

      const payoutClaim = await tx.affiliatePayout.updateMany({
        where: { id: payout.id, vendorId: vendor.id, status: "pending", payoutItemId: null },
        data: {
          status,
          outcomeReference: status === "paid" ? outcomeReference : null,
          outcomeReason: reason,
          paidAt: status === "paid" ? transitionedAt : null,
        },
      });
      if (payoutClaim.count !== 1) throw new AffiliatePayoutMutationConflict();

      const commissionClaim = await tx.affiliateCommission.updateMany({
        where: {
          vendorId: vendor.id,
          id: { in: commissions.map((commission) => commission.id) },
          status: "locked",
        },
        data: { status, settledAt: transitionedAt },
      });
      if (commissionClaim.count !== commissions.length) throw new AffiliatePayoutMutationConflict();

      const updated = await tx.affiliatePayout.findUnique({ where: { id: payout.id } });
      if (!updated || updated.vendorId !== vendor.id || updated.status !== status) {
        throw new AffiliatePayoutMutationConflict();
      }
      await tx.auditLog.create({
        data: {
          vendorId: vendor.id,
          actorId: member.id,
          actorLabel: member.role,
          action: status === "paid" ? "mark_affiliate_payout_paid" : "mark_affiliate_payout_void",
          targetType: "AffiliatePayout",
          targetId: payout.id,
          before: auditSnapshot(payout),
          after: auditSnapshot({ payout: updated, reference: status === "paid" ? outcomeReference : null, reason, transitionedAt }),
          ipAddress: auditMeta.ipAddress,
          userAgent: auditMeta.userAgent,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof AffiliatePayoutMutationConflict || isAffiliatePayoutMutationConflict(error)) {
      redirect("/affiliates/commissions?error=conflict");
    }
    throw error;
  }

  revalidatePath("/affiliates/commissions");
  redirect("/affiliates/commissions");
}

export async function createPayoutBatchAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const settlementIds = Array.from(new Set(
    formData.getAll("settlementIds")
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ));
  if (settlementIds.length === 0) {
    redirect("/admin/billing/payouts?error=empty");
  }

  const db = getDb();
  const settlements = await db.settlement.findMany({
    where: {
      id: { in: settlementIds },
      lockedAt: { not: null },
      payoutBatchId: null,
      finalPayoutAmountCents: { gt: 0 },
    },
    include: { vendor: { include: { paymentAccounts: true } } },
  });

  if (settlements.length !== settlementIds.length) {
    redirect("/admin/billing/payouts?error=no_locked");
  }

  const bankAccountsBySettlementId = new Map<string, ReturnType<typeof resolveStoredBankAccount>>();
  try {
    for (const settlement of settlements) {
      const account = selectPayoutAccount(settlement.vendor.paymentAccounts);
      bankAccountsBySettlementId.set(settlement.id, resolveStoredBankAccount({
        vendorId: settlement.vendorId,
        bankAccountEncrypted: account.bankAccountEncrypted,
        legacyAccountName: account.bankAccountLegacyName,
        legacyBankCode: account.bankCodeLegacy,
        legacyAccountNumber: account.bankAccountLegacyNumber,
      }));
    }
  } catch {
    redirect("/admin/billing/settlements?error=invalid_payout_account");
  }

  const now = new Date();
  const batchNumber = payoutBatchNumber(now);
  const totalAmountCents = settlements.reduce((sum, settlement) => sum + settlement.finalPayoutAmountCents, 0);

  let batch;
  try {
    batch = await db.$transaction(async (tx) => {
      const createdBatch = await tx.payoutBatch.create({
        data: {
          batchNumber,
          batchDate: now,
          totalAmountCents,
          totalCount: settlements.length,
          status: "draft",
          exportedFilePath: `/admin/billing/payouts/${batchNumber}/csv`,
        },
      });

      for (const settlement of settlements) {
        // Claim the settlement before creating a payout item. updateMany makes
        // the eligibility check and bind one atomic row-locking operation, so
        // concurrent batches cannot both consume the same settlement.
        const claim = await tx.settlement.updateMany({
          where: {
            id: settlement.id,
            lockedAt: { not: null },
            payoutBatchId: null,
            finalPayoutAmountCents: { gt: 0 },
          },
          data: {
            payoutBatchId: createdBatch.id,
            batchNumber,
            status: "ready_for_payout",
            payoutDate: now,
          },
        });
        if (claim.count !== 1) {
          throw new PayoutBatchClaimConflict();
        }

        const bankAccount = bankAccountsBySettlementId.get(settlement.id)!;
        const bankAccountDisplay = maskBankAccount(bankAccount);
        await tx.payoutItem.create({
          data: {
            payoutBatchId: createdBatch.id,
            vendorId: settlement.vendorId,
            settlementId: settlement.id,
            bankAccountDisplayName: bankAccountDisplay.accountName,
            bankCodeDisplay: bankAccountDisplay.bankCode,
            bankAccountDisplayNumber: bankAccountDisplay.accountNumber,
            bankAccountEncrypted: encryptBankAccount(bankAccount, settlement.vendorId),
            payoutAmountCents: settlement.finalPayoutAmountCents,
            status: "pending",
          },
        });
      }

      return createdBatch;
    });
  } catch (error) {
    if (error instanceof PayoutBatchClaimConflict || isDatabaseTransactionConflict(error)) {
      redirect("/admin/billing/payouts?error=conflict");
    }
    throw error;
  }

  await writeAuditLog({
    vendorId: settlements[0]?.vendorId ?? null,
    actorId: member.id,
    actorLabel: member.role,
    action: "create_payout_batch",
    targetType: "PayoutBatch",
    targetId: batch.id,
    before: auditSnapshot({ settlementIds }),
    after: auditSnapshot({ batch, settlements: settlements.map((settlement) => settlement.id) }),
  });

  revalidatePath("/admin/billing/payouts");
  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/payouts");
}

export async function updatePayoutItemStatusAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const parsedStatus = PayoutItemTargetStatus.safeParse(text(formData, "status"));
  const failReason = optionalText(formData, "failReason");
  const outcomeReference = optionalText(formData, "outcomeReference");
  if (!parsedStatus.success
    || (parsedStatus.data === "failed" && (!failReason || failReason.length > 500))
    || (parsedStatus.data === "paid" && (!outcomeReference || outcomeReference.length > 200))) {
    redirect("/admin/billing/payouts?error=invalid_status");
  }
  const status = parsedStatus.data;
  const item = await getDb().payoutItem.findUnique({ where: { id }, include: { payoutBatch: true } });
  if (!item || !canTransitionPayoutItem(item.status, status)) {
    redirect("/admin/billing/payouts?error=invalid_transition");
  }

  const data: Prisma.PayoutItemUpdateInput = {
    status,
    failReason: status === "failed" ? failReason : null,
    outcomeReference: status === "paid" ? outcomeReference : null,
  };

  if (status === "paid") {
    data.paidAt = new Date();
  }

  if (status === "retrying") {
    data.retriedAt = new Date();
    data.retryCount = { increment: 1 };
  }

  const updated = await (async () => {
    try {
      return await getDb().$transaction(async (tx) => {
        const savedItem = await tx.payoutItem.update({ where: { id, status: item.status }, data });
        const items = await tx.payoutItem.findMany({ where: { payoutBatchId: item.payoutBatchId } });
        const itemStatuses = items.map((batchItem) => batchItem.id === id ? status : batchItem.status);
        const batchStatus = derivePayoutBatchStatus(itemStatuses, item.payoutBatch.status);

        await tx.payoutBatch.update({
          where: { id: item.payoutBatchId },
          data: {
            status: batchStatus,
            executedAt: batchStatus === "completed" ? new Date() : item.payoutBatch.executedAt,
          },
        });

        if (item.settlementId && status === "paid") {
          const paidAt = new Date();
          const settlementTransition = await tx.settlement.updateMany({
            where: {
              id: item.settlementId,
              vendorId: item.vendorId,
              payoutBatchId: item.payoutBatchId,
              finalPayoutAmountCents: item.payoutAmountCents,
              status: "ready_for_payout",
            },
            data: { status: "paid", paidAt },
          });
          if (settlementTransition.count !== 1) throw new PayoutBatchClaimConflict();
          // This platform payout settles the vendor only. Merchant-owned
          // affiliate commissions remain locked until the merchant records
          // the separate AffiliatePayout outcome with its own evidence.
        }

        return savedItem;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof PayoutBatchClaimConflict || isDatabaseTransactionConflict(error)) {
        redirect("/admin/billing/payouts?error=invalid_transition");
      }
      throw error;
    }
  })();

  await writeAuditLog({
    vendorId: item.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: `mark_payout_${status}`,
    targetType: "PayoutItem",
    targetId: item.id,
    before: auditSnapshot(item),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/payouts");
  revalidatePath("/billing/payouts");
  redirect("/admin/billing/payouts");
}

export async function markPayoutBatchExportedAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const before = await getDb().payoutBatch.findUnique({ where: { id } });
  if (!before || !canMarkPayoutBatchExported(before.status)) {
    redirect("/admin/billing/payouts?error=invalid_transition");
  }

  const exportedAt = new Date();
  const result = await getDb().payoutBatch.updateMany({
    where: { id, status: "draft" },
    data: {
      status: "exported",
      exportedAt,
    },
  });
  if (result.count !== 1) {
    redirect("/admin/billing/payouts?error=invalid_transition");
  }
  const updated = { ...before, status: "exported", exportedAt };
  await writeAuditLog({
    actorId: member.id,
    actorLabel: member.role,
    action: "export_payout_batch",
    targetType: "PayoutBatch",
    targetId: id,
    before: auditSnapshot(before),
    after: auditSnapshot(updated),
  });
  revalidatePath("/admin/billing/payouts");
  redirect("/admin/billing/payouts");
}

export async function refundPaymentTransactionAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const db = getDb();

  // An already-refunded PayUni transaction must be rejected before validating
  // the editable refund fields. The dashboard intentionally leaves those
  // fields blank for terminal transactions, so validating them first would
  // hide the real idempotency result behind the generic `error=refund` path.
  const providerTransaction = await db.paymentTransaction.findUnique({ where: { id } });
  if (
    providerTransaction?.providerName === "payuni"
    && providerTransaction.status !== "paid"
    && providerTransaction.status !== "partially_refunded"
  ) {
    redirect("/admin/billing/dashboard?error=refund_already_processed");
  }

  const refundAmountCents = moneyToCents(formData, "refundAmount");
  const gatewayFeeRefundCents = moneyToCents(formData, "gatewayFeeRefund");
  const platformFeeRefundCents = moneyToCents(formData, "platformFeeRefund");
  const reason = optionalText(formData, "reason");
  const monthKey = text(formData, "monthKey", new Date().toISOString().slice(0, 7));
  if (
    refundAmountCents <= 0 ||
    gatewayFeeRefundCents < 0 ||
    platformFeeRefundCents < 0 ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)
  ) {
    redirect("/admin/billing/dashboard?error=refund");
  }

  // PayUni does not send a refund callback for the close API used by Sandbox.
  // Reserve a local pending record first, then let this finance-admin action be
  // the sole issuer of the provider refund.  This keeps a recoverable record if
  // the provider succeeds but the final local commit cannot complete.
  if (providerTransaction?.providerName === "payuni") {
    const provider = getPaymentProvider("payuni");
    if (!provider.refundPayment || !providerTransaction.providerTradeNo) {
      redirect("/admin/billing/dashboard?error=refund");
    }

    const requestId = randomBytes(16).toString("hex");
    const requestReservationEventId = `request:${requestId}`;
    const ambiguousReservationEventId = `ambiguous:${requestId}`;
    let reserved: { transaction: typeof providerTransaction; refundId: string };
    try {
      reserved = await db.$transaction(async (tx) => {
        const transaction = await tx.paymentTransaction.findUnique({ where: { id } });
        if (!transaction) throw new RefundValidationError();
        // A provider-side refund is valid only after this transaction has been
        // recorded as paid.  Do not allow a provider trade reference alone to
        // move a pending, failed, or already-refunded transaction forward.
        if (transaction.status !== "paid" && transaction.status !== "partially_refunded") {
          throw new RefundValidationError();
        }

        const reservedRefunds = await tx.refundRecord.aggregate({
          where: { paymentTransactionId: transaction.id, status: { in: ["pending", "processed"] } },
          _sum: {
            refundAmountCents: true,
            gatewayFeeRefundCents: true,
            platformFeeRefundCents: true,
          },
        });
        const reservedAmountCents = reservedRefunds._sum.refundAmountCents ?? 0;
        const reservedGatewayFeeCents = reservedRefunds._sum.gatewayFeeRefundCents ?? 0;
        const reservedPlatformFeeCents = reservedRefunds._sum.platformFeeRefundCents ?? 0;
        const pendingReservations = await tx.refundRecord.aggregate({ where: { paymentTransactionId: transaction.id, status: "pending" }, _count: { _all: true } });
        if ((pendingReservations._count?._all ?? 0) > 0) throw new RefundValidationError();
        if (
          refundAmountCents > transaction.grossAmountCents - reservedAmountCents
          || reservedGatewayFeeCents + gatewayFeeRefundCents > transaction.gatewayFeeCents
          || reservedPlatformFeeCents + platformFeeRefundCents > transaction.platformFeeCents
        ) {
          throw new RefundValidationError();
        }

        const refund = await tx.refundRecord.create({
          data: {
            vendorId: transaction.vendorId,
            paymentTransactionId: transaction.id,
            providerEventId: requestReservationEventId,
            monthKey,
            refundAmountCents,
            gatewayFeeRefundCents,
            platformFeeRefundCents,
            reason,
            status: "pending",
          },
        });
        return { transaction, refundId: refund.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof RefundValidationError || isDatabaseTransactionConflict(error)) {
        redirect("/admin/billing/dashboard?error=refund");
      }
      throw error;
    }

    let providerResult: Awaited<ReturnType<NonNullable<typeof provider.refundPayment>>>;
    try {
      providerResult = await provider.refundPayment({
        transaction: reserved.transaction,
        refundAmountCents,
        requestId,
      });
    } catch (error) {
      const category = error instanceof RefundProviderError ? error.category : "unknown";
      // request_contract is the only category that is known to fail before a
      // provider request can be sent. Every other outcome may have reached
      // PayUni, so keep the reservation pending and require a provider query
      // before allowing another refund attempt.
      const requiresReconciliation = category !== "request_contract";
      await db.refundRecord.update({
        // This conditional update is the state transition boundary between an
        // in-flight provider call and a query-only reconciliation. It also
        // prevents a late action from overwriting a reconciled reservation.
        where: {
          id: reserved.refundId,
          status: "pending",
          providerEventId: requestReservationEventId,
        },
        data: requiresReconciliation
          ? { providerEventId: ambiguousReservationEventId }
          : { status: "failed" },
      });
      // 僅輸出安全分類，避免 provider payload、URL 或密鑰進入 runtime log。
      console.info("payuni_refund_failed", {
        category,
        reservation: requiresReconciliation ? "pending_reconciliation" : "released",
      });
      redirect(`/admin/billing/dashboard?error=${requiresReconciliation ? "refund_reconciliation_required" : "refund"}`);
    }

    try {
      await (async () => {
        for (let attempt = 1; attempt <= REFUND_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
          try {
            return await db.$transaction(async (tx) => {
              // The provider has already accepted this exact reservation. Read
              // the transaction again inside the serializable completion
              // transaction so a concurrent partial refund cannot overwrite a
              // newer refunded total with the pre-provider snapshot.
              const currentTransaction = await tx.paymentTransaction.findUnique({ where: { id: reserved.transaction.id } });
              if (!currentTransaction) throw new RefundValidationError();
              const refundedAmountCents = currentTransaction.refundedAmountCents + refundAmountCents;
              if (refundedAmountCents > currentTransaction.grossAmountCents) throw new RefundValidationError();
              const refundOccurredAt = new Date();

              await tx.refundRecord.update({
                where: {
                  id: reserved.refundId,
                  status: "pending",
                  providerEventId: requestReservationEventId,
                },
                data: {
                  status: "processed",
                  providerEventId: providerResult.providerEventId ?? `request:${requestId}`,
                },
              });
              const completedTransaction = await tx.paymentTransaction.update({
                where: { id: currentTransaction.id },
                data: {
                  status: refundedAmountCents >= currentTransaction.grossAmountCents ? "refunded" : "partially_refunded",
                  refundedAmountCents,
                  refundReason: reason,
                  refundedAt: refundOccurredAt,
                },
              });
              const refundedFeeTotals = await tx.refundRecord.aggregate({
                where: { paymentTransactionId: completedTransaction.id, status: "processed" },
                _sum: { gatewayFeeRefundCents: true, platformFeeRefundCents: true },
              });
              await applyPaymentRefundAccounting(tx, {
                vendorId: currentTransaction.vendorId,
                transactionId: currentTransaction.id,
                orderNumber: currentTransaction.orderNumber,
                providerName: currentTransaction.providerName,
                eventIdentity: providerResult.providerEventId ?? `request:${reserved.refundId}`,
                refundRecordId: reserved.refundId,
                refundAmountCents,
                netReferenceAmountCents: calculateNetReferenceAmountCents({
                  netAmountCents: completedTransaction.netAmountCents,
                  refundedAmountCents: completedTransaction.refundedAmountCents,
                  gatewayFeeRefundCents: refundedFeeTotals._sum.gatewayFeeRefundCents ?? 0,
                  platformFeeRefundCents: refundedFeeTotals._sum.platformFeeRefundCents ?? 0,
                }),
                isFullRefund: refundedAmountCents >= currentTransaction.grossAmountCents,
                transactionOccurredAt: currentTransaction.occurredAt,
                occurredAt: refundOccurredAt,
              });
              const auditData = { vendorId: reserved.transaction.vendorId, actorId: member.id, actorLabel: member.role, action: "refund_payment_transaction", targetType: "PaymentTransaction", targetId: reserved.transaction.id, before: auditSnapshot(reserved.transaction), after: auditSnapshot(completedTransaction) };
              if (tx.auditLog && typeof tx.auditLog.create === "function") {
                await tx.auditLog.create({ data: auditData });
              } else {
                await writeAuditLog(auditData);
              }
              return completedTransaction;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
          } catch (error) {
            if (isSerializationConflict(error) && attempt < REFUND_TRANSACTION_MAX_ATTEMPTS) continue;
            throw error;
          }
        }
        throw new Error("PayUni refund completion retry loop exited unexpectedly");
      })();
    } catch (error) {
      // Keep the reservation pending after a provider-confirmed refund when
      // local accounting cannot finish. This is recoverable and must not cause
      // a second provider call on a later reconciliation attempt.
      console.info("payuni_refund_completion_failed", {
        category: isDatabaseTransactionConflict(error) ? "database" : "unknown",
      });
      redirect("/admin/billing/dashboard?error=refund");
    }

    revalidatePath("/admin/billing/dashboard");
    revalidatePath("/admin/billing/settlements");
    redirect("/admin/billing/dashboard");
  }

  const { transaction, updated } = await (async () => {
    for (let attempt = 1; attempt <= REFUND_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(async (tx) => {
          const transaction = await tx.paymentTransaction.findUnique({ where: { id } });
          if (!transaction) throw new RefundValidationError();
          if (transaction.status !== "paid" && transaction.status !== "partially_refunded") {
            throw new RefundValidationError();
          }

          const remainingRefundAmountCents = transaction.grossAmountCents - transaction.refundedAmountCents;
          if (refundAmountCents > remainingRefundAmountCents) throw new RefundValidationError();

          const processedFeeRefunds = await tx.refundRecord.aggregate({
            where: { paymentTransactionId: transaction.id, status: "processed" },
            _sum: {
              gatewayFeeRefundCents: true,
              platformFeeRefundCents: true,
            },
          });
          const refundedGatewayFeeCents = processedFeeRefunds._sum.gatewayFeeRefundCents ?? 0;
          const refundedPlatformFeeCents = processedFeeRefunds._sum.platformFeeRefundCents ?? 0;
          if (
            refundedGatewayFeeCents + gatewayFeeRefundCents > transaction.gatewayFeeCents ||
            refundedPlatformFeeCents + platformFeeRefundCents > transaction.platformFeeCents
          ) {
            throw new RefundValidationError();
          }

          const refundedAmountCents = transaction.refundedAmountCents + refundAmountCents;
          const status = refundedAmountCents >= transaction.grossAmountCents ? "refunded" : "partially_refunded";
          const refund = await tx.refundRecord.create({
            data: {
              vendorId: transaction.vendorId,
              paymentTransactionId: transaction.id,
              monthKey,
              refundAmountCents,
              gatewayFeeRefundCents,
              platformFeeRefundCents,
              reason,
            },
          });
          const updated = await tx.paymentTransaction.update({
            where: { id },
            data: {
              status,
              refundedAmountCents,
              refundReason: reason,
              refundedAt: new Date(),
            },
          });
          const refundedFeeTotals = await tx.refundRecord.aggregate({
            where: { paymentTransactionId: updated.id, status: "processed" },
            _sum: { gatewayFeeRefundCents: true, platformFeeRefundCents: true },
          });
          await applyPaymentRefundAccounting(tx, {
            vendorId: transaction.vendorId,
            transactionId: transaction.id,
            orderNumber: transaction.orderNumber,
            providerName: transaction.providerName,
            eventIdentity: `refund:${refund.id}`,
            refundRecordId: refund.id,
            refundAmountCents,
            netReferenceAmountCents: calculateNetReferenceAmountCents({
              netAmountCents: updated.netAmountCents,
              refundedAmountCents: updated.refundedAmountCents,
              gatewayFeeRefundCents: refundedFeeTotals._sum.gatewayFeeRefundCents ?? 0,
              platformFeeRefundCents: refundedFeeTotals._sum.platformFeeRefundCents ?? 0,
            }),
            isFullRefund: refundedAmountCents >= transaction.grossAmountCents,
            transactionOccurredAt: transaction.occurredAt,
            occurredAt: new Date(),
          });

          return { transaction, updated };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (isSerializationConflict(error) && attempt < REFUND_TRANSACTION_MAX_ATTEMPTS) {
          continue;
        }

        if (error instanceof RefundValidationError || isDatabaseTransactionConflict(error)) {
          redirect("/admin/billing/dashboard?error=refund");
        }
        throw error;
      }
    }

    throw new Error("Refund transaction retry loop exited unexpectedly");
  })();

  await writeAuditLog({
    vendorId: transaction.vendorId,
    actorId: member.id,
    actorLabel: member.role,
    action: "refund_payment_transaction",
    targetType: "PaymentTransaction",
    targetId: transaction.id,
    before: auditSnapshot(transaction),
    after: auditSnapshot(updated),
  });

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/admin/billing/settlements");
  redirect("/admin/billing/dashboard");
}

export async function retryWebhookEventAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const event = await getDb().webhookEvent.findUnique({ where: { id } });
  if (!event) {
    redirect("/admin/billing/dashboard?error=webhook");
  }
  if (event.retryCount >= event.maxRetries) {
    redirect("/admin/billing/dashboard?error=max_retries");
  }
  await retryWebhookEvent(id, member.role);

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/admin/billing/webhooks");
  revalidatePath(`/admin/billing/webhooks/${id}`);
  redirect("/admin/billing/dashboard");
}
