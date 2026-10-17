import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";

const fulfillmentLabels = {
  physical: "實體出貨",
  digital: "數位授權",
  service: "服務排程",
  course: "課程授權／F/G",
} as const;

type ProductStatus = "active" | "draft" | "soldout";

function selectedStatus(value: string | string[] | undefined): ProductStatus | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "active" || candidate === "draft" || candidate === "soldout" ? candidate : null;
}

export default async function ProductsPage({ searchParams }: {
  searchParams?: Promise<{ q?: string | string[]; status?: string | string[]; updated?: string | string[] }>;
}) {
  const vendor = await requireVendorManager();
  const query = await searchParams;
  const rawSearch = Array.isArray(query?.q) ? query.q[0] : query?.q;
  const search = rawSearch?.trim().slice(0, 128) ?? "";
  const status = selectedStatus(query?.status);
  const updated = Array.isArray(query?.updated) ? query.updated[0] : query?.updated;
  const products = await getDb().product.findMany({
    where: {
      vendorId: vendor.id,
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] } : {}),
      ...(status === "draft" ? { isActive: false } : {}),
      ...(status === "active" ? { isActive: true, inventory: { gt: 0 } } : {}),
      ...(status === "soldout" ? { isActive: true, inventory: { lte: 0 } } : {}),
    },
    include: { _count: { select: { commerceOrderItems: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <PageHeader title="商品管理" description="管理草稿、價格、庫存、媒體、預覽與實際交付方式。" action={<ButtonLink href="/products/new"><Plus size={16} />新增商品</ButtonLink>} />
      {updated === "created" || updated === "saved" ? <p role="status" className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">商品已{updated === "created" ? "建立為草稿" : "儲存"}。</p> : null}
      <Card className="mb-5">
        <form method="get" className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-end">
          <label className="grid gap-1 text-sm font-medium text-slate-700">商品名稱或 Slug
            <input name="q" defaultValue={search} maxLength={128} className="min-h-11 rounded-md border border-slate-300 px-3" placeholder="搜尋商品" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">販售狀態
            <select name="status" defaultValue={status ?? ""} className="min-h-11 rounded-md border border-slate-300 bg-white px-3">
              <option value="">全部狀態</option>
              <option value="active">上架且有庫存</option>
              <option value="draft">草稿／未上架</option>
              <option value="soldout">上架但售罄</option>
            </select>
          </label>
          <button className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60">篩選</button>
        </form>
      </Card>
      {products.length === 0 ? (
        <EmptyState title={search || status ? "沒有符合條件的商品" : "還沒有商品"} description={search || status ? "調整搜尋或狀態條件後再試。" : "先建立草稿並確認預覽，再安全上架販售。"} action={!search && !status ? <ButtonLink href="/products/new">新增商品</ButtonLink> : undefined} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <article key={product.id} className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
              <div className="h-36 bg-slate-100 bg-cover bg-center" style={{ backgroundImage: product.imageUrl ? `url(${product.imageUrl})` : undefined }} />
              <div className="grid gap-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-950 [overflow-wrap:anywhere]">{product.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">{formatCurrency(product.priceCents, product.currency)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={product.isActive ? (product.inventory > 0 ? "green" : "red") : "gray"}>{product.isActive ? (product.inventory > 0 ? "上架" : "售罄") : "草稿"}</Badge>
                    <Badge tone={product.fulfillmentTypeConfirmed && product.fulfillmentType === "course" ? "orange" : "gray"}>{product.fulfillmentTypeConfirmed ? fulfillmentLabels[product.fulfillmentType] : "需確認交付方式"}</Badge>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-sm">
                  <div><dt className="text-xs text-slate-500">可售庫存</dt><dd className="mt-1 font-semibold text-slate-900">{product.inventory}</dd></div>
                  <div><dt className="text-xs text-slate-500">訂單品項</dt><dd className="mt-1 font-semibold text-slate-900">{product._count.commerceOrderItems}</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/products/${encodeURIComponent(product.id)}/edit`} className="inline-flex min-h-10 items-center rounded-md bg-primary px-3 text-sm font-semibold text-white">編輯</Link>
                  <Link href={`/products/${encodeURIComponent(product.id)}/preview`} className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-semibold text-slate-700">預覽</Link>
                  <Link href={`/orders?productId=${encodeURIComponent(product.id)}`} className="inline-flex min-h-10 items-center rounded-md border border-border px-3 text-sm font-semibold text-slate-700">查看訂單</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
