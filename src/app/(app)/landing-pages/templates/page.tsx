import { LandingPageTemplateLibrary } from "@/components/landing-pages/landing-page-template-library";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireVendorManager, requireVendorManagerContext } from "@/lib/auth";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
import { getSalesProjectScope, listSelectableSalesProjects } from "@/lib/sales-project-scope";
import { listPlatformTemplateLibrary } from "@/lib/landing-page-platform-template-library";
import { listLandingPageTemplates, listLandingPageTemplateTargets } from "@/lib/landing-page-template-service";

export default async function LandingPageTemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Same gate as /landing-pages: owner/admin only (partner and support are redirected).
  await requireVendorManager();
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  const query = await searchParams;
  // The library stays browsable without a project; using a template then shows the project guidance.
  const [templates, sites, projects] = await Promise.all([
    listLandingPageTemplates(),
    scope.projectId ? listLandingPageTemplateTargets() : Promise.resolve(null),
    scope.projectId ? Promise.resolve([]) : listSelectableSalesProjects(vendor.id),
  ]);
  return <>
    <PageHeader title="範本" description="挑選平台範本或自己存的範本，用來建立新網站，或套用到現有網站的某個步驟。" action={<ButtonLink href="/landing-pages" tone="secondary">返回一頁式網站</ButtonLink>} />
    <LandingPageTemplateLibrary csrfName={CSRF_FIELD_NAME} csrfToken={await getCsrfToken()} platformTemplates={listPlatformTemplateLibrary()} myTemplates={templates} sites={sites} projects={projects} initialTab={query.tab === "mine" ? "mine" : "platform"} />
  </>;
}
