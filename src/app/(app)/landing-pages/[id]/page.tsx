import { notFound } from "next/navigation";
import { LandingPageWorkspace } from "@/components/landing-page-workspace";
import { getLandingPageForEditor, LandingPageNotFoundError, LandingPageScopeError } from "@/lib/landing-page-service";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
export default async function EditLandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getLandingPageForEditor(id).catch((error: unknown) => { if (error instanceof LandingPageNotFoundError || error instanceof LandingPageScopeError) notFound(); throw error; });
  if (!data.page.content) return <p role="alert">這個頁面的內容格式需要修復，已保留原始資料。</p>;
  const page = data.page;
  return <LandingPageWorkspace key={page.id} page={{ id: page.id, name: page.name, slug: page.slug, status: page.status, revision: page.revision, content: page.content, formId: page.formId, liveId: page.liveId, versions: page.versions.map(({ version }) => ({ version })) }} webinarResources={data.webinarResources} forms={data.forms} lives={data.lives} csrfName={CSRF_FIELD_NAME} csrfToken={await getCsrfToken()} />;
}

