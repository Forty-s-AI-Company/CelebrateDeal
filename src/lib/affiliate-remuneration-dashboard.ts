import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AffiliateBankScope } from "./affiliate-bank-account";
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u);
/** Bounded private read model. No bank/tax ciphertext or plaintext crosses
 * this boundary; a caller-supplied mode never grants manager permission. */
export async function getAffiliateRemunerationDashboard(db: Pick<PrismaClient, "$transaction">, actor: { userId: string }, scope: AffiliateBankScope, mode: "affiliate" | "manager", cursor?: string) {
  if (![actor.userId, scope.vendorId, scope.affiliateId, ...(cursor ? [cursor] : [])].every(value => Id.safeParse(value).success)) return null;
  return db.$transaction(async tx => {
    const vendor = await tx.vendor.findFirst({ where: { id: scope.vendorId, enabledFeatureModules: { hasEvery: ["affiliate_program", "tax_remuneration"] } }, select: { id: true } });
    if (!vendor) return null;
    if (mode === "manager") {
      const manager = await tx.vendorMember.findFirst({ where: { vendorId: scope.vendorId, userId: actor.userId, role: { in: ["owner", "admin"] }, status: "active", user: { status: "active" } }, select: { id: true } });
      if (!manager) return null;
    } else {
      const access = await tx.affiliatePortalAccess.findFirst({ where: { ...scope, active: true, affiliate: { isActive: true }, member: { userId: actor.userId, status: "active", user: { status: "active" } } }, select: { revision: true } });
      if (!access) return null;
    }
    const affiliate = await tx.affiliate.findFirst({ where: { vendorId: scope.vendorId, id: scope.affiliateId, isActive: true }, select: { name: true } });
    if (!affiliate) return null;
    if (cursor && !await tx.affiliatePayout.findFirst({ where: { ...scope, id: cursor }, select: { id: true } })) return null;
    const profile = await tx.affiliatePayeeProfile.findUnique({ where: { vendorId_affiliateId: scope }, select: { revision: true, recipientType: true, nhiTreatment: true, exemptionReference: true, invoiceReference: true, approvedRevision: true, approvedAt: true } });
    const policy = await tx.merchantAffiliatePayoutPolicy.findUnique({ where: { vendorId: scope.vendorId }, select: { revision: true, bankFeeCents: true, enabled: true } });
    const payouts = await tx.affiliatePayout.findMany({ where: { ...scope, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 21, select: { id: true, monthKey: true, finalAmountCents: true, heldAmountCents: true, status: true, paidNetAmountCents: true, remunerationSnapshotId: true, remunerationSnapshots: { orderBy: { revision: "desc" }, take: 1, select: { id: true, revision: true, status: true, ruleVersion: true, grossAmountCents: true, withholdingTaxCents: true, nhiSupplementaryTaxCents: true, bankFeeCents: true, netPayoutAmountCents: true, signedAt: true } } } });
    return { affiliate, profile, policy, payouts: payouts.slice(0, 20), nextCursor: payouts.length > 20 ? payouts[19]!.id : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
