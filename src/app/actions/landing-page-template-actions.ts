"use server";

import { revalidatePath } from "next/cache";
import type { PageDocument } from "@/lib/funnel-page-document";
import { assertServerActionSecurity } from "@/lib/csrf";
import { funnelCustomCodeErrorMessage } from "@/lib/funnel-custom-code-messages";
import {
  LandingPageConflictError,
  LandingPageInputError,
  LandingPageNotFoundError,
  LandingPageScopeError,
} from "@/lib/landing-page-service";
import { LANDING_PAGE_MAX_CONTENT_BYTES } from "@/lib/landing-page-limits";
import { LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH, LANDING_PAGE_TEMPLATE_VENDOR_LIMIT } from "@/lib/landing-page-template-document";
import {
  applyLandingPageTemplateToStep,
  createLandingPageFromTemplate,
  deleteLandingPageTemplate,
  getLandingPagePlatformTemplateDocument,
  getLandingPageStepTemplatePreview,
  instantiateLandingPageStepTemplate,
  getLandingPageTemplateDocument,
  getLandingPageTemplateTarget,
  LandingPageTemplateInputError,
  LandingPageTemplateNotFoundError,
  renameLandingPageTemplate,
  saveLandingPageTemplateFromStep,
  type LandingPageTemplateSource,
  type LandingPageTemplateTarget,
} from "@/lib/landing-page-template-service";

export type LandingPageTemplateActionState = {
  status: "idle" | "success" | "error";
  message: string;
  id?: string;
  revision?: number;
  stepId?: string;
  /** Set when the page changed since the merchant loaded it. */
  code?: "conflict";
};

const TEMPLATES_PATH = "/landing-pages/templates";

function value(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function source(formData: FormData): LandingPageTemplateSource | null {
  const kind = value(formData, "templateKind");
  const id = value(formData, "templateId");
  return (kind === "platform" || kind === "mine") && id ? { kind, id } : null;
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
}

const INPUT_MESSAGES: Record<LandingPageTemplateInputError["code"], string> = {
  name_invalid: `請輸入 1–${LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH} 個字的範本名稱。`,
  content_invalid: "範本內容無法套用到這個步驟，頁面沒有變更。",
  content_too_large: `內容超過 ${LANDING_PAGE_MAX_CONTENT_BYTES / 1024} KiB 上限（或頁面格式需要修復），這次沒有任何變更。請精簡頁面內容，或改用較小的範本後再試。`,
  limit_reached: `每個商家最多可保存 ${LANDING_PAGE_TEMPLATE_VENDOR_LIMIT} 個範本，請先刪除不需要的範本。`,
  step_invalid: "找不到這個步驟，或這個步驟由系統管理，不能使用範本。",
  template_incompatible: "這個範本不適用所選的網站類型或步驟，請改選其他步驟或範本。",
  funnel_required: "這個網站是舊版單頁格式，請先在編輯器開啟並儲存一次，再套用範本。",
  create_invalid: "請確認名稱、網址與網站目標後再建立。",
};

/**
 * Domain refusals become a message; anything else (including the redirect a
 * role guard throws for partner/support) is rethrown so it is never reported
 * as a normal failure or swallowed.
 */
function failure(error: unknown): LandingPageTemplateActionState {
  if (error instanceof LandingPageTemplateInputError) return { status: "error", message: INPUT_MESSAGES[error.code] };
  if (error instanceof LandingPageTemplateNotFoundError) return { status: "error", message: "找不到這個範本，或你沒有使用它的權限。" };
  if (error instanceof LandingPageNotFoundError) return { status: "error", message: "找不到這個一頁式網站，或你沒有管理它的權限。" };
  if (error instanceof LandingPageConflictError) return { status: "error", code: "conflict", message: "這個網站已有較新的版本，系統沒有覆蓋它。請重新讀取網站後再套用。" };
  if (error instanceof LandingPageScopeError || (error instanceof Error && error.message === "sales_project_required")) return { status: "error", message: "請先選擇一個銷售專案，再使用範本建立或套用網站。" };
  if (error instanceof LandingPageInputError) {
    const customCodeMessage = funnelCustomCodeErrorMessage(error.message);
    if (customCodeMessage) return { status: "error", message: customCodeMessage };
    if (error.message === "landing_page_live_form_mismatch") return { status: "error", message: "這個網站已綁定活動場次，套用後的報名按鈕必須使用該場次的報名表。請先在頁面設定調整場次，再套用範本。" };
    if (error.message === "landing_page_step_type_not_allowed") return { status: "error", message: "這個網站目標不能新增範本需要的步驟類型，請改選其他網站目標。" };
    return { status: "error", message: "請確認範本內容與網站已綁定的表單、直播都屬於目前專案。" };
  }
  const code = databaseErrorCode(error);
  if (code === "P2002") return { status: "error", message: "這個網址已被使用，請換一個一頁式網站網址。" };
  // Interactive transaction timed out (for example waiting on the per-vendor template lock).
  if (code === "P2028") return { status: "error", message: "系統忙碌中，這次沒有任何變更，請稍後再試。" };
  throw error;
}

export async function saveLandingPageTemplateAction(_previous: LandingPageTemplateActionState, formData: FormData): Promise<LandingPageTemplateActionState> {
  await assertServerActionSecurity(formData);
  try {
    const saved = await saveLandingPageTemplateFromStep({ pageId: value(formData, "pageId"), stepId: value(formData, "stepId") || null, name: value(formData, "name") });
    revalidatePath(TEMPLATES_PATH);
    return { status: "success", message: `已存成範本「${saved.name}」，可在「範本 › 我的範本」使用。`, id: saved.id };
  } catch (error) {
    return failure(error);
  }
}

export async function renameLandingPageTemplateAction(_previous: LandingPageTemplateActionState, formData: FormData): Promise<LandingPageTemplateActionState> {
  await assertServerActionSecurity(formData);
  try {
    const renamed = await renameLandingPageTemplate({ templateId: value(formData, "templateId"), name: value(formData, "name") });
    revalidatePath(TEMPLATES_PATH);
    return { status: "success", message: `範本已改名為「${renamed.name}」。`, id: renamed.id };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteLandingPageTemplateAction(_previous: LandingPageTemplateActionState, formData: FormData): Promise<LandingPageTemplateActionState> {
  await assertServerActionSecurity(formData);
  try {
    const deleted = await deleteLandingPageTemplate(value(formData, "templateId"));
    revalidatePath(TEMPLATES_PATH);
    return { status: "success", message: "範本已刪除；已套用過的網站內容不受影響。", id: deleted.id };
  } catch (error) {
    return failure(error);
  }
}

export async function applyLandingPageTemplateAction(_previous: LandingPageTemplateActionState, formData: FormData): Promise<LandingPageTemplateActionState> {
  await assertServerActionSecurity(formData);
  const template = source(formData);
  if (!template) return { status: "error", message: "請先選擇要使用的範本。" };
  const revision = Number(value(formData, "revision"));
  try {
    const saved = await applyLandingPageTemplateToStep({ pageId: value(formData, "pageId"), stepId: value(formData, "stepId"), revision, source: template });
    revalidatePath("/landing-pages");
    revalidatePath(`/landing-pages/${encodeURIComponent(saved.id)}`);
    return { status: "success", message: "範本已套用；可以前往編輯器調整內容。", id: saved.id, revision: saved.revision, stepId: value(formData, "stepId") };
  } catch (error) {
    return failure(error);
  }
}

export async function createLandingPageFromTemplateAction(_previous: LandingPageTemplateActionState, formData: FormData): Promise<LandingPageTemplateActionState> {
  await assertServerActionSecurity(formData);
  const template = source(formData);
  if (!template) return { status: "error", message: "請先選擇要使用的範本。" };
  try {
    const created = await createLandingPageFromTemplate({
      name: value(formData, "name"), slug: value(formData, "slug"), goal: value(formData, "goal"), currency: value(formData, "currency"), source: template,
    });
    revalidatePath("/landing-pages");
    return { status: "success", message: "已用範本建立一頁式網站草稿。", id: created.id, stepId: created.stepId };
  } catch (error) {
    return failure(error);
  }
}

/** Read for the 「套用到現有網站」 step picker; ownership is checked in the service. */
export async function readLandingPageTemplateTargetAction(pageId: string): Promise<{ ok: true; target: LandingPageTemplateTarget } | { ok: false; message: string }> {
  try {
    return { ok: true, target: await getLandingPageTemplateTarget(pageId) };
  } catch (error) {
    return { ok: false, message: failure(error).message };
  }
}

/** Full document of a platform template for the preview; the library list only carries thumbnails. */
export async function readPlatformTemplateDocumentAction(templateId: string): Promise<{ ok: true; document: PageDocument } | { ok: false; message: string }> {
  try {
    return { ok: true, document: await getLandingPagePlatformTemplateDocument(templateId) };
  } catch (error) {
    return { ok: false, message: failure(error).message };
  }
}

/** Full document of an own template for the preview; ownership is checked in the service. */
export async function readLandingPageTemplateDocumentAction(templateId: string): Promise<{ ok: true; document: PageDocument } | { ok: false; message: string }> {
  try {
    return { ok: true, document: await getLandingPageTemplateDocument(templateId) };
  } catch (error) {
    return { ok: false, message: failure(error).message };
  }
}

type StepTemplateRequest = { goal: string; stepType: string; templateId: string };

/** Full document of a step-picker template for the preview; thumbnails come with the page. */
export async function readStepTemplatePreviewAction(request: StepTemplateRequest): Promise<{ ok: true; document: PageDocument } | { ok: false; message: string }> {
  try {
    return { ok: true, document: await getLandingPageStepTemplatePreview(request) };
  } catch (error) {
    return { ok: false, message: failure(error).message };
  }
}

/** Fresh document (new node ids) of a step-picker template, built on the server when the merchant applies it. */
export async function instantiateStepTemplateAction(request: StepTemplateRequest & { pageId: string }): Promise<{ ok: true; document: PageDocument } | { ok: false; message: string }> {
  try {
    return { ok: true, document: await instantiateLandingPageStepTemplate(request) };
  } catch (error) {
    return { ok: false, message: failure(error).message };
  }
}
