import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { vendor } = await requireVendorManagerContext(); const { id } = await params;
  const project = await getDb().salesProject.findFirst({ where: { id, vendorId: vendor.id }, include: { _count: { select: { products: true, customers: true, forms: true, lives: true, consultations: true, orders: true } } } });
  if (!project) notFound();
  return <><PageHeader title={project.name} description={`目前資料範圍：${vendor.name} / ${project.name}`} action={<Badge tone={project.status === "published" ? "green" : "blue"}>{project.status === "published" ? "已發布" : "草稿"}</Badge>} /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[["商品與方案",project._count.products,"/products"],["專案客戶",project._count.customers,"/customers"],["漏斗頁",project._count.forms,"/forms"],["直播",project._count.lives,"/lives"],["預約服務",project._count.consultations,"/consultations"],["訂單",project._count.orders,"/orders"]].map(([label,value,href]) => <Card key={String(label)}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p><ButtonLink href={String(href)} tone="secondary">開啟</ButtonLink></Card>)}</div></>;
}
