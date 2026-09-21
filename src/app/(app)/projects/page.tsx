import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function ProjectsPage() {
  const { vendor } = await requireVendorManagerContext();
  const projects = await getDb().salesProject.findMany({ where: { vendorId: vendor.id }, orderBy: { updatedAt: "desc" } });
  return <><PageHeader title="銷售專案" description="一個專案可以包含多個商品；商家品牌、團隊、金流與客戶身分仍共用同一個 Workspace。" action={<ButtonLink href="/projects/new"><Plus size={17} aria-hidden="true" />建立新專案</ButtonLink>} />{projects.length ? <div className="grid gap-4 md:grid-cols-2">{projects.map((project) => <Card key={project.id}><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-950">{project.name}</h2><p className="mt-1 text-sm text-slate-500">{project.primaryFlow === "live" ? "直播銷講流程" : "高客單諮詢流程"}</p></div><Badge tone={project.status === "published" ? "green" : project.status === "archived" ? "gray" : "blue"}>{project.status === "published" ? "已發布" : project.status === "archived" ? "已封存" : "草稿"}</Badge></div><Link className="mt-5 inline-flex min-h-11 items-center font-semibold text-blue-700 hover:underline" href={`/projects/${project.id}`}>管理專案</Link></Card>)}</div> : <EmptyState title="還沒有銷售專案" description="第一個專案會預設開啟上線導引，帶你完成商品、頁面、金流與發布。" action={<ButtonLink href="/projects/new">建立第一個專案</ButtonLink>} />}</>;
}
