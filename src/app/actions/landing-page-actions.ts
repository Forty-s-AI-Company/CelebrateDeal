"use server";

import { revalidatePath } from "next/cache";
import { assertServerActionSecurity } from "@/lib/csrf";
import {
  createLandingPage,
  deleteLandingPage,
  duplicateLandingPage,
  LandingPageConflictError,
  LandingPageInputError,
  LandingPageNotFoundError,
  LandingPageScopeError,
  publishLandingPage,
  rollbackLandingPage,
  saveLandingPageDraft,
  saveLandingPageStepMetadata,
  unpublishLandingPage,
  type LandingPageActionState,
} from "@/lib/landing-page-service";
import type { FunnelStepPersistenceMutation } from "@/lib/funnel-step-pages";

const MAX_CONTENT_BYTES = 128 * 1024;

type LandingPageOperation = "create" | "save" | "save_steps" | "publish" | "unpublish" | "duplicate" | "rollback" | "delete";

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
  return raw === "create" || raw === "save" || raw === "save_steps" || raw === "publish" || raw === "unpublish" || raw === "duplicate" || raw === "rollback" || raw === "delete"
    ? raw
    : null;
}

function stepMutation(formData: FormData): FunnelStepPersistenceMutation | null {
  const raw = value(formData, "mutation");
  if (!raw || Buffer.byteLength(raw, "utf8") > 8 * 1024) return null;
  try {
    const candidate = JSON.parse(raw) as Record<string, unknown>;
    if (candidate.type === "rename" && typeof candidate.stepId === "string" && typeof candidate.name === "string") return candidate as FunnelStepPersistenceMutation;
    if (candidate.type === "set_path" && typeof candidate.stepId === "string" && typeof candidate.path === "string") return candidate as FunnelStepPersistenceMutation;
    if (candidate.type === "remove" && typeof candidate.stepId === "string") return candidate as FunnelStepPersistenceMutation;
    if (candidate.type === "move" && typeof candidate.stepId === "string" && Number.isSafeInteger(candidate.toIndex)) return candidate as FunnelStepPersistenceMutation;
    if (candidate.type === "add" && candidate.input && typeof candidate.input === "object" && (candidate.index === undefined || Number.isSafeInteger(candidate.index))) return candidate as FunnelStepPersistenceMutation;
    return null;
  } catch { return null; }
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
    if (error.message === "landing_page_webinar_direct_media_forbidden") return { status: "error", message: "請移除 Webinar 播放頁與彈出視窗中的直接影片元件，並綁定 Live，透過授權播放入口觀看。" };
    if (error.message === "landing_page_webinar_steps_required") return { status: "error", message: "Webinar 必須各有一個報名頁、感謝頁與播放頁，請先補齊必要步驟再發布。" };
    if (error.message === "landing_page_webinar_resources_required") return { status: "error", message: "Webinar 尚未具備可發布的資源。請選擇同專案的報名表與 Live，確認 Live 使用相同表單，且來源影片已處理完成。" };
    if (error.message === "landing_page_webinar_schedule_required") return { status: "error", message: "請先設定 Webinar 的開始與結束時間，再重新發布。" };
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


    if (command === "save_steps") {
      const expectedRevision = revision(formData);
      const mutation = stepMutation(formData);
      if (!id || !expectedRevision || !mutation) return { status: "error", message: "步驟資料或版本資訊不完整，請重新整理後再試。" };
      return success("步驟已自動儲存。", await saveLandingPageStepMetadata({ id, revision: expectedRevision, mutation }));
    }

    if (command === "delete") {
      const expectedRevision = revision(formData);
      if (!id || !expectedRevision) return { status: "error", message: "頁面版本資訊不完整，請重新整理後再刪除。" };
      return success("Funnel、草稿與所有發布歷史已刪除。", await deleteLandingPage(id, expectedRevision));
    }

    const expectedRevision = revision(formData);
    const targetVersion = revision(formData, "version");
    if (!id || !expectedRevision || !targetVersion) return { status: "error", message: "版本資訊不完整，請重新整理後再回復草稿。" };
    return success("已從歷史版本重建草稿；公開頁面不會在再次發布前改變。", await rollbackLandingPage(id, targetVersion, expectedRevision));
  } catch (error) {
    return failure(error);
  }
}
