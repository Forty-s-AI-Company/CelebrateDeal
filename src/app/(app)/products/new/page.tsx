import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
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
      <ProductForm error={error} memberships={memberships.map((membership) => ({ id: membership.id, teamName: membership.team.name, memberName: membership.vendorMember.user.name }))} />
    </>
  );
}
