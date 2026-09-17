import { FunnelList } from "@/components/landing-pages/funnel-list";
import { PageHeader, Card, ButtonLink } from "@/components/ui";
import { listLandingPages } from "@/lib/landing-page-service";
export default async function LandingPagesPage() {
  const { pages, scope } = await listLandingPages();
  const publishedCount = pages.filter((page) => page.status === "published").length;
  return <>
    <PageHeader title="Funnels" description="建立銷售、名單蒐集與自訂流程，集中管理每個全畫面頁面。" action={!scope.isAggregate ? <ButtonLink href="/landing-pages/new">建立 Funnel</ButtonLink> : undefined} />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">{scope.projectName ?? (scope.isAggregate ? "全部專案總覽（唯讀）" : "目前工作區")}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500"><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">全部 {pages.length}</span><span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">已發布 {publishedCount}</span></div>
    </div>
    {pages.length ? <FunnelList pages={pages} readOnly={scope.isAggregate} /> : <Card className="border-dashed border-slate-300 bg-slate-50/60"><div className="mx-auto max-w-md py-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-xl text-blue-700">✦</div><h2 className="mt-4 text-lg font-bold text-slate-950">開始建立第一個 Funnel</h2><p className="mt-2 text-sm leading-6 text-slate-500">選擇銷售、名單蒐集或自訂用途，再進入中文版全畫面編輯器。</p>{!scope.isAggregate ? <div className="mt-5"><ButtonLink href="/landing-pages/new">建立 Funnel</ButtonLink></div> : null}</div></Card>}
  </>;
}

