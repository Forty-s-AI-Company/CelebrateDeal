import { notFound } from "next/navigation";
import { publishSalesProjectAction } from "@/app/actions/sales-workspace-actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, ButtonLink, Card, PageHeader, SubmitButton } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; published?: string }> }) {
  const { vendor } = await requireVendorManagerContext(); const { id } = await params;
  const query = await searchParams;
  const project = await getDb().salesProject.findFirst({ where: { id, vendorId: vendor.id }, include: { _count: { select: { products: true, customers: true, forms: true, lives: true, consultations: true, orders: true } } } });
  if (!project) notFound();
  return <><PageHeader title={project.name} description={`目前資料範圍：${vendor.name} / ${project.name}`} action={<Badge tone={project.status === "published" ? "green" : "blue"}>{project.status === "published" ? "已發布" : "草稿"}</Badge>} />{query.error === "not_ready" ? <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">發布前請完成有效價格商品、漏斗頁、付款方式，以及目前專案的直播或可預約諮詢流程。</p> : null}{query.published ? <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">專案已發布，可以取得分享連結。</p> : null}<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[["商品與方案",project._count.products,"/products"],["專案客戶",project._count.customers,"/customers"],["漏斗頁",project._count.forms,"/forms"],["直播",project._count.lives,"/lives"],["預約服務",project._count.consultations,"/consultations"],["訂單",project._count.orders,"/orders"]].map(([label,value,href]) => <Card key={String(label)}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p><ButtonLink href={String(href)} tone="secondary">開啟</ButtonLink></Card>)}</div>{project.status !== "published" ? <Card className="mt-6"><h2 className="font-semibold text-slate-950">準備發布</h2><p className="mt-2 text-sm text-slate-600">系統會再次檢查商品、漏斗、付款與主要銷售流程，不會用手動勾選冒充完成。</p><form action={publishSalesProjectAction} className="mt-4"><CsrfField /><input type="hidden" name="projectId" value={project.id} /><SubmitButton pendingChildren="檢查並發布中…">檢查並發布</SubmitButton></form></Card> : null}</>;
}
