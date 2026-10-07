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
  const configuredIds = [product.upsellProductId, product.downsellProductId].filter((value): value is string => value !== null);
  const [availableOffers, configuredOffers] = await Promise.all([
    db.product.findMany({
      where: { vendorId: vendor.id, isActive: true, fulfillmentTypeConfirmed: true, checkoutUrl: null, NOT: { id } },
      select: { id: true, name: true, priceCents: true, currency: true }, orderBy: { name: "asc" }, take: 200,
    }),
    db.product.findMany({ where: { vendorId: vendor.id, id: { in: configuredIds } },
      select: { id: true, name: true, priceCents: true, currency: true, isActive: true, fulfillmentTypeConfirmed: true, checkoutUrl: true } }),
  ]);
  // Always retain the current selection outside the bounded available list.
  const offers = new Map(availableOffers.map(offer => [offer.id, offer]));
  for (const offer of configuredOffers) offers.set(offer.id, { ...offer,
    name: offer.isActive && offer.fulfillmentTypeConfirmed && !offer.checkoutUrl ? offer.name : `${offer.name}（目前無法加購）` });
  return (
    <>
      <PageHeader title="編輯商品" description="調整價格、庫存、圖片與交付方式。課程 policy 變更會產生新版本，歷史訂單不會被改寫。" action={<ButtonLink href={`/products/${encodeURIComponent(product.id)}/preview`} tone="secondary">預覽商品</ButtonLink>} />
      {product.fulfillmentType === "course" ? <div className="mb-5"><ButtonLink href={`/products/${encodeURIComponent(product.id)}/lessons`} tone="secondary">管理課程單元</ButtonLink></div> : null}
      <ProductForm error={error} product={product} offerProducts={[...offers.values()]} memberships={memberships.map((membership) => ({ id: membership.id, teamName: membership.team.name, memberName: membership.vendorMember.user.name }))} />
    </>
  );
}
