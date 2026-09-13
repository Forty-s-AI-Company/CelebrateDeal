import Link from "next/link";
import { PageHeader, Card, ButtonLink } from "@/components/ui";
import { listLandingPages } from "@/lib/landing-page-service";
export default async function LandingPagesPage() {
  const { pages, scope } = await listLandingPages();
  const publishedCount = pages.filter((page) => page.status === "published").length;
  return <>
    <PageHeader title="一頁式網站" description="製作 Webinar 招生頁，將訪客引導至既有報名表。" action={!scope.isAggregate ? <ButtonLink href="/landing-pages/new">建立網站</ButtonLink> : undefined} />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">{scope.projectName ?? (scope.isAggregate ? "全部專案總覽（唯讀）" : "目前工作區")}</p>
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">全部 {pages.length}</span><span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">已發布 {publishedCount}</span></div>
    </div>
    {pages.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{pages.map((page) => <Card key={page.id} className="group border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-lg font-bold tracking-tight text-slate-950">{page.name}</h2><p className="mt-1 truncate font-mono text-xs text-slate-500">/lp/{page.slug}</p></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${page.status === "published" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{page.status === "published" ? "已發布" : "草稿"}</span></div>
      <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">{!scope.isAggregate ? <Link href={`/landing-pages/${page.id}`} className="rounded-md text-sm font-semibold text-blue-700 outline-none transition hover:text-blue-800 focus-visible:ring-2 focus-visible:ring-blue-300">編輯網站 <span aria-hidden="true">→</span></Link> : <span className="text-xs text-slate-400">唯讀總覽</span>}{page.status === "published" ? <span className="text-xs text-slate-400">公開可見</span> : <span className="text-xs text-slate-400">尚未公開</span>}</div>
    </Card>)}</div> : <Card className="border-dashed border-slate-300 bg-slate-50/60"><div className="mx-auto max-w-md py-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-xl text-blue-700">✦</div><h2 className="mt-4 text-lg font-bold text-slate-950">開始製作你的第一頁</h2><p className="mt-2 text-sm leading-6 text-slate-500">從 Webinar 模板開始，拖入內容與報名按鈕，即可製作第一個招生頁。</p>{!scope.isAggregate ? <div className="mt-5"><ButtonLink href="/landing-pages/new">建立第一個網站</ButtonLink></div> : null}</div></Card>}
  </>;
}

