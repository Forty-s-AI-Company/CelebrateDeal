import { Plus } from "lucide-react";
import { ButtonLink, EmptyState, PageHeader, Badge } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { canManageCommerceProducts } from "@/lib/vendor-capabilities";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const auth = await requireAuth();
  const vendor = auth.vendor;
  if (!vendor) return null;
  const canManage = canManageCommerceProducts(auth.member?.role);
  const products = await getDb().product.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader title="商品管理" description="管理直播銷售商品、價格、庫存與結帳連結。" action={canManage ? <ButtonLink href="/products/new"><Plus size={16} />新增商品</ButtonLink> : undefined} />
      {params.error === "commerce_manager_required" ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">只有 owner 或 admin 可以修改商品與結帳連結。</p> : null}
      {products.length === 0 ? (
        <EmptyState title="還沒有商品" description="直播頁需要商品卡才能把觀看者推向轉換。" action={<ButtonLink href="/products/new">新增商品</ButtonLink>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <a key={product.id} href={canManage ? `/products/${product.id}/edit` : "/products"} aria-disabled={!canManage} className="rounded-lg border border-border bg-white p-4 shadow-sm hover:bg-slate-50">
              <div className="mb-3 h-36 rounded-md bg-slate-100 bg-cover bg-center" style={{ backgroundImage: product.imageUrl ? `url(${product.imageUrl})` : undefined }} />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-950">{product.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">{formatCurrency(product.priceCents, product.currency)}</p>
                </div>
                <Badge tone={product.isActive ? "green" : "gray"}>{product.isActive ? "上架" : "停用"}</Badge>
              </div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
