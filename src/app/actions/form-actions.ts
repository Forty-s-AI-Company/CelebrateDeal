"use server";

import { type Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { ImageAssetReferenceError, resolveReadyImageAsset } from "@/lib/image-assets";
import {
  parseRegistrationFormInput,
  type RegistrationFormInput,
  type RegistrationFormInputErrors,
} from "@/lib/registration-form-input";

export type FormBuilderActionState = {
  status: "idle" | "error";
  message: string;
  fieldErrors?: RegistrationFormInputErrors;
};

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

type FormMediaResolution =
  | { success: false; errors: RegistrationFormInputErrors }
  | { success: true; heroImageUrl: string | null; backgroundImageUrl: string | null };

async function resolveFormMedia(
  db: ReturnType<typeof getDb>,
  vendorId: string,
  input: RegistrationFormInput,
): Promise<FormMediaResolution> {
  let heroImageAsset: Awaited<ReturnType<typeof resolveReadyImageAsset>> = null;
  let backgroundImageAsset: Awaited<ReturnType<typeof resolveReadyImageAsset>> = null;
  const errors: RegistrationFormInputErrors = {};

  try {
    heroImageAsset = await resolveReadyImageAsset(db, { vendorId, assetId: input.heroImageAssetId });
  } catch (error) {
    if (!(error instanceof ImageAssetReferenceError)) throw error;
    errors.heroImageAssetId = "主視覺圖片素材無效或尚未就緒。";
  }

  try {
    backgroundImageAsset = await resolveReadyImageAsset(db, { vendorId, assetId: input.backgroundImageAssetId });
  } catch (error) {
    if (!(error instanceof ImageAssetReferenceError)) throw error;
    errors.backgroundImageAssetId = "背景圖片素材無效或尚未就緒。";
  }

  const promoVideo = input.promoVideoId
    ? await db.video.findFirst({
        where: { id: input.promoVideoId, vendorId, status: "ready" },
        select: { id: true },
      })
    : null;
  if (input.promoVideoId && !promoVideo) {
    errors.promoVideoId = "宣傳影片不存在、尚未就緒或不屬於目前商家。";
  }

  const heroImageUrl = heroImageAsset?.publicUrl
    ?? (input.heroImageUrl ? parseSafeExternalHttpUrl(input.heroImageUrl) : null);
  if (!heroImageAsset && input.heroImageUrl && !heroImageUrl) {
    errors.heroImageUrl = "主視覺圖片網址必須是有效的 HTTP(S) 網址。";
  }

  const backgroundImageUrl = backgroundImageAsset?.publicUrl
    ?? (input.backgroundImageUrl ? parseSafeExternalHttpUrl(input.backgroundImageUrl) : null);
  if (!backgroundImageAsset && input.backgroundImageUrl && !backgroundImageUrl) {
    errors.backgroundImageUrl = "背景圖片網址必須是有效的 HTTP(S) 網址。";
  }

  if (Object.keys(errors).length > 0) return { success: false, errors };
  return { success: true, heroImageUrl, backgroundImageUrl };
}

export async function upsertFormBuilderAction(
  _previousState: FormBuilderActionState,
  formData: FormData,
): Promise<FormBuilderActionState> {
  try {
    await assertServerActionSecurity(formData);
  } catch {
    return {
      status: "error",
      message: "安全驗證已失效，請重新整理頁面後再送出。",
      fieldErrors: { root: "本頁的安全驗證已過期。" },
    };
  }

  const vendor = await requireVendorManager();
  const parsed = parseRegistrationFormInput(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "有幾個欄位需要調整；內容仍保留在畫面上。",
      fieldErrors: parsed.errors,
    };
  }

  const { id, ...input } = parsed.data;
  const expectedUpdatedAtRaw = formData.get("expectedUpdatedAt");
  const expectedUpdatedAt = typeof expectedUpdatedAtRaw === "string" && expectedUpdatedAtRaw
    ? new Date(expectedUpdatedAtRaw)
    : null;
  if (id && (!expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime()))) {
    return {
      status: "error",
      message: "無法確認目前表單版本；請重新整理頁面後再儲存。",
      fieldErrors: { root: "缺少有效的表單版本資訊。" },
    };
  }

  const db = getDb();

  try {
    const media = await resolveFormMedia(db, vendor.id, parsed.data);
    if (!media.success) {
      return {
        status: "error",
        message: "有幾個欄位需要調整；內容仍保留在畫面上。",
        fieldErrors: media.errors,
      };
    }

    const data = {
      ...input,
      heroImageUrl: media.heroImageUrl,
      backgroundImageUrl: media.backgroundImageUrl,
      fields: input.fields as Prisma.InputJsonValue,
    };

    if (id) {
      const updated = await db.registrationForm.updateMany({
        where: { id, vendorId: vendor.id, updatedAt: expectedUpdatedAt! },
        data,
      });
      if (updated.count !== 1) {
        return {
          status: "error",
          message: "這張表單已有較新的版本或已不存在；系統沒有覆蓋它。請重新整理後確認內容。",
          fieldErrors: { root: "偵測到版本衝突，未儲存本次變更。" },
        };
      }
    } else {
      await db.registrationForm.create({ data: { ...data, vendorId: vendor.id } });
    }
  } catch (error) {
    const code = databaseErrorCode(error);
    if (code === "P2002") {
      return {
        status: "error",
        message: "這個公開網址已被使用；請換一個後再儲存。",
        fieldErrors: { slug: "這個公開網址已被使用。" },
      };
    }
    if (code === "P2025") {
      return {
        status: "error",
        message: "這張表單已不存在或不屬於目前商家，請返回列表確認。",
        fieldErrors: { root: "找不到可編輯的表單。" },
      };
    }
    return {
      status: "error",
      message: "暫時無法儲存；畫面內容仍保留，請稍後重試。",
      fieldErrors: { root: "儲存服務暫時無法使用。" },
    };
  }

  redirect("/forms");
}
