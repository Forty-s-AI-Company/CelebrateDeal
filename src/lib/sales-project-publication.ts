import type { Prisma } from "@prisma/client";
import { canPublishSalesProject } from "@/lib/sales-workspace";

/** 原專案發布條件共用於既有入口與快速建場；不改 verified 付款條件。 */
export async function publishOwnedSalesProject(db: Pick<Prisma.TransactionClient, "salesProject" | "salesProjectProduct" | "registrationForm" | "live" | "consultationEvent" | "paymentMethodReference">, vendorId: string, projectId: string) {
  const project = await db.salesProject.findFirst({
    where: { id: projectId, vendorId: vendorId, status: { not: "archived" } },
    select: { id: true, primaryFlow: true },
  });
  if (!project) return { status: "not_found" } as const;
  const now = new Date();
  const [pricedProducts, funnels, lives, consultations, paymentMethods] = await Promise.all([
    db.salesProjectProduct.count({ where: { vendorId: vendorId, projectId, product: { isActive: true, priceCents: { gt: 0 } } } }),
    db.registrationForm.count({ where: { vendorId: vendorId, projectId, isActive: true } }),
    db.live.count({ where: { vendorId: vendorId, projectId } }),
    db.consultationEvent.findMany({ where: { vendorId: vendorId, projectId, isActive: true }, select: { weeklySchedule: true } }),
    // A legacy or inconsistent row cannot satisfy the publication gate merely by status.
    db.paymentMethodReference.count({ where: { vendorId: vendorId, scopeType: "VENDOR", membershipId: null, status: "verified", verifiedAt: { not: null, lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
  ]);
  const hasAvailability = consultations.some(({ weeklySchedule }) => Array.isArray(weeklySchedule) && weeklySchedule.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const ranges = (entry as { ranges?: unknown }).ranges;
    return Array.isArray(ranges) && ranges.some((range) => typeof range === "string" && range.length > 0);
  }));
  const ready = canPublishSalesProject(project.primaryFlow, {
    exists: true,
    hasLinkedProduct: pricedProducts > 0,
    hasPricedProduct: pricedProducts > 0,
    hasFunnelTemplate: funnels > 0,
    hasLiveSession: lives > 0,
    hasConsultationService: consultations.length > 0,
    hasAvailability,
    hasPaymentMethod: paymentMethods > 0,
    hasPreviewableFlow: true,
    isPublished: false,
  });
  if (!ready) return { status: "not_ready" } as const;
  const updated = await db.salesProject.updateMany({ where: { id: projectId, vendorId: vendorId, status: { not: "archived" } }, data: { status: "published", publishedAt: now } });
  return { status: updated.count === 1 ? "published" : "not_ready" } as const;
}
