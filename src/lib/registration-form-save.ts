import "server-only";

import { type Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { ImageAssetReferenceError, resolveReadyImageAsset } from "@/lib/image-assets";
import {
  parseRegistrationFormInput,
  type RegistrationFormInput,
  type RegistrationFormInputErrors,
} from "@/lib/registration-form-input";
import { resolveSalesProjectBinding, SalesProjectBindingError } from "@/lib/sales-project-binding";

export type FormBuilderActionState = {
  status: "idle" | "error";
  message: string;
  fieldErrors?: RegistrationFormInputErrors;
};

/**
 * Outcome of one registration form write. `slug_taken` marks the unique
 * public address collision so a caller that generated the slug itself can try
 * another one; every other failure carries the same state the form builder
 * has always shown.
 */
export type RegistrationFormSaveResult =
  | { ok: true; form: { id: string; name: string } }
  | { ok: false; state: FormBuilderActionState; reason?: "slug_taken" };

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

/**
 * Creates or updates one registration form for `vendorId`, which the caller
 * must take from the authenticated session. Validation, the optimistic
 * version check, the in-transaction project binding and every error message
 * are those of the form builder; the caller decides whether to revalidate and
 * redirect. No CSRF or session check happens here.
 */
export async function saveRegistrationForm(vendorId: string, formData: FormData): Promise<RegistrationFormSaveResult> {
  const parsed = parseRegistrationFormInput(formData);
  if (!parsed.success) {
    return {
      ok: false,
      state: {
        status: "error",
        message: "有幾個欄位需要調整；內容仍保留在畫面上。",
        fieldErrors: parsed.errors,
      },
    };
  }

  const { id, ...input } = parsed.data;
  const expectedUpdatedAtRaw = formData.get("expectedUpdatedAt");
  const expectedUpdatedAt = typeof expectedUpdatedAtRaw === "string" && expectedUpdatedAtRaw
    ? new Date(expectedUpdatedAtRaw)
    : null;
  if (id && (!expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime()))) {
    return {
      ok: false,
      state: {
        status: "error",
        message: "無法確認目前表單版本；請重新整理頁面後再儲存。",
        fieldErrors: { root: "缺少有效的表單版本資訊。" },
      },
    };
  }

  const db = getDb();
  let savedId: string;

  try {
    if (id && formData.get("projectId")) throw new SalesProjectBindingError();
    const media = await resolveFormMedia(db, vendorId, parsed.data);
    if (!media.success) {
      return {
        ok: false,
        state: {
          status: "error",
          message: "有幾個欄位需要調整；內容仍保留在畫面上。",
          fieldErrors: media.errors,
        },
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
        where: { id, vendorId, updatedAt: expectedUpdatedAt! },
        data,
      });
      if (updated.count !== 1) {
        return {
          ok: false,
          state: {
            status: "error",
            message: "這張表單已有較新的版本或已不存在；系統沒有覆蓋它。請重新整理後確認內容。",
            fieldErrors: { root: "偵測到版本衝突，未儲存本次變更。" },
          },
        };
      }
      savedId = id;
    } else {
      const projectValue = formData.get("projectId");
      if (projectValue !== null && projectValue !== "") {
        // Resolve tenant ownership and persist the relation atomically.
        savedId = await db.$transaction(async (tx) => {
          const projectId = await resolveSalesProjectBinding(tx, vendorId, projectValue);
          const created = await tx.registrationForm.create({ data: { ...data, vendorId, projectId } });
          return created.id;
        });
      } else {
        savedId = (await db.registrationForm.create({ data: { ...data, vendorId } })).id;
      }
    }
  } catch (error) {
    if (error instanceof SalesProjectBindingError) {
      return {
        ok: false,
        state: { status: "error", message: "找不到目前商家可用的專案，未儲存本次變更。", fieldErrors: { root: "請返回專案頁重新開啟新增流程。" } },
      };
    }
    const code = databaseErrorCode(error);
    if (code === "P2002") {
      return {
        ok: false,
        reason: "slug_taken",
        state: {
          status: "error",
          message: "這個公開網址已被使用；請換一個後再儲存。",
          fieldErrors: { slug: "這個公開網址已被使用。" },
        },
      };
    }
    if (code === "P2025") {
      return {
        ok: false,
        state: {
          status: "error",
          message: "這張表單已不存在或不屬於目前商家，請返回列表確認。",
          fieldErrors: { root: "找不到可編輯的表單。" },
        },
      };
    }
    return {
      ok: false,
      state: {
        status: "error",
        message: "暫時無法儲存；畫面內容仍保留，請稍後重試。",
        fieldErrors: { root: "儲存服務暫時無法使用。" },
      },
    };
  }

  return { ok: true, form: { id: savedId, name: input.name } };
}
