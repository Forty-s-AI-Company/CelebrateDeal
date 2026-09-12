import Link from "next/link";
import { PageHeader, Card, ButtonLink } from "@/components/ui";
import { listLandingPages } from "@/lib/landing-page-service";
export default async function LandingPagesPage() {
  const { pages, scope } = await listLandingPages();
  return <>
    <PageHeader title="一頁式網站" description="製作 Webinar 招生頁，將訪客引導至既有報名表。" action={!scope.isAggregate ? <ButtonLink href="/landing-pages/new">建立網站</ButtonLink> : undefined} />
    <p className="mb-4 text-sm text-slate-500">{scope.projectName ?? (scope.isAggregate ? "全部專案總覽（唯讀）" : "目前工作區")}</p>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{pages.map((page) => <Card key={page.id}><h2 className="text-lg font-semibold">{page.name}</h2><p className="my-2 text-sm text-slate-500">/lp/{page.slug}</p><p className="mb-4 text-sm">{page.status === "published" ? "已發布" : "草稿"}</p>{!scope.isAggregate ? <Link href={`/landing-pages/${page.id}`} className="font-semibold text-blue-700">編輯網站 →</Link> : null}</Card>)}</div>
    {!pages.length ? <Card><p>從 Webinar 模板開始，拖入內容與報名按鈕，即可製作第一個招生頁。</p></Card> : null}
  </>;
}

