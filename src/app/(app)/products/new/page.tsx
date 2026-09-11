import { ProductForm } from "@/components/product-form";
import { Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function NewProductPage({ searchParams }: { searchParams?: Promise<{ error?: string | string[] }> }) {
  const vendor = await requireVendorManager();
  const query = await searchParams;
  const error = Array.isArray(query?.error) ? query.error[0] : query?.error;
  const memberships = await getDb().teamMembership.findMany({
    where: { vendorId: vendor.id, status: "ACTIVE", leftAt: null },
    select: { id: true, team: { select: { name: true } }, vendorMember: { select: { user: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return (
    <>
      <PageHeader title="新增商品" description="建立商品卡、定價與實體／數位／服務／課程交付方式。" />
      <Card className="mb-6 bg-blue-50/50">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold text-blue-800">商品輕量導引 · 3 個步驟</p><p className="mt-1 text-sm text-slate-600">1. 填寫商品資料　2. 設定價格與付款方式　3. 加入銷售專案</p></div>
          <span className="text-xs font-semibold text-slate-500">不會啟動完整商家導引</span>
        </div>
      </Card>
      <ProductForm error={error} memberships={memberships.map((membership) => ({ id: membership.id, teamName: membership.team.name, memberName: membership.vendorMember.user.name }))} />
    </>
  );
}
