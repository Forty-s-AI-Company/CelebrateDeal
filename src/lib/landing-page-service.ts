import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getSalesProjectScope } from "@/lib/sales-project-scope";

export type LandingPageSummary = {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "published";
  revision: number;
  publishedAt: Date | null;
  updatedAt: Date;
};

export type LandingPageList = {
  pages: LandingPageSummary[];
  scope: Awaited<ReturnType<typeof getSalesProjectScope>>;
};

/**
 * Returns only the tenant and selected-project scoped projection needed by
 * the management list. Mutations and public rendering belong to later
 * batches, so this query cannot accidentally widen their authorization scope.
 */
export async function listLandingPages(): Promise<LandingPageList> {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  const pages = await getDb().landingPage.findMany({
    where: {
      vendorId: vendor.id,
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      revision: true,
      publishedAt: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });

  return {
    pages: pages.map((page) => ({
      id: page.id,
      name: page.name,
      slug: page.slug,
      status: page.status,
      revision: page.revision,
      publishedAt: page.publishedAt,
      updatedAt: page.updatedAt,
    })),
    scope,
  };
}
