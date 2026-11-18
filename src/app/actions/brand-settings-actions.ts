"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVendorManager } from "@/lib/auth";
import { parseSafeBrandContactUrl } from "@/lib/contact-url-safety";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { toSlug } from "@/lib/format";
import { ImageAssetReferenceError, resolveReadyImageAsset } from "@/lib/image-assets";
import { assertIanaTimeZone } from "@/lib/zoned-date-time";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
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
