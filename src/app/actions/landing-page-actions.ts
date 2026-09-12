"use server";

import { revalidatePath } from "next/cache";
import { assertServerActionSecurity } from "@/lib/csrf";
import {
  createLandingPage,
  duplicateLandingPage,
  LandingPageConflictError,
  LandingPageInputError,
  LandingPageNotFoundError,
  LandingPageScopeError,
  publishLandingPage,
  rollbackLandingPage,
  saveLandingPageDraft,
  unpublishLandingPage,
  type LandingPageActionState,
} from "@/lib/landing-page-service";

const MAX_CONTENT_BYTES = 128 * 1024;

type LandingPageOperation = "create" | "save" | "publish" | "unpublish" | "duplicate" | "rollback";

function value(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  return raw || null;
}

function revision(formData: FormData, key = "revision") {
  const raw = value(formData, key);
  if (!/^\d+$/u.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function operation(formData: FormData): LandingPageOperation | null {
  const raw = value(formData, "operation");
  return raw === "create" || raw === "save" || raw === "publish" || raw === "unpublish" || raw === "duplicate" || raw === "rollback"
    ? raw
    : null;
}

function draftFrom(formData: FormData) {
  const rawContent = value(formData, "content");
  if (!rawContent || Buffer.byteLength(rawContent, "utf8") > MAX_CONTENT_BYTES) return null;
  try {
    return {
      name: value(formData, "name"),
      slug: value(formData, "slug"),
      formId: optionalValue(formData, "formId"),
      liveId: optionalValue(formData, "liveId"),
      content: JSON.parse(rawContent) as unknown,
    };
  } catch {
    return null;
  }
}

function failure(error: unknown): LandingPageActionState {
  if (error instanceof LandingPageConflictError) {
    return { status: "error", message: "這個頁面已有較新的版本，系統沒有覆蓋它。請重新整理後再試。" };
  }
  if (error instanceof LandingPageScopeError) {
    return { status: "error", message: "請先選擇一個銷售專案後再管理一頁式網站。" };
  }
  if (error instanceof LandingPageNotFoundError) {
    return { status: "error", message: "找不到這個一頁式網站，或你沒有管理它的權限。" };
  }
  if (error instanceof LandingPageInputError) {
    return { status: "error", message: "請確認頁面內容與已選的報名表單、直播都屬於目前專案且可公開使用。" };
  }
  return { status: "error", message: "暫時無法完成操作；內容仍保留，請稍後再試。" };
}

function success(message: string, result: { id: string; revision?: number }) {
  revalidatePath("/landing-pages");
  revalidatePath(`/landing-pages/${encodeURIComponent(result.id)}`);
  return { status: "success" as const, message, id: result.id, ...(result.revision ? { revision: result.revision } : {}) };
}

/**
 * The page editor uses a single CSRF-protected action. Tenant identity and the
 * selected project are derived again inside each service mutation.
 */
export async function landingPageAction(
  _previousState: LandingPageActionState,
  formData: FormData,
): Promise<LandingPageActionState> {
  try {
    await assertServerActionSecurity(formData);
    const command = operation(formData);
    if (!command) return { status: "error", message: "不支援的頁面操作。" };
    const id = value(formData, "id");

    if (command === "create") {
      const draft = draftFrom(formData);
      if (!draft) return { status: "error", message: "頁面內容格式不正確或資料過大，請重新整理後再試。" };
      const created = await createLandingPage(draft);
      return success("草稿已建立。", created);
    }

    if (command === "save") {
      const draft = draftFrom(formData);
      const expectedRevision = revision(formData);
      if (!id || !draft || !expectedRevision) return { status: "error", message: "頁面版本資訊不完整，請重新整理後再儲存。" };
      const saved = await saveLandingPageDraft({ id, revision: expectedRevision, ...draft });
      return success("草稿已儲存。", saved);
    }

    if (command === "publish") {
      const expectedRevision = revision(formData);
      if (!id || !expectedRevision) return { status: "error", message: "頁面版本資訊不完整，請重新整理後再發布。" };
      const published = await publishLandingPage(id, expectedRevision);
      return success(`版本 v${published.version} 已發布。`, published);
    }

    if (command === "unpublish") {
      const expectedRevision = revision(formData);
      if (!id || !expectedRevision) return { status: "error", message: "頁面版本資訊不完整，請重新整理後再取消發布。" };
      return success("已取消發布；歷史版本與草稿都仍保留。", await unpublishLandingPage(id, expectedRevision));
    }

    if (command === "duplicate") {
      if (!id) return { status: "error", message: "找不到要複製的一頁式網站。" };
      const duplicate = await duplicateLandingPage(id);
      return success("已建立草稿副本。", duplicate);
    }

    const expectedRevision = revision(formData);
    const targetVersion = revision(formData, "version");
    if (!id || !expectedRevision || !targetVersion) return { status: "error", message: "版本資訊不完整，請重新整理後再回復草稿。" };
    return success("已從歷史版本重建草稿；公開頁面不會在再次發布前改變。", await rollbackLandingPage(id, targetVersion, expectedRevision));
  } catch (error) {
    return failure(error);
  }
}
