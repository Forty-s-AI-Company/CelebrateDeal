import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u);
export const MerchantAffiliatePayoutPolicyInput = z.object({ expectedRevision: z.number().int().min(0).max(2_147_483_646), bankFeeCents: z.number().int().min(0).max(2_147_483_647), enabled: z.boolean() }).strict();
export class MerchantAffiliatePayoutPolicyConflict extends Error {}
/** Authenticated manager action supplies actor identity; current role is
 * queried from membership, never trusted from a form or cached session. */
export async function setMerchantAffiliatePayoutPolicy(db: Pick<PrismaClient, "$transaction">, actor: { userId: string }, vendorId: string, raw: unknown) {
  if (![actor.userId, vendorId].every(value => Id.safeParse(value).success)) return null;
  const input = MerchantAffiliatePayoutPolicyInput.parse(raw);
  return db.$transaction(async tx => {
    const manager = await tx.vendorMember.findFirst({ where: { vendorId, userId: actor.userId, role: { in: ["owner", "admin"] }, status: "active", user: { status: "active" } }, select: { id: true } });
    if (!manager) return null;
    const previous = await tx.merchantAffiliatePayoutPolicy.findUnique({ where: { vendorId }, select: { revision: true } });
    const data = { bankFeeCents: input.bankFeeCents, enabled: input.enabled, updatedByUserId: actor.userId };
    if (!previous) {
      if (input.expectedRevision !== 0) throw new MerchantAffiliatePayoutPolicyConflict();
      return tx.merchantAffiliatePayoutPolicy.create({ data: { vendorId, ...data, revision: 1 }, select: { revision: true, bankFeeCents: true, enabled: true } });
    }
    const changed = await tx.merchantAffiliatePayoutPolicy.updateMany({ where: { vendorId, revision: input.expectedRevision }, data: { ...data, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new MerchantAffiliatePayoutPolicyConflict();
    await tx.affiliateRemunerationSnapshot.updateMany({ where: { vendorId, status: { in: ["quoted", "signed"] } }, data: { status: "invalidated", invalidatedAt: new Date() } });
    return { revision: input.expectedRevision + 1, bankFeeCents: input.bankFeeCents, enabled: input.enabled };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
