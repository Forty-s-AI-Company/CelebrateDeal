"use server";

import { revalidatePath } from "next/cache";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { requireEditableSalesProjectScope } from "@/lib/sales-project-scope";
import { QuickWebinarInputSchema, QuickWebinarInputError, prepareQuickWebinar } from "@/lib/quick-webinar";
import { getLandingPagePublicationStatus, publishLandingPage } from "@/lib/landing-page-service";

export type QuickWebinarState = {
  status: "idle" | "ready" | "needs_attention" | "error";
  message: string;
  publicUrl?: string;
  editorUrl?: string;
  liveUrl?: string;
  missing?: Array<{ label: string; href: string }>;
};

export async function createQuickWebinarAction(_previous: QuickWebinarState, formData: FormData): Promise<QuickWebinarState> {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const parsed = QuickWebinarInputSchema.safeParse(Object.fromEntries(["requestId", "videoId", "startsAtLocal", "title"].map(key => [key, formData.get(key) ?? ""])));
  if (!parsed.success) return { status: "error", message: "請選擇影片、有效時間，並確認名稱不超過 120 字。" };
  let created: Awaited<ReturnType<typeof prepareQuickWebinar>>;
  try {
    const scope = await requireEditableSalesProjectScope(auth.user.id, vendor.id);
    created = await prepareQuickWebinar(getDb(), { vendorId: vendor.id, userId: auth.user.id, timeZone: vendor.timezone, projectId: scope.projectId }, parsed.data);
  } catch (error) {
    const message = error instanceof QuickWebinarInputError
      ? { video_unavailable: "影片尚未就緒、缺少長度，或已無法使用，請重新選擇。", schedule_invalid: "請填入商家時區中的有效未來時間；夏令時間重複或不存在的時間無法使用。", project_unavailable: "目前專案不適合建立線上講座，請先選取有效的直播專案。", request_conflict: "這個建立請求已使用不同設定，請到既有場次調整。" }[error.code]
      : error instanceof Error && error.message === "sales_project_required" ? "請先從專案選單選取專案，再建立線上講座。" : "目前無法完成建立，請稍後以相同設定重試。";
    return { status: "error", message };
  }
  revalidatePath("/", "layout");
  const links = { editorUrl: `/landing-pages/${created.pageId}`, liveUrl: `/lives/${created.liveId}/edit` };
  try {
    const page = await getDb().landingPage.findFirst({ where: { id: created.pageId, vendorId: vendor.id, projectId: created.projectId }, select: { status: true, revision: true, unpublishedAt: true } });
    if (!page || page.unpublishedAt) return { status: "needs_attention", message: "先前場次的頁面已停止發布，請在設定頁確認後再發布。", ...links };
    if (created.reused && page.status !== "published" && page.revision > 1) return { status: "needs_attention", message: "草稿已經調整過，請在頁面設定確認內容後發布。", ...links };
    if (created.projectReady && page.status !== "published") await publishLandingPage(created.pageId, page.revision);
    const publication = await getLandingPagePublicationStatus(created.pageId);
    revalidatePath("/lives");
    revalidatePath("/landing-pages");
    if (!publication.available) return { status: "needs_attention", message: publication.message, missing: publication.missing, ...links };
    return { status: "ready", message: "已建立並發布報名、確認與播放頁。提醒設定已建立，實際寄送仍依排程與收件設定。", publicUrl: `/lp/${created.slug}`, ...links };
  } catch {
    return { status: "needs_attention", message: "場次與草稿已建立，發布尚未完成。請開啟設定頁檢查資源與發布狀態。", ...links };
  }
}
