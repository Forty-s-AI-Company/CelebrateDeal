import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { liveReadyVideoWhere } from "@/lib/live-video-readiness";
import { parseZonedDateTimeLocal } from "@/lib/zoned-date-time";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { instantiateFunnelTemplate } from "@/lib/funnel-template-gallery";
import { replaceFunnelStepPage } from "@/lib/funnel-step-pages";
import type { FunnelNode } from "@/lib/funnel-page-document";
import { publishOwnedSalesProject } from "@/lib/sales-project-publication";

export const QuickWebinarInputSchema = z.object({
  requestId: z.string().uuid(),
  videoId: z.string().trim().min(1).max(128),
  startsAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u),
  title: z.string().trim().max(120).default(""),
}).strict();
export type QuickWebinarInput = z.infer<typeof QuickWebinarInputSchema>;
export class QuickWebinarInputError extends Error {
  constructor(public readonly code: "video_unavailable" | "schedule_invalid" | "project_unavailable" | "request_conflict") { super(code); }
}
type Context = { vendorId: string; userId: string; timeZone: string; projectId: string | null };

async function publishInitialQuickProject(tx: Prisma.TransactionClient, context: Context, project: { id: string; status: string; publishedAt: Date | null }, allowAttempt = true) {
  if (project.status === "published" && project.publishedAt) return true;
  // 只自動發布從未上線的草稿；已有發布歷史或人工調整時，保留原管理入口。
  if (!allowAttempt || project.status !== "draft" || project.publishedAt) return false;
  if ((await publishOwnedSalesProject(tx, context.vendorId, project.id)).status !== "published") return false;
  await tx.auditLog.create({ data: { vendorId: context.vendorId, actorId: context.userId, actorLabel: "vendor_manager", action: "publish_quick_webinar_project", targetType: "SalesProject", targetId: project.id } });
  return true;
}

/** 固定使用伺服器影片長度與商家時區；只讓使用者決定影片、時間、選填名稱。 */
export function quickWebinarSchedule(local: string, timeZone: string, durationSec: number, now = new Date()) {
  let startsAt: Date;
  try { startsAt = parseZonedDateTimeLocal(local, timeZone); }
  catch { throw new QuickWebinarInputError("schedule_invalid"); }
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 43_200 || startsAt.getTime() <= now.getTime() + 60_000) throw new QuickWebinarInputError("schedule_invalid");
  const endsAt = new Date(startsAt.getTime() + Math.ceil(durationSec) * 1000);
  return { startsAt, endsAt, replayEndsAt: new Date(endsAt.getTime() + 7 * 86_400_000) };
}

export function quickWebinarContent(key: string, title: string, slug: string, timeZone: string, schedule: ReturnType<typeof quickWebinarSchedule>) {
  let content = createGoalFunnelStepPages({ id: `quick_${key}`, name: title, domain: slug, goal: "webinar" });
  if (!content) throw new Error("quick_webinar_document_invalid");
  const registration = content.flow.steps.find(s => s.type === "webinar_registration_page")!;
  const replaced = replaceFunnelStepPage(content, registration.id, instantiateFunnelTemplate("webinar-course-registration"), "webinar-course-registration");
  if (!replaced.ok) throw new Error("quick_webinar_document_invalid");
  content = replaced.state;
  content.flow.webinar = { timezone: timeZone, startsAt: schedule.startsAt.toISOString(), endsAt: schedule.endsAt.toISOString(), replayEndsAt: schedule.replayEndsAt.toISOString() };
  // 不把範例講者或「席次已保留」帶到新場次；公開表單仍使用原 Email 確認流程。
  for (const step of content.flow.steps) {
    const visit = (nodes: FunnelNode[]) => nodes.forEach(node => {
      if (node.type === "headline" && node.props.level === "h1") node.props.text = step.type === "webinar_registration_page" ? title : step.type === "webinar_thank_you_page" ? "已收到報名資料，請完成 Email 確認" : `${title}｜播放與回放`;
      if (node.id.endsWith("_speaker_title")) node.props.text = "參加方式";
      if (node.id.endsWith("_speaker_text")) node.props.text = "報名後請完成 Email 確認，再依活動時間使用觀看入口。";
      if (node.id.endsWith("_intro") && step.type === "webinar_registration_page") node.props.text = "報名參加這場線上講座，活動時間與觀看入口會顯示在本頁。";
      if (node.id.endsWith("_live_badge")) node.props.text = "活動播放與回放";
      if (node.children) visit(node.children);
    });
    visit(content.pages[step.id]!.root);
  }
  return content;
}

/** 建場寫入同一交易；穩定資源 ID 防止同一表單重送建立多套資源。 */
export async function prepareQuickWebinar(db: PrismaClient, context: Context, input: QuickWebinarInput) {
  const parsed = QuickWebinarInputSchema.parse(input);
  const key = parsed.requestId.replaceAll("-", "");
  const pageId = `qw_page_${key}`;
  return db.$transaction(async tx => {
    const video = await tx.video.findFirst({ where: { ...liveReadyVideoWhere(context.vendorId, parsed.videoId), sourceType: { in: ["url", "cloudflare_stream"] }, durationSec: { gt: 0, lte: 43_200 } }, select: { id: true, title: true, durationSec: true } });
    if (!video?.durationSec) throw new QuickWebinarInputError("video_unavailable");
    const title = parsed.title || video.title.trim().slice(0, 120) || "我的線上講座";
    const existing = await tx.landingPage.findFirst({ where: { id: pageId, vendorId: context.vendorId }, select: { id: true, slug: true, projectId: true, name: true, revision: true, unpublishedAt: true, draftLive: { select: { id: true, videoId: true, scheduledAt: true } } } });
    if (existing) {
      let requestedStart: Date;
      try { requestedStart = parseZonedDateTimeLocal(parsed.startsAtLocal, context.timeZone); }
      catch { throw new QuickWebinarInputError("schedule_invalid"); }
      if (existing.projectId !== context.projectId || (parsed.title && existing.name !== parsed.title) || existing.draftLive?.videoId !== video.id || existing.draftLive.scheduledAt.getTime() !== requestedStart.getTime()) throw new QuickWebinarInputError("request_conflict");
      const project = await tx.salesProject.findFirst({ where: { id: existing.projectId!, vendorId: context.vendorId, status: { not: "archived" } }, select: { id: true, status: true, publishedAt: true } });
      if (!project) throw new QuickWebinarInputError("project_unavailable");
      const projectReady = await publishInitialQuickProject(tx, context, project, existing.revision === 1 && !existing.unpublishedAt);
      return { pageId, slug: existing.slug, liveId: existing.draftLive.id, projectId: existing.projectId!, projectReady, reused: true };
    }
    const schedule = quickWebinarSchedule(parsed.startsAtLocal, context.timeZone, video.durationSec);
    let project = context.projectId ? await tx.salesProject.findFirst({ where: { id: context.projectId, vendorId: context.vendorId, status: { not: "archived" }, primaryFlow: "live" }, select: { id: true, status: true, publishedAt: true } }) : null;
    if (context.projectId && !project) throw new QuickWebinarInputError("project_unavailable");
    if (!project) {
      project = await tx.salesProject.create({ data: { id: `qw_project_${key}`, vendorId: context.vendorId, name: title, slug: `quick-${key}`, mode: "live_course", primaryFlow: "live", onboardingEnabled: true }, select: { id: true, status: true, publishedAt: true } });
      await tx.userOnboardingPreference.upsert({ where: { userId_vendorId: { userId: context.userId, vendorId: context.vendorId } }, create: { userId: context.userId, vendorId: context.vendorId, selectedProjectId: project.id, selectedMode: "live_course", taskPanelCollapsed: true }, update: { selectedProjectId: project.id } });
    }
    const slug = `quick-webinar-${key}`;
    const form = await tx.registrationForm.create({ data: { id: `qw_form_${key}`, vendorId: context.vendorId, projectId: project.id, name: `${title}｜報名`, slug, headline: title, fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }], submitLabel: "送出報名", successMessage: "已收到資料，請完成 Email 確認。" } });
    const confirmation = await tx.messageTemplate.create({ data: { id: `qw_confirm_${key}`, vendorId: context.vendorId, name: `${title}｜報名確認`, channel: "email", trigger: "registration_confirmed", subject: "{{live_title}} 報名已確認", body: "{{name}}，你的報名與 Email 已確認。\n活動時間：{{live_start_at}}\n觀看入口：{{live_url}}\n取消訂閱：{{unsubscribe_url}}", isActive: true } });
    const reminder = await tx.messageTemplate.create({ data: { id: `qw_reminder_${key}`, vendorId: context.vendorId, name: `${title}｜開播提醒`, channel: "email", trigger: "live_reminder", subject: "{{live_title}} 即將開始", body: "{{name}}，活動將於 {{live_start_at}} 開始。\n觀看入口：{{live_url}}\n取消訂閱：{{unsubscribe_url}}", isActive: true } });
    const live = await tx.live.create({ data: { id: `qw_live_${key}`, vendorId: context.vendorId, projectId: project.id, videoId: video.id, formId: form.id, messageTemplateId: confirmation.id, title, slug, scheduledAt: schedule.startsAt, status: "scheduled", streamMode: "vod", replayEnabled: true, replayAvailableUntil: schedule.replayEndsAt } });
    await tx.liveNotificationRule.create({ data: { id: `qw_rule_${key}`, vendorId: context.vendorId, liveId: live.id, messageTemplateId: reminder.id, trigger: "before_live", offsetMinutes: 60, sortOrder: 0, isActive: true } });
    const content = quickWebinarContent(key, title, slug, context.timeZone, schedule);
    await tx.landingPage.create({ data: { id: pageId, vendorId: context.vendorId, projectId: project.id, name: title, slug, draftFormId: form.id, draftLiveId: live.id, draftContent: content as unknown as Prisma.InputJsonValue } });
    // 既有已發布專案維持原語意；草稿專案用與原發布入口完全相同的條件檢查。
    const projectReady = await publishInitialQuickProject(tx, context, project);
    await tx.auditLog.create({ data: { vendorId: context.vendorId, actorId: context.userId, actorLabel: "vendor_manager", action: "create_quick_webinar", targetType: "Live", targetId: live.id, after: { pageId, projectId: project.id, videoId: video.id, projectReady } } });
    return { pageId, slug, liveId: live.id, projectId: project.id, projectReady, reused: false };
  }, { timeout: 15_000 });
}
