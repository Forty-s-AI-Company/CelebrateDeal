import Link from "next/link";
import { LiveStepperForm } from "@/components/live-stepper-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { LiveStudioDraftPayloadSchema } from "@/lib/live-studio-draft";
import { liveReadyVideoWhere } from "@/lib/live-video-readiness";
import {
  hasUsableMessageTemplateContent,
  LIVE_REMINDER_EMAIL_TEMPLATE_WHERE,
  REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
} from "@/lib/message-template";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";

const liveStudioStepLabels = ["用途與基本資料", "媒體與 Live Input", "商品優惠", "報名頁", "時間、回放與品牌", "Email", "留言、商品浮窗與 CTA", "桌機／手機預覽發布"] as const;

type ResumableLiveDraft = {
  id: string;
  title: string;
  activeStep: number;
  updatedAt: Date;
};

function LiveDraftResumeNotice({ drafts, timeZone }: { drafts: ResumableLiveDraft[]; timeZone: string }) {
  if (drafts.length === 0) return null;

  return (
    <section aria-labelledby="live-draft-resume-title" className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <h2 id="live-draft-resume-title" className="font-semibold text-slate-950">找到未完成的直播草稿</h2>
      <p className="mt-1 text-sm text-slate-700">可從上次儲存的位置繼續，或直接使用下方表單建立新的空白直播。</p>
      <ul className="mt-3 grid gap-2">
        {drafts.map((draft) => (
          <li key={draft.id} className="flex flex-col gap-3 rounded-lg border border-blue-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-slate-950">{draft.title || "未命名直播"}</p>
              <p className="mt-1 text-xs text-slate-600">
                第 {draft.activeStep + 1} 步：{liveStudioStepLabels[draft.activeStep]} · 上次儲存於{" "}
                <time dateTime={draft.updatedAt.toISOString()}>
                  {draft.updatedAt.toLocaleString("zh-TW", { timeZone, hour12: false })}
                </time>
              </p>
            </div>
            <Link
              href={`/lives/new?draft=${encodeURIComponent(draft.id)}`}
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              繼續這份草稿
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function NewLivePage({ searchParams }: { searchParams: Promise<{ error?: string; draft?: string }> }) {
  const vendor = await requireVendorManager();
  const { error, draft } = await searchParams;
  const requestedDraftId = typeof draft === "string" && /^[a-z0-9_-]{1,128}$/iu.test(draft) ? draft : "";
  const db = getDb();
  const draftLookupAt = new Date();
  const [videos, products, formCandidates, templateCandidates, scripts, affiliates, streamMemberships, streamQuotaPages, csrfToken, savedDraft, resumableDraftRecords] = await Promise.all([
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
        OR: [
          REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
          LIVE_REMINDER_EMAIL_TEMPLATE_WHERE,
          { channel: "email", trigger: "post_live_followup", isActive: true },
        ],
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
    requestedDraftId
      ? db.liveStudioDraft.findFirst({
          where: {
            id: requestedDraftId,
            vendorId: vendor.id,
            liveId: null,
            consumedAt: null,
            expiresAt: { gt: draftLookupAt },
          },
          select: { id: true, revision: true, payload: true, updatedAt: true },
        })
      : Promise.resolve(null),
    db.liveStudioDraft.findMany({
      where: {
        vendorId: vendor.id,
        liveId: null,
        consumedAt: null,
        expiresAt: { gt: draftLookupAt },
      },
      select: { id: true, payload: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
  ]);
  const forms = formCandidates
    .filter((form) => parseRegistrationFormFields(form.fields).success)
    .map(({ id, name }) => ({ id, name }));
  const templates = templateCandidates
    .filter(hasUsableMessageTemplateContent)
    .map(({ id, name, channel, trigger }) => ({ id, name, channel, trigger }));
  const parsedDraft = savedDraft ? LiveStudioDraftPayloadSchema.safeParse(savedDraft.payload) : null;
  const initialDraft = savedDraft && parsedDraft?.success
    ? { id: savedDraft.id, revision: savedDraft.revision, payload: parsedDraft.data, updatedAt: savedDraft.updatedAt.toISOString() }
    : undefined;
  const resumableDrafts = resumableDraftRecords.flatMap((record): ResumableLiveDraft[] => {
    const parsed = LiveStudioDraftPayloadSchema.safeParse(record.payload);
    return parsed.success
      ? [{ id: record.id, title: parsed.data.title, activeStep: parsed.data.activeStep, updatedAt: record.updatedAt }]
      : [];
  });

  return (
    <>
      <PageHeader title="建立直播間" description="用八個清楚步驟完成設定；每次變更都會建立可復原、具版本保護的伺服器草稿。" />
      {draft && !initialDraft ? (
        <p role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          指定的直播草稿已失效、已完成或不屬於目前商店。系統沒有載入任何內容，你可以改選下方仍有效的草稿。
        </p>
      ) : null}
      {!initialDraft ? <LiveDraftResumeNotice drafts={resumableDrafts} timeZone={vendor.timezone} /> : null}
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
        timeZone={vendor.timezone}
      />
    </>
  );
}
