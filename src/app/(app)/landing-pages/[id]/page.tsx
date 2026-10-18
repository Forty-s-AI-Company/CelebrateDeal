import { notFound } from "next/navigation";
import { LandingPageWorkspace } from "@/components/landing-page-workspace";
import { getLandingPageForEditor, getLandingPagePublicationStatus, LandingPageNotFoundError, LandingPageScopeError, type LandingPageStoredContent } from "@/lib/landing-page-service";
import { requireVendorManager } from "@/lib/auth";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
import { getActiveFunnelStepPage, switchFunnelStep, type FunnelStepPages } from "@/lib/funnel-step-pages";

function isFunnelStepPages(content: LandingPageStoredContent): content is FunnelStepPages {
  return "pages" in content && "activeStepId" in content && "flow" in content;
}

export default async function EditLandingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  await requireVendorManager();
  const data = await getLandingPageForEditor(id).catch((error: unknown) => { if (error instanceof LandingPageNotFoundError || error instanceof LandingPageScopeError) notFound(); throw error; });
  // Informational only: a failed diagnosis keeps the editor usable.
  const publication = await getLandingPagePublicationStatus(id).catch((error: unknown) => {
    if (error instanceof LandingPageNotFoundError || error instanceof LandingPageScopeError) notFound();
    return { available: false, message: "尚無法確認公開網址狀態，請重新整理後再查看。", projectHref: "/projects", missing: [] };
  });
  const persistedContent = data.page.content;
  if (!persistedContent) return <p role="alert">這個頁面的內容格式需要修復，已保留原始資料。</p>;
  const page = data.page;
  let content = persistedContent;
  let returnHref: string | undefined;
  if (isFunnelStepPages(content)) {
    const requested = query.step?.trim();
    const switched = requested ? switchFunnelStep(content, requested) : null;
    if (switched?.ok) content = switched.state;
    const active = getActiveFunnelStepPage(content);
    if (active) returnHref = `/landing-pages/${page.id}/operations?step=${encodeURIComponent(active.step.id)}&tab=configuration`;
  }
  return <LandingPageWorkspace initialPublication={publication} key={`${page.id}-${query.step ?? "default"}`} returnHref={returnHref} commerceProducts={data.commerceProducts} page={{ id: page.id, name: page.name, slug: page.slug, status: page.status, revision: page.revision, content, formId: page.formId, liveId: page.liveId, versions: page.versions.map(({ version }) => ({ version })) }} webinarResources={data.webinarResources} forms={data.forms} lives={data.lives} csrfName={CSRF_FIELD_NAME} csrfToken={await getCsrfToken()} />;
}
