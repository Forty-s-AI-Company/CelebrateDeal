import { notFound } from "next/navigation";
import { LiveStepperForm } from "@/components/live-stepper-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { LiveStudioDraftPayloadSchema } from "@/lib/live-studio-draft";
import { parseLiveQuotaPolicy } from "@/lib/live-quota-policy";
import { liveReadyVideoWhere } from "@/lib/live-video-readiness";
import { formatZonedDateTimeLocal } from "@/lib/zoned-date-time";
import {
  hasUsableMessageTemplateContent,
  LIVE_REMINDER_EMAIL_TEMPLATE_WHERE,
  REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
} from "@/lib/message-template";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";

type LiveEditorFormCandidate = { id: string; name: string; fields: unknown };
type LiveEditorTemplateCandidate = {
  id: string;
  name: string;
  channel: string;
  trigger: string;
  subject: string | null;
  body: string;
};

function prepareLiveEditorResources(input: {
  live: { videoId: string | null; formId: string | null; products: Array<{ productId: string }> };
  videos: Array<{ id: string; title: string }>;
  products: Array<{ id: string; name: string; inventory: number }>;
  formCandidates: LiveEditorFormCandidate[];
  templateCandidates: LiveEditorTemplateCandidate[];
}) {
  const forms = input.formCandidates
    .filter((form) => parseRegistrationFormFields(form.fields).success)
    .map(({ id, name }) => ({ id, name }));
  const templates = input.templateCandidates
    .filter(hasUsableMessageTemplateContent)
    .map(({ id, name, channel, trigger }) => ({ id, name, channel, trigger }));
  const hasUnavailableVideo = Boolean(
    input.live.videoId && !input.videos.some((video) => video.id === input.live.videoId),
  );
  const availableProductIds = new Set(input.products.map((product) => product.id));
  const hasUnavailableProduct = input.live.products.some((product) => !availableProductIds.has(product.productId));
  const hasUnavailableForm = Boolean(
    input.live.formId && !forms.some((form) => form.id === input.live.formId),
  );
  return {
    forms,
    templates,
    hasUnavailableVideo,
    hasUnavailableProduct,
    hasUnavailableForm,
    productIds: input.live.products.map((product) => product.productId).filter((productId) => availableProductIds.has(productId)),
    videoId: hasUnavailableVideo ? "" : (input.live.videoId ?? ""),
    formId: hasUnavailableForm ? "" : (input.live.formId ?? ""),
  };
}

function LiveResourceWarnings({
  hasUnavailableScript,
  hasUnavailableVideo,
  hasUnavailableProduct,
  hasUnavailableForm,
  hasUnavailableTemplate,
  hasUnavailableReminderTemplate,
}: {
  hasUnavailableScript: boolean;
  hasUnavailableVideo: boolean;
  hasUnavailableProduct: boolean;
  hasUnavailableForm: boolean;
  hasUnavailableTemplate: boolean;
  hasUnavailableReminderTemplate: boolean;
}) {
  return (
    <>
      {hasUnavailableScript ? <p role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">目前綁定的互動腳本不是已發布版本，公開頁已停止載入；本次儲存會解除綁定，請改選已發布腳本。</p> : null}
      {hasUnavailableVideo ? <p role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">目前綁定的影片或 Live Input 已無法播放；本次儲存會解除綁定，公開前請重新選擇可用媒體。</p> : null}
      {hasUnavailableProduct ? <p role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">目前有商品已停用或尚未確認履約類型；本次儲存會解除這些商品，請確認直播銷售清單。</p> : null}
      {hasUnavailableForm ? <p role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">目前綁定的報名表已停用或缺少必要姓名／Email 欄位；本次儲存會解除綁定。</p> : null}
      {hasUnavailableTemplate ? <p role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">目前綁定的通知模板不是啟用中的「報名成功 Email」，因此不會寄送；本次儲存會解除綁定，請改選可用模板。</p> : null}
      {hasUnavailableReminderTemplate ? <p role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">目前綁定的開播提醒模板已停用或不再有效；本次儲存會解除綁定，請改選啟用中的「開播提醒 Email」。</p> : null}
    </>
  );
}

export default async function EditLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const { error, notice } = await searchParams;
  const db = getDb();
  const [live, videos, products, formCandidates, templateCandidates, scripts, affiliates, streamMemberships, streamQuotaPages, csrfToken, savedDraft] = await Promise.all([
    db.live.findFirst({ where: { id, vendorId: vendor.id }, include: { products: true } }),
    db.video.findMany({
      where: liveReadyVideoWhere(vendor.id),
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    }),
    db.product.findMany({
      where: { vendorId: vendor.id, isActive: true, fulfillmentTypeConfirmed: true },
      select: { id: true, name: true, inventory: true },
      orderBy: { createdAt: "desc" },
    }),
    db.registrationForm.findMany({
      where: { vendorId: vendor.id, isActive: true },
      select: { id: true, name: true, fields: true },
      orderBy: { createdAt: "desc" },
    }),
    db.messageTemplate.findMany({
      where: {
        vendorId: vendor.id,
        OR: [REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE, LIVE_REMINDER_EMAIL_TEMPLATE_WHERE],
      },
      select: { id: true, name: true, channel: true, trigger: true, subject: true, body: true },
      orderBy: { createdAt: "desc" },
    }),
    db.interactionScript.findMany({
      where: { vendorId: vendor.id, status: "published" },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
    db.affiliate.findMany({
      where: { vendorId: vendor.id, isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { createdAt: "desc" },
    }),
    db.teamMembership.findMany({
      where: { vendorId: vendor.id, status: "ACTIVE", leftAt: null },
      select: {
        id: true,
        teamId: true,
        team: { select: { name: true } },
        vendorMember: { select: { user: { select: { name: true } } } },
      },
      orderBy: [{ teamId: "asc" }, { createdAt: "asc" }],
    }),
    db.partnerFunnelPage.findMany({
      where: { vendorId: vendor.id },
      select: { id: true, slug: true, headline: true },
      orderBy: { updatedAt: "desc" },
    }),
    getCsrfToken(),
    db.liveStudioDraft.findFirst({
      where: { vendorId: vendor.id, liveId: id, consumedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, revision: true, payload: true, updatedAt: true },
    }),
  ]);
  if (!live) notFound();

  const preparedResources = prepareLiveEditorResources({ live, videos, products, formCandidates, templateCandidates });
  const { forms, templates } = preparedResources;
  const quotaPolicy = parseLiveQuotaPolicy(live.quotaPolicy);
  const hasUnavailableScript = Boolean(
    live.interactionScriptId && !scripts.some((script) => script.id === live.interactionScriptId),
  );
  const hasUnavailableTemplate = Boolean(
    live.messageTemplateId && !templates.some((template) => template.id === live.messageTemplateId),
  );
  const hasUnavailableReminderTemplate = Boolean(
    live.liveReminderTemplateId && !templates.some((template) => template.id === live.liveReminderTemplateId),
  );
  const basePayload = LiveStudioDraftPayloadSchema.parse({
    title: live.title,
    slug: live.slug,
    scheduledAt: formatZonedDateTimeLocal(live.scheduledAt, vendor.timezone),
    description: live.description ?? "",
    productIds: preparedResources.productIds,
    accentCopy: live.accentCopy ?? "",
    formId: preparedResources.formId,
    messageTemplateId: hasUnavailableTemplate ? "" : (live.messageTemplateId ?? ""),
    liveReminderTemplateId: hasUnavailableReminderTemplate ? "" : (live.liveReminderTemplateId ?? ""),
    liveReminderOffsetMinutes: String(live.liveReminderOffsetMinutes),
    streamMode: live.streamMode === "live" ? "live" : "vod",
    videoId: preparedResources.videoId,
    heroImageUrl: live.heroImageUrl ?? "",
    heroImageAssetId: live.heroImageAssetId ?? "",
    interactionScriptId: hasUnavailableScript ? "" : (live.interactionScriptId ?? ""),
    affiliateMode: quotaPolicy.affiliateMode,
    defaultAffiliateCode: quotaPolicy.defaultAffiliateCode ?? "",
    maxConcurrentViewers: String(quotaPolicy.maxConcurrentViewers),
    stopWhenCreditsBelow: String(quotaPolicy.stopWhenCreditsBelow),
    usageAttributionMode: quotaPolicy.usageAttributionMode,
    quotaPayerScope: quotaPolicy.quotaPayerScope,
    splitOwnerBps: String(quotaPolicy.splitOwnerBps),
    splitPromoterBps: String(quotaPolicy.splitPromoterBps),
    customAllocations: JSON.stringify(quotaPolicy.customAllocations),
    memberQuotas: JSON.stringify(quotaPolicy.memberQuotas),
    pageQuotas: JSON.stringify(quotaPolicy.pageQuotas),
    replayEnabled: live.replayEnabled,
    activeStep: 0,
  });
  const savedPayload = savedDraft ? LiveStudioDraftPayloadSchema.safeParse(savedDraft.payload) : null;
  const initialDraft = savedDraft
    ? {
        id: savedDraft.id,
        revision: savedDraft.revision,
        payload: savedPayload?.success ? savedPayload.data : basePayload,
        updatedAt: savedDraft.updatedAt.toISOString(),
      }
    : undefined;

  return (
    <>
      <PageHeader title="編輯直播間" description="用同一套五步驟 Studio 調整內容；草稿與公開狀態分開儲存。" />
      {notice === "reminders_reconciling" ? (
        <p role="status" aria-live="polite" className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
          直播設定已儲存。系統正在分批更新已驗證報名者的開播提醒，寄送紀錄會保留最新排程與被取代版本。
        </p>
      ) : null}
      {notice === "reminders_cancelled" ? (
        <p role="status" aria-live="polite" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          直播設定已儲存。既有尚未寄送的開播提醒正在安全取消，不會沿用舊時間或舊模板。
        </p>
      ) : null}
      <LiveResourceWarnings
        hasUnavailableScript={hasUnavailableScript}
        hasUnavailableVideo={preparedResources.hasUnavailableVideo}
        hasUnavailableProduct={preparedResources.hasUnavailableProduct}
        hasUnavailableForm={preparedResources.hasUnavailableForm}
        hasUnavailableTemplate={hasUnavailableTemplate}
        hasUnavailableReminderTemplate={hasUnavailableReminderTemplate}
      />
      <LiveStepperForm
        videos={videos}
        products={products}
        forms={forms}
        templates={templates}
        scripts={scripts}
        affiliates={affiliates}
        streamMembers={streamMemberships.map((membership) => ({
          id: membership.id,
          teamId: membership.teamId,
          label: `${membership.team.name} · ${membership.vendorMember.user.name || "未命名成員"}`,
        }))}
        streamPages={streamQuotaPages.map((page) => ({ id: page.id, label: `${page.headline || "未命名推廣頁"} · /${page.slug}` }))}
        csrfToken={csrfToken}
        error={error}
        initialDraft={initialDraft}
        initialValues={basePayload}
        liveId={live.id}
        currentStatus={live.status}
        timeZone={vendor.timezone}
      />
    </>
  );
}
