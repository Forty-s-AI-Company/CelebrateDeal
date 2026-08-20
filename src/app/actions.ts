"use server";

import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  requireFinanceAdmin,
  requireVendorFinance,
  requireVendorManager,
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
  expectedTemplateTrigger,
  haveValidLiveNotificationRuleTemplates,
  parseLiveNotificationRules,
  reconcileLiveNotificationRules,
  type LiveNotificationRuleInput,
} from "@/lib/live-notification-rules";
import {
  createLiveReminderReconciliationSnapshot,
  queueLiveReminderReconciliation,
  type LiveReminderReconciliationSnapshot,
  type LiveReminderTemplateSnapshot,
} from "@/lib/live-reminder-reconciliation";
import {
  materializeLiveNotificationRules,
  supersedeLiveNotificationDeliveriesForLifecycle,
} from "@/lib/live-notification-delivery";
import { captureOperationalError } from "@/lib/monitoring";
import { assertPaymentMethodReferenceForQuota, PaymentMethodReferenceRequiredError } from "@/lib/payment-method-reference";
import type { InteractionRoleActionState } from "@/lib/interaction-role-action-state";
import {
  hasUsableMessageTemplateContent,
  LIVE_REMINDER_EMAIL_TEMPLATE_WHERE,
  REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
  type MessageTemplateActionState,
} from "@/lib/message-template";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";
import {
  getLivePublishReadiness,
  requiresLivePublishReadiness,
} from "@/lib/live-publish-readiness";
import { ImageAssetReferenceError, resolveReadyImageAsset } from "@/lib/image-assets";
import { liveReadyVideoWhere } from "@/lib/live-video-readiness";
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
  deleteInteractionRoleAction as deleteInteractionRoleActionImpl,
  deleteInteractionScriptAction as deleteInteractionScriptActionImpl,
  duplicateInteractionScriptAction as duplicateInteractionScriptActionImpl,
  importSystemRolesAction as importSystemRolesActionImpl,
  unblockBlacklistAction as unblockBlacklistActionImpl,
  unbindInteractionScriptFromLiveAction as unbindInteractionScriptFromLiveActionImpl,
  upsertBlacklistAction as upsertBlacklistActionImpl,
  upsertInteractionRoleAction as upsertInteractionRoleActionImpl,
  upsertInteractionRoleActionState as upsertInteractionRoleActionStateImpl,
  upsertInteractionScriptAction as upsertInteractionScriptActionImpl,
} from "./actions/interaction-actions";
import {
  archiveVideoAction as archiveVideoActionImpl,
  restoreVideoAction as restoreVideoActionImpl,
  upsertFormAction as upsertFormActionImpl,
  upsertTemplateAction as upsertTemplateActionImpl,
  upsertVideoAction as upsertVideoActionImpl,
} from "./actions/webinar-resource-actions";
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

function isDatabaseTransactionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "P2025" || error.code === "P2034");
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
  senderName: string;
  contactUrl: string;
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
const INVALID_BRAND_SENDER_NAME_MESSAGE = "寄件人名稱無效，請輸入 80 字元以內且不含控制字元的文字。";
const INVALID_BRAND_CONTACT_URL_MESSAGE = "聯絡網址無效，請輸入不含帳密、非本機或內部 IP 的 HTTPS 絕對網址。";
const BRAND_LOGO_URL_MAX_LENGTH = 2048;
const BRAND_CONTACT_URL_MAX_LENGTH = 2048;
const BRAND_SENDER_NAME_MAX_LENGTH = 80;

type BrandSettingsValidationCode = "invalid_timezone" | "invalid_logo" | "invalid_sender_name" | "invalid_contact_url";

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
    senderName: rawSubmittedValue(formData, "senderName"),
    contactUrl: rawSubmittedValue(formData, "contactUrl"),
    logoUrl: boundedValue("logoUrl", BRAND_LOGO_URL_MAX_LENGTH),
    logoAssetId: boundedValue("logoAssetId", 128),
  };
}

function rawSubmittedValue(formData: FormData, key: string) {
  const submitted = formData.get(key);
  return submitted === null ? "" : typeof submitted === "string" ? submitted : "__invalid__";
}

function isPrivateOrSpecialIpv4(value: string) {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first = Number.NaN, second = Number.NaN] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function parseIpv6Segments(value: string) {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half: string) => half ? half.split(":") : [];
  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  const rawSegments = [...left, ...right];
  if (rawSegments.some((segment) => segment === "")) return null;

  const segments = rawSegments.flatMap((segment, index) => {
    if (!segment.includes(".")) return [/^[0-9a-f]{1,4}$/iu.test(segment) ? Number.parseInt(segment, 16) : Number.NaN];
    if (index !== rawSegments.length - 1 || isPrivateOrSpecialIpv4(segment)) return [Number.NaN, Number.NaN];
    const octets = segment.split(".").map(Number);
    const [
      firstOctet = Number.NaN,
      secondOctet = Number.NaN,
      thirdOctet = Number.NaN,
      fourthOctet = Number.NaN,
    ] = octets;
    return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
      ? [(firstOctet << 8) | secondOctet, (thirdOctet << 8) | fourthOctet]
      : [Number.NaN, Number.NaN];
  });
  const zeroCount = halves.length === 2 ? 8 - segments.length : 0;
  if (zeroCount < (halves.length === 2 ? 1 : 0) || segments.length + zeroCount !== 8) return null;
  const expanded = halves.length === 2
    ? [...segments.slice(0, left.length), ...Array.from({ length: zeroCount }, () => 0), ...segments.slice(left.length)]
    : segments;
  return expanded.every((segment) => Number.isInteger(segment) && segment >= 0 && segment <= 0xffff) ? expanded : null;
}

function isUnsafeContactHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.+$/u, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateOrSpecialIpv4(host);
  if (ipVersion !== 6) return false;

  const segments = parseIpv6Segments(host);
  if (!segments) return true;
  const [
    firstSegment = Number.NaN,
    secondSegment = Number.NaN,
    thirdSegment = Number.NaN,
    fourthSegment = Number.NaN,
    fifthSegment = Number.NaN,
    sixthSegment = Number.NaN,
    seventhSegment = Number.NaN,
    eighthSegment = Number.NaN,
  ] = segments;
  const isAllZero = segments.every((segment) => segment === 0);
  const isLoopback = isAllZero === false && [firstSegment, secondSegment, thirdSegment, fourthSegment, fifthSegment, sixthSegment, seventhSegment].every((segment) => segment === 0) && eighthSegment === 1;
  const isUniqueLocal = (firstSegment & 0xfe00) === 0xfc00;
  const isLinkLocal = (firstSegment & 0xffc0) === 0xfe80;
  const isIpv4Mapped = [firstSegment, secondSegment, thirdSegment, fourthSegment, fifthSegment].every((segment) => segment === 0) && sixthSegment === 0xffff;
  if (!isIpv4Mapped) return isAllZero || isLoopback || isUniqueLocal || isLinkLocal;

  const mappedIpv4 = [seventhSegment >> 8, seventhSegment & 0xff, eighthSegment >> 8, eighthSegment & 0xff].join(".");
  return isPrivateOrSpecialIpv4(mappedIpv4);
}

function parseSafeBrandContactUrl(value: string | null) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || isUnsafeContactHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validateBrandSenderName(formData: FormData) {
  const input = rawSubmittedValue(formData, "senderName");
  if (input === "") return null;
  if (input === "__invalid__") throw new BrandSettingsValidationError("invalid_sender_name", INVALID_BRAND_SENDER_NAME_MESSAGE);
  const normalized = input.trim().normalize("NFC");
  if (!normalized) return null;
  if (Array.from(normalized).length > BRAND_SENDER_NAME_MAX_LENGTH || /\p{Cc}/u.test(normalized)) {
    throw new BrandSettingsValidationError("invalid_sender_name", INVALID_BRAND_SENDER_NAME_MESSAGE);
  }
  return normalized;
}

type ValidatedBrandSettings = {
  timezone: string;
  senderName: string | null;
  contactUrl: string | null;
  logoUrl: string | null;
  logoAssetId: string | null;
};

async function validateBrandSettings(vendorId: string, formData: FormData): Promise<ValidatedBrandSettings> {
  const senderName = validateBrandSenderName(formData);
  const contactUrlInput = rawSubmittedValue(formData, "contactUrl");
  if (contactUrlInput === "__invalid__") {
    throw new BrandSettingsValidationError("invalid_contact_url", INVALID_BRAND_CONTACT_URL_MESSAGE);
  }
  if (contactUrlInput.length > BRAND_CONTACT_URL_MAX_LENGTH || /\p{Cc}/u.test(contactUrlInput)) {
    throw new BrandSettingsValidationError("invalid_contact_url", INVALID_BRAND_CONTACT_URL_MESSAGE);
  }
  const contactUrl = contactUrlInput.trim() === "" ? null : parseSafeBrandContactUrl(contactUrlInput);
  if (contactUrlInput.trim() !== "" && !contactUrl) {
    throw new BrandSettingsValidationError("invalid_contact_url", INVALID_BRAND_CONTACT_URL_MESSAGE);
  }

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
      return { timezone, senderName, contactUrl, logoUrl: logoAsset.publicUrl, logoAssetId: logoAsset.id };
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

  return { timezone, senderName, contactUrl, logoUrl, logoAssetId: null };
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
      senderName: validated.senderName,
      contactUrl: validated.contactUrl,
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

// Keep the legacy public action surface stable while webinar resources live in
// a dedicated file-level `use server` module.
export async function upsertVideoAction(formData: FormData) {
  return upsertVideoActionImpl(formData);
}

export async function archiveVideoAction(formData: FormData) {
  return archiveVideoActionImpl(formData);
}

export async function restoreVideoAction(formData: FormData) {
  return restoreVideoActionImpl(formData);
}

export async function upsertFormAction(formData: FormData) {
  return upsertFormActionImpl(formData);
}

export async function upsertTemplateAction(
  previousState: MessageTemplateActionState,
  formData: FormData,
): Promise<MessageTemplateActionState> {
  return upsertTemplateActionImpl(previousState, formData);
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
  replayAvailableUntil: Date | null;
  streamMode: string;
  quotaPolicy: Prisma.InputJsonValue;
};

class LiveLegacyBindingConflict extends Error {}

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
  notificationRules: LiveNotificationRuleInput[];
  expectedLegacyBinding: { templateId: string | null; offsetMinutes: number } | null;
}) {
  const transitionAt = new Date();
  if (input.liveId) {
    try {
      return await input.db.$transaction(async (tx) => {
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
      const expectedBinding = input.expectedLegacyBinding;
      if (!expectedBinding) throw new LiveLegacyBindingConflict();
      const bindingClaim = await tx.live.updateMany({
        where: {
          id: input.liveId!,
          vendorId: input.vendorId,
          liveReminderTemplateId: expectedBinding.templateId,
          liveReminderOffsetMinutes: expectedBinding.offsetMinutes,
        },
        data: { liveReminderOffsetMinutes: expectedBinding.offsetMinutes },
      });
      if (bindingClaim.count !== 1) throw new LiveLegacyBindingConflict();
      const currentLive = await tx.live.findFirst({
        where: { id: input.liveId!, vendorId: input.vendorId },
        select: { status: true, startedAt: true, endedAt: true },
      });
      if (!currentLive) return null;
      const lifecycleData: LiveMutationData & { startedAt?: Date | null; endedAt?: Date | null } = { ...input.data };
      if (currentLive.status === "scheduled" && input.data.status === "live" && !currentLive.startedAt) {
        lifecycleData.startedAt = transitionAt;
      }
      if (currentLive.status === "live" && input.data.status === "ended" && !currentLive.endedAt) {
        lifecycleData.endedAt = transitionAt;
      }
      const startsNewSession = ["ended", "draft"].includes(currentLive.status) && input.data.status === "scheduled";
      if (startsNewSession) {
        lifecycleData.startedAt = null;
        lifecycleData.endedAt = null;
      }
      await tx.live.update({ where: { id: input.liveId!, vendorId: input.vendorId }, data: lifecycleData });
      if (currentLive.status === "scheduled" && input.data.status === "live") {
        await supersedeLiveNotificationDeliveriesForLifecycle(tx, {
          vendorId: input.vendorId,
          liveId: input.liveId!,
          triggers: ["before_live"],
        });
      } else if (currentLive.status === "live" && input.data.status === "ended") {
        await supersedeLiveNotificationDeliveriesForLifecycle(tx, {
          vendorId: input.vendorId,
          liveId: input.liveId!,
          triggers: ["before_live", "during_live"],
        });
      } else if (startsNewSession) {
        await supersedeLiveNotificationDeliveriesForLifecycle(tx, {
          vendorId: input.vendorId,
          liveId: input.liveId!,
          triggers: ["before_live", "during_live"],
        });
      }
      await tx.liveProduct.deleteMany({ where: { liveId: input.liveId! } });
      for (const [index, productId] of input.productIds.entries()) {
        await tx.liveProduct.create({
          data: { vendorId: input.vendorId, liveId: input.liveId!, productId, sortOrder: index + 1, isPinned: index === 0 },
        });
      }
      const notificationReconciliation = await reconcileLiveNotificationRules(tx, {
        vendorId: input.vendorId,
        liveId: input.liveId!,
        rules: input.notificationRules,
      });
      const reminderReconciliation = input.reminderReconciliationSnapshot
        ? await queueLiveReminderReconciliation(tx, input.reminderReconciliationSnapshot, transitionAt)
        : null;
      return {
        id: input.liveId!,
        created: false,
        reminderReconciliationStatus: reminderReconciliation?.status ?? null,
        notificationRuleIds: notificationReconciliation.materializeRuleIds,
      };
      });
    } catch (error) {
      if (error instanceof LiveLegacyBindingConflict
        || (typeof error === "object" && error !== null && "code" in error && error.code === "P2034")) return null;
      throw error;
    }
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
    const notificationReconciliation = await reconcileLiveNotificationRules(tx, {
      vendorId: input.vendorId,
      liveId: live.id,
      rules: input.notificationRules,
    });
    return { id: live.id, created: true, reminderReconciliationStatus: null, notificationRuleIds: notificationReconciliation.materializeRuleIds };
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
    payload = liveStudioDraftFromFormData(formData, 7);
  } catch {
    redirect(invalidDraftPath);
  }
  const slug = toSlug(payload.slug);
  if (!payload.title || !slug || !payload.scheduledAt) {
    redirect(invalidDraftPath);
  }
  let scheduledAt: Date;
  let replayAvailableUntil: Date | null = null;
  try {
    scheduledAt = parseZonedDateTimeLocal(payload.scheduledAt, vendorTimeZone);
    if (payload.replayEnabled && payload.replayAvailableUntil) {
      replayAvailableUntil = parseZonedDateTimeLocal(payload.replayAvailableUntil, vendorTimeZone);
    }
  } catch {
    redirect(invalidDraftPath);
  }
  return { payload, scheduledAt, replayAvailableUntil, slug, suffix, invalidDraftPath };
}

function requireValidReplayDeadline(input: {
  replayAvailableUntil: Date | null;
  scheduledAt: Date;
  streamMode: LiveStudioDraftPayload["streamMode"];
  video: { durationSec: number | null } | null;
  invalidDraftPath: string;
}) {
  if (!input.replayAvailableUntil) return;
  let earliestDeadline = input.scheduledAt;
  if (input.streamMode === "vod") {
    const durationSec = input.video?.durationSec;
    if (typeof durationSec !== "number" || !Number.isSafeInteger(durationSec) || durationSec <= 0) {
      redirect(input.invalidDraftPath);
    }
    const naturalCompletionMs = input.scheduledAt.getTime() + durationSec * 1_000;
    if (!Number.isSafeInteger(naturalCompletionMs)) redirect(input.invalidDraftPath);
    earliestDeadline = new Date(naturalCompletionMs);
  }
  if (input.replayAvailableUntil.getTime() <= earliestDeadline.getTime()) {
    redirect(input.invalidDraftPath);
  }
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
  notificationRules: LiveNotificationRuleInput[];
  interactionScriptId: string | null;
  defaultAffiliateCode: string | null;
  heroImageAssetId: string | null;
  quotaPageIds: string[];
  invalidReferencePath: string;
}) {
  const [existingLive, products, video, registrationForm, messageTemplate, liveReminderTemplate, notificationTemplates, interactionScript, defaultAffiliate, heroImageAsset, quotaPages] = await Promise.all([
    input.liveId
      ? input.db.live.findFirst({
          where: { id: input.liveId, vendorId: input.vendorId },
          select: {
            id: true,
            slug: true,
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
    input.videoId ? input.db.video.findFirst({ where: liveReadyVideoWhere(input.vendorId, input.videoId), select: { id: true, durationSec: true } }) : Promise.resolve(null),
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
    input.notificationRules.length > 0 ? input.db.messageTemplate.findMany({
      where: {
        vendorId: input.vendorId,
        id: { in: [...new Set(input.notificationRules.map((rule) => rule.messageTemplateId))] },
        channel: "email",
        isActive: true,
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
    }) : Promise.resolve([]),
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
  return { existingLive, products, video, registrationForm, messageTemplate, liveReminderTemplate, notificationTemplates, interactionScript, defaultAffiliate, heroImageAsset, quotaPages };
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
    slug: string;
    title: string;
    status: string;
    scheduledAt: Date;
    liveReminderTemplateId: string | null;
    liveReminderOffsetMinutes: number;
  } | null;
  requestedTitle: string;
  requestedSlug: string;
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
  const changed = existing.slug !== input.requestedSlug
    || existing.title !== input.requestedTitle
    || existing.scheduledAt.getTime() !== input.scheduledAt.getTime()
    || existing.liveReminderTemplateId !== templateId
    || existing.liveReminderOffsetMinutes !== input.reminderOffsetMinutes
    || (previousActive !== nextActive && (existing.liveReminderTemplateId !== null || templateId !== null));
  if (!changed) return null;
  return createLiveReminderReconciliationSnapshot({
    vendorId: input.vendorId,
    liveId: input.liveId,
    liveSlug: input.requestedSlug,
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

function parseSubmittedNotificationRuleDraft(
  submittedDraft: LiveStudioDraftPayload,
  invalidDraftPath: string,
) {
  const parsed = parseLiveNotificationRules(submittedDraft.notificationRules);
  if (!parsed.success) redirect(invalidDraftPath);
  return parsed.data;
}

function requireValidNotificationRuleTemplates(input: {
  rules: LiveNotificationRuleInput[];
  templates: Array<{ id: string; vendorId: string; channel: string; trigger: string; isActive: boolean }>;
  vendorId: string;
  invalidReferencePath: string;
}) {
  if (!haveValidLiveNotificationRuleTemplates(input.rules, input.templates, input.vendorId)) {
    redirect(input.invalidReferencePath);
  }
}

async function resolveAuthoritativeLegacyReminder(input: {
  db: PrismaClient;
  vendorId: string;
  existingLive: {
    liveReminderTemplateId: string | null;
    liveReminderOffsetMinutes: number;
  } | null;
  submittedOffsetMinutes: number;
  notificationRules: LiveNotificationRuleInput[];
  notificationTemplates: LiveReminderTemplateSnapshot[];
}) {
  if (!input.existingLive) {
    const firstActiveBeforeLiveRule = input.notificationRules
      .filter((rule) => rule.trigger === "before_live" && rule.isActive)
      .sort((left, right) => left.sortOrder - right.sortOrder)[0];
    const reminderTemplate = firstActiveBeforeLiveRule
      ? input.notificationTemplates.find((template) => (
          template.id === firstActiveBeforeLiveRule.messageTemplateId
          && template.vendorId === input.vendorId
          && template.channel === "email"
          && template.isActive
          && template.trigger === expectedTemplateTrigger(firstActiveBeforeLiveRule.trigger)
        ))
      : undefined;

    return reminderTemplate && firstActiveBeforeLiveRule
      ? {
          templateId: reminderTemplate.id,
          offsetMinutes: firstActiveBeforeLiveRule.offsetMinutes,
          template: reminderTemplate,
          missing: false,
        }
      : { templateId: null, offsetMinutes: input.submittedOffsetMinutes, template: null, missing: false };
  }
  const templateId = input.existingLive.liveReminderTemplateId;
  const template = templateId
    ? await input.db.messageTemplate.findFirst({
        where: { id: templateId, vendorId: input.vendorId },
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
      })
    : null;
  return {
    templateId,
    offsetMinutes: input.existingLive.liveReminderOffsetMinutes,
    template,
    missing: Boolean(templateId && !template),
  };
}

export async function upsertLiveAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const id = optionalText(formData, "id");
  const draftClaim = parseLiveDraftClaim(formData, id);
  const parsedSubmission = parseSubmittedLiveDraft(formData, id, draftClaim.draftId, vendor.timezone);
  const submittedDraft = parsedSubmission.payload;
  const notificationRules = parseSubmittedNotificationRuleDraft(submittedDraft, parsedSubmission.invalidDraftPath);
  const scheduledAt = parsedSubmission.scheduledAt;
  const createDraftSuffix = parsedSubmission.suffix;
  const rawProductIds = submittedDraft.productIds;
  const productIds = [...new Set(rawProductIds.map((productId) => productId.trim()).filter(Boolean))];
  const videoId = optionalDraftReference(submittedDraft.videoId);
  const formId = optionalDraftReference(submittedDraft.formId);
  const messageTemplateId = optionalDraftReference(submittedDraft.messageTemplateId);
  const interactionScriptId = optionalDraftReference(submittedDraft.interactionScriptId);
  const heroImageAssetId = optionalDraftReference(submittedDraft.heroImageAssetId);
  const quotaPolicy = parseSubmittedLiveQuotaPolicy(submittedDraft, id, createDraftSuffix);
  const invalidReferencePath = id
    ? `/lives/${encodeURIComponent(id)}/edit?error=invalid_reference`
    : `/lives/new?error=invalid_reference${createDraftSuffix}`;
  const referenceIds = [id, videoId, formId, messageTemplateId, interactionScriptId, heroImageAssetId, ...productIds, ...notificationRules.map((rule) => rule.messageTemplateId)].filter(
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
    liveReminderTemplateId: null,
    notificationRules,
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
    liveReminderTemplate: ignoredSubmittedReminderTemplate,
    notificationTemplates,
    interactionScript,
    defaultAffiliate,
    heroImageAsset,
    quotaPages,
  } = references;
  void ignoredSubmittedReminderTemplate;
  const authoritativeReminder = await resolveAuthoritativeLegacyReminder({
    db,
    vendorId: vendor.id,
    existingLive,
    submittedOffsetMinutes: Number(submittedDraft.liveReminderOffsetMinutes),
    notificationRules,
    notificationTemplates,
  });
  const liveReminderTemplate = authoritativeReminder.template;
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
    reminderTemplateMissing: authoritativeReminder.missing,
    scriptMissing: interactionScriptId !== null && !interactionScript,
    affiliateMissing: isMissingDefaultAffiliate(quotaPolicy.defaultAffiliateCode, defaultAffiliate),
    customMembershipMissing: hasInvalidCustomMembership || hasInvalidMemberQuota,
    quotaPageCount: quotaPages.length,
    expectedQuotaPageCount: new Set(quotaPageIds).size,
  });
  if (hasInvalidReference) {
    redirect(invalidReferencePath);
  }
  requireValidNotificationRuleTemplates({
    rules: notificationRules,
    templates: notificationTemplates,
    vendorId: vendor.id,
    invalidReferencePath,
  });
  requireValidReplayDeadline({
    replayAvailableUntil: parsedSubmission.replayAvailableUntil,
    scheduledAt,
    streamMode: submittedDraft.streamMode,
    video,
    invalidDraftPath: parsedSubmission.invalidDraftPath,
  });
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
    liveReminderTemplateId: authoritativeReminder.templateId,
    liveReminderOffsetMinutes: authoritativeReminder.offsetMinutes,
    interactionScriptId,
    heroImageUrl,
    heroImageAssetId: heroImageAsset?.id ?? null,
    accentCopy: submittedDraft.accentCopy || null,
    replayEnabled: submittedDraft.replayEnabled,
    replayAvailableUntil: parsedSubmission.replayAvailableUntil,
    streamMode: submittedDraft.streamMode,
    quotaPolicy: quotaPolicy as Prisma.InputJsonValue,
  };

  const reminderReconciliationSnapshot = liveReminderSnapshotAfterUpdate({
    vendorId: vendor.id,
    liveId: id,
    existingLive,
    requestedTitle: data.title,
    requestedSlug: data.slug,
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
    notificationRules,
    reminderReconciliationSnapshot,
    expectedLegacyBinding: existingLive ? {
      templateId: existingLive.liveReminderTemplateId,
      offsetMinutes: existingLive.liveReminderOffsetMinutes,
    } : null,
  });
  if (!committed) redirect(draftClaim.conflictPath);
  try {
    await materializeLiveNotificationRules({
      vendorId: vendor.id,
      liveId: committed.id,
      ruleIds: committed.notificationRuleIds,
    });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "live_notification", operation: "rule_materialize", status: "failed" });
    } catch {
      // Durable cron repair remains available if optional eager materialization fails.
    }
  }
  if (committed.created) redirect(`/lives/${committed.id}/preview`);
  const reconciliationNotice = liveReminderReconciliationNotice(committed.reminderReconciliationStatus);
  redirect(`/lives/${committed.id}/edit${reconciliationNotice ? `?notice=${reconciliationNotice}` : ""}`);
}

// Keep existing imports stable while interaction and blacklist mutations live
// in their own server-action domain.
export async function upsertInteractionRoleAction(formData: FormData) {
  return upsertInteractionRoleActionImpl(formData);
}

export async function upsertInteractionRoleActionState(
  previousState: InteractionRoleActionState,
  formData: FormData,
): Promise<InteractionRoleActionState> {
  return upsertInteractionRoleActionStateImpl(previousState, formData);
}

export async function deleteInteractionRoleAction(formData: FormData) {
  return deleteInteractionRoleActionImpl(formData);
}

export async function importSystemRolesAction(formData: FormData) {
  return importSystemRolesActionImpl(formData);
}

export async function upsertInteractionScriptAction(formData: FormData) {
  return upsertInteractionScriptActionImpl(formData);
}

export async function unbindInteractionScriptFromLiveAction(formData: FormData) {
  return unbindInteractionScriptFromLiveActionImpl(formData);
}

export async function duplicateInteractionScriptAction(formData: FormData) {
  return duplicateInteractionScriptActionImpl(formData);
}

export async function deleteInteractionScriptAction(formData: FormData) {
  return deleteInteractionScriptActionImpl(formData);
}

export async function upsertBlacklistAction(formData: FormData) {
  return upsertBlacklistActionImpl(formData);
}

export async function unblockBlacklistAction(formData: FormData) {
  return unblockBlacklistActionImpl(formData);
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
