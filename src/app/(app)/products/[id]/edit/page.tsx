import { notFound } from "next/navigation";
import { ProductForm } from "@/components/product-form";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ error?: string | string[] }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const query = await searchParams;
  const error = Array.isArray(query?.error) ? query.error[0] : query?.error;
  const db = getDb();
  const [product, memberships] = await Promise.all([
    db.product.findFirst({ where: { id, vendorId: vendor.id }, include: { deliveryConfig: true } }),
    db.teamMembership.findMany({
      where: { vendorId: vendor.id, status: "ACTIVE", leftAt: null },
      select: { id: true, team: { select: { name: true } }, vendorMember: { select: { user: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!product) notFound();
  return (
    <>
      <PageHeader title="編輯商品" description="調整價格、庫存、圖片與交付方式。課程 policy 變更會產生新版本，歷史訂單不會被改寫。" action={<ButtonLink href={`/products/${encodeURIComponent(product.id)}/preview`} tone="secondary">預覽商品</ButtonLink>} />
      <ProductForm error={error} product={product} memberships={memberships.map((membership) => ({ id: membership.id, teamName: membership.team.name, memberName: membership.vendorMember.user.name }))} />
    </>
  );
}
