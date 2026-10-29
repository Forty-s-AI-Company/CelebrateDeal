import { notFound } from "next/navigation";
import { resolveSalesProjectBinding, SalesProjectBindingError } from "@/lib/sales-project-binding";
import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { ProjectBoundNotice, ProjectUnboundNotice } from "@/components/project-unbound-notice";
import { resolveBoundProjectName, resolveDefaultProjectCandidate } from "@/lib/sales-project-scope";
import { getDb } from "@/lib/db";

export default async function NewProductPage({ searchParams }: { searchParams?: Promise<{ error?: string | string[]; projectId?: string }> }) {
  const { auth, vendor } = await requireVendorManagerContext();
  const query = await searchParams;
  const { candidate, scopeProjectName, isAggregate } = await resolveDefaultProjectCandidate(auth.user.id, vendor.id, query?.projectId);
  const projectId = await validatedProject(vendor.id, candidate);
  const projectName = await resolveBoundProjectName(vendor.id, projectId, scopeProjectName);
  const error = Array.isArray(query?.error) ? query.error[0] : query?.error;
  const memberships = await getDb().teamMembership.findMany({
    where: { vendorId: vendor.id, status: "ACTIVE", leftAt: null },
    select: { id: true, team: { select: { name: true } }, vendorMember: { select: { user: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return (
    <>
      <PageHeader title="新增商品" description="建立商品卡、定價與實體／數位／服務／課程交付方式。" />
      <ProjectBoundNotice name={projectName} />
      {!projectId && isAggregate ? <ProjectUnboundNotice resource="商品" /> : null}
      <ProductForm projectId={projectId} error={error} offerProducts={await getDb().product.findMany({
        where: { vendorId: vendor.id, isActive: true, fulfillmentTypeConfirmed: true, checkoutUrl: null },
        select: { id: true, name: true, priceCents: true, currency: true }, orderBy: { name: "asc" }, take: 200,
      })} memberships={memberships.map((membership) => ({ id: membership.id, teamName: membership.team.name, memberName: membership.vendorMember.user.name }))} />
    </>
  );
}

async function validatedProject(vendorId: string, projectId: string | null) {
  try { return await resolveSalesProjectBinding(getDb(), vendorId, projectId); }
  catch (error) {
    if (error instanceof SalesProjectBindingError) notFound();
    throw error;
  }
}
