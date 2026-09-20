import { FunnelList } from "@/components/landing-pages/funnel-list";
import { Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { listLandingPages } from "@/lib/landing-page-service";

export default async function LandingPagesPage() {
  await requireVendorManager();
  const { pages, scope } = await listLandingPages();
  const publishedCount = pages.filter((page) => page.status === "published").length;

  return <>
    <PageHeader title="Funnels" description="集中管理銷售、名單蒐集與自訂流程。" />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">{scope.projectName ?? (scope.isAggregate ? "全部專案總覽（唯讀）" : "目前工作區")}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500"><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">全部 {pages.length}</span><span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">已發布 {publishedCount}</span></div>
    </div>
    {pages.length ? <FunnelList pages={pages} readOnly={scope.isAggregate} /> : <Card className="border-dashed border-slate-300 bg-slate-50/60"><div className="mx-auto max-w-md py-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-xl text-blue-700">✦</div><h2 className="mt-4 text-lg font-bold text-slate-950">目前尚未建立 Funnel</h2><p className="mt-2 text-sm leading-6 text-slate-500">建立流程的入口會在下一個批次接上；目前可先查看既有 Funnel 的 operations。</p></div></Card>}
  </>;
}
