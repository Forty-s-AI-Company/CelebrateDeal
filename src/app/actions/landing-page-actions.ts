"use server";

import { revalidatePath } from "next/cache";
import { assertServerActionSecurity } from "@/lib/csrf";
import {
  createLandingPage,
  deleteLandingPage,
  duplicateLandingPage,
  getLandingPagePublicationStatus,
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
import { independentPublishLimitMessage, INDEPENDENT_PUBLISH_DISABLED_MESSAGE, INDEPENDENT_PUBLISH_EMAIL_UNVERIFIED_MESSAGE } from "@/lib/independent-publish-limit";

const INDEPENDENT_PUBLISH_REFUSALS = new Set(["landing_page_independent_publish_limit", "landing_page_independent_publish_disabled", "landing_page_independent_publish_email_unverified"]);

// Custom code nodes may hold up to 50 KB HTML + 20 KB CSS + 50 KB JS each (JSON-escaped here).
const MAX_CONTENT_BYTES = 512 * 1024;

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
    if (error.message === "landing_page_operations_reference_invalid") return { status: "error", message: "這個步驟仍被 A/B、期限導向或報表設定使用。請先在 Funnel 管理調整設定，再移除或改名路徑。" };
    if (error.message === "landing_page_commerce_invalid") return { status: "error", message: "已綁定的商品必須屬於目前銷售專案，且目前可販售、有庫存、已確認交付設定，並且不能使用外部結帳連結。請重新選擇商品或調整商品設定後再試。" };
    if (error.message === "landing_page_webinar_direct_media_forbidden") return { status: "error", message: "請移除 Webinar 播放頁與彈出視窗中的直接影片元件，並綁定 Live，透過授權播放入口觀看。" };
    if (error.message === "landing_page_webinar_steps_required") return { status: "error", message: "Webinar 必須各有一個報名頁、感謝頁與播放頁，請先補齊必要步驟再發布。" };
    if (error.message === "landing_page_webinar_resources_required") return { status: "error", message: "Webinar 尚未具備可發布的資源。請選擇同專案的報名表與 Live，確認 Live 使用相同表單，且來源影片已處理完成。" };
    if (error.message === "landing_page_webinar_schedule_required") return { status: "error", message: "請先設定 Webinar 的開始與結束時間，再重新發布。" };
    if (error.message === "landing_page_audience_live_requires_project") return { status: "error", message: "這個名單型一頁式網站綁定了直播，直播要等所屬專案發布後才能公開。請先移除直播綁定，或先發布專案，再發布網站。" };
    if (error.message === "landing_page_live_form_mismatch") return { status: "error", message: "這個頁面已綁定活動場次，所有報名按鈕都必須使用該場次的報名表。請把按鈕改成該場次的報名表，或在頁面設定改選場次後再試。" };
    if (error.message === "landing_page_lead_form_retry") return { status: "error", message: "建立名單表單時剛好與另一個操作衝突，網站尚未發布。請再按一次發布。" };
    if (error.message === "landing_page_independent_publish_limit") return { status: "error", message: independentPublishLimitMessage() };
    if (error.message === "landing_page_independent_publish_disabled") return { status: "error", message: INDEPENDENT_PUBLISH_DISABLED_MESSAGE };
    if (error.message === "landing_page_independent_publish_email_unverified") return { status: "error", message: INDEPENDENT_PUBLISH_EMAIL_UNVERIFIED_MESSAGE };
    if (error.message === "landing_page_custom_code_role") return { status: "error", message: "只有商家擁有者（owner）或管理員（admin）可以新增、修改或刪除自訂程式碼與頁面自訂 CSS，這次變更沒有儲存。" };
    if (error.message === "landing_page_custom_code_email_unverified") return { status: "error", message: "頁面含有自訂 JavaScript，必須先完成 Email 驗證才能儲存或發布。請到「驗證 Email」完成後再試。" };
    if (error.message === "landing_page_custom_code_disabled") return { status: "error", message: "平台已暫時停用自訂 JavaScript，目前無法新增或修改 JS；你仍可刪除 JS 或編輯其他內容。" };
    if (error.message === "landing_page_custom_css_invalid") return { status: "error", message: "頁面自訂 CSS 含有不支援或不安全的語法，這次變更沒有儲存。請依頁面設定中的錯誤提示修正。" };
    if (error.message === "landing_page_custom_code_too_large") return { status: "error", message: "自訂程式碼超過大小上限（HTML 50 KB、CSS 20 KB、JS 50 KB），這次變更沒有儲存。" };
    if (error.message === "landing_page_step_type_not_allowed") return { status: "error", message: "建立名單網站只能新增名單或資訊步驟，這次變更沒有儲存。銷售頁、訂單表單、加購頁與（銷售）感謝頁請建立在銷售網站中；名單的感謝頁請選「名單感謝頁」。" };
    return { status: "error", message: "請確認頁面內容與已選的報名表單、直播都屬於目前專案且可公開使用。" };
  }
  return { status: "error", message: "暫時無法完成操作；內容仍保留，請稍後再試。" };
}

function success(message: string, result: { id: string; revision?: number }) {
  revalidatePath("/landing-pages");
  revalidatePath(`/landing-pages/${encodeURIComponent(result.id)}`);
  return { status: "success" as const, message, id: result.id, ...(result.revision ? { revision: result.revision } : {}) };
}

const PUBLICATION_UNKNOWN = { available: false, message: "尚無法確認公開網址狀態，請重新整理後再查看。", projectHref: "/projects", missing: [] };

/** A diagnosis failure must not report a committed write as failed, but it also must not keep a stale status. */
async function successWithPublication(message: string, result: { id: string; revision?: number }): Promise<LandingPageActionState> {
  const publication = await getLandingPagePublicationStatus(result.id).catch(() => PUBLICATION_UNKNOWN);
  return { ...success(`${message}${publication.message}`, result), publication };
}

/** Publishes; a refusal by the independent publication limit or kill switch carries the scoped diagnosis and its links. */
async function publishWithDiagnosis(id: string, expectedRevision: number): Promise<LandingPageActionState> {
  let published: Awaited<ReturnType<typeof publishLandingPage>>;
  try {
    published = await publishLandingPage(id, expectedRevision);
  } catch (error) {
    if (!(error instanceof LandingPageInputError && INDEPENDENT_PUBLISH_REFUSALS.has(error.message))) throw error;
    const publication = await getLandingPagePublicationStatus(id).catch(() => undefined);
    return { ...failure(error), ...(publication ? { publication } : {}) };
  }
  return { ...await successWithPublication(`Funnel 版本 v${published.version} 已儲存為發布版本。`, published), formId: published.formId };
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
      // Awaited so that other publish errors still reach the shared mapping below.
      return await publishWithDiagnosis(id, expectedRevision);
    }

    if (command === "unpublish") {
      const expectedRevision = revision(formData);
      if (!id || !expectedRevision) return { status: "error", message: "頁面版本資訊不完整，請重新整理後再取消發布。" };
      return successWithPublication("已取消發布；歷史版本與草稿都仍保留。", await unpublishLandingPage(id, expectedRevision));
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
      const result = await deleteLandingPage(id, expectedRevision);
      return success(
        result.archived
          ? "這個一頁式網站已發布過或已有造訪紀錄，已改為封存：公開網址不再開啟，造訪與名單來源紀錄會保留。"
          : "Funnel 與草稿已刪除。",
        result,
      );
    }

    const expectedRevision = revision(formData);
    const targetVersion = revision(formData, "version");
    if (!id || !expectedRevision || !targetVersion) return { status: "error", message: "版本資訊不完整，請重新整理後再回復草稿。" };
    return success("已從歷史版本重建草稿；公開頁面不會在再次發布前改變。", await rollbackLandingPage(id, targetVersion, expectedRevision));
  } catch (error) {
    return failure(error);
  }
}
