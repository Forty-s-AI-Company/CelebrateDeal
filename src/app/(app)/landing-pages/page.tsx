import Link from "next/link";
import { FunnelList } from "@/components/landing-pages/funnel-list";
import { SalesProjectRequiredNotice } from "@/components/landing-pages/sales-project-required-notice";
import { PageHeader, Card, ButtonLink } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { listLandingPages } from "@/lib/landing-page-service";
import { listSelectableSalesProjects } from "@/lib/sales-project-scope";

export default async function LandingPagesPage() {
  const vendor = await requireVendorManager();
  const { pages, scope } = await listLandingPages();
  const publishedCount = pages.filter((page) => page.status === "published").length;
  // One-page sites belong to a sales project: without a selected one (aggregate overview,
  // no project yet, or a pre-project workspace) creating and editing are not available.
  const projectSelected = Boolean(scope.projectId);
  const projects = projectSelected ? [] : await listSelectableSalesProjects(vendor.id);

  return <>
    <PageHeader title="一頁式網站" description="建立銷售、名單蒐集與自訂流程，集中管理每個全畫面頁面。" action={<div className="flex flex-wrap gap-2"><ButtonLink href="/landing-pages/templates" tone="secondary">範本</ButtonLink>{projectSelected ? <ButtonLink href="/landing-pages/new">建立一頁式網站</ButtonLink> : null}</div>} />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">{scope.projectName ?? (scope.isAggregate ? "全部專案總覽（唯讀）" : "目前工作區")}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500"><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">全部 {pages.length}</span><span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">已發布 {publishedCount}</span></div>
    </div>
    {!projectSelected ? <SalesProjectRequiredNotice projects={projects} className="mb-6" /> : null}
    {pages.length ? <FunnelList pages={pages} readOnly={!projectSelected} /> : projectSelected ? <Card className="border-dashed border-slate-300 bg-slate-50/60"><div className="mx-auto max-w-md py-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-xl text-blue-700">✦</div><h2 className="mt-4 text-lg font-bold text-slate-950">開始建立第一個一頁式網站</h2><p className="mt-2 text-sm leading-6 text-slate-500">選擇銷售、名單蒐集或自訂用途，再進入中文版全畫面編輯器。</p><div className="mt-5 flex flex-wrap justify-center gap-2"><ButtonLink href="/landing-pages/new">建立一頁式網站</ButtonLink><ButtonLink href="/landing-pages/templates" tone="secondary">從範本開始</ButtonLink></div></div></Card> : <p className="text-sm text-slate-600">選好專案後就能建立網站；現在也可以先<Link href="/landing-pages/templates" className="mx-1 font-semibold text-blue-700 underline">瀏覽範本</Link>。</p>}
  </>;
}
