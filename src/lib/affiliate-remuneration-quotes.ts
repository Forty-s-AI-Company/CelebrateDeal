import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { calculateAffiliateRemuneration } from "./affiliate-remuneration";
import { reconcileAffiliatePendingPayout } from "./affiliate-payout-accounting";
import type { AffiliateBankScope } from "./affiliate-bank-account";
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u);
type Database = Pick<PrismaClient, "$transaction">;
const publicQuote = { id: true, revision: true, profileRevision: true, ruleVersion: true, grossAmountCents: true, withholdingTaxCents: true, nhiSupplementaryTaxCents: true, bankFeeCents: true, netPayoutAmountCents: true, status: true, signedAt: true } as const;
async function current(tx: Prisma.TransactionClient, actor: { userId: string }, scope: AffiliateBankScope, payoutId: string) {
  const access = await tx.affiliatePortalAccess.findFirst({ where: { ...scope, active: true, affiliate: { isActive: true }, member: { userId: actor.userId, status: "active", user: { status: "active" } } }, select: { revision: true } });
  if (!access) return null;
  const payout = await tx.affiliatePayout.findFirst({ where: { ...scope, id: payoutId, status: "pending", payoutItemId: null } });
  const profile = await tx.affiliatePayeeProfile.findUnique({ where: { vendorId_affiliateId: scope } });
  if (!payout || !profile || profile.approvedRevision !== profile.revision || !profile.approvedAt) return null;
  const month = { ...scope, monthKey: payout.monthKey };
  if (await tx.affiliateCommission.count({ where: { ...month, status: "locked", ledgerEntries: { none: {} } } })) return null;
  await reconcileAffiliatePendingPayout(tx, month);
  const fresh = await tx.affiliatePayout.findUniqueOrThrow({ where: { id: payout.id } });
  if (fresh.heldAmountCents > 0 || fresh.finalAmountCents <= 0) return null;
  // Entries are append-only. Count binds every new event, including zero-value
  // dispute events; sum alone would miss a changed accounting lifecycle.
  const ledger = await tx.affiliateCommissionLedgerEntry.aggregate({ where: { vendorId: scope.vendorId, commission: { affiliateId: scope.affiliateId, monthKey: payout.monthKey } }, _count: { _all: true }, _sum: { amountCents: true }, _max: { createdAt: true } });
  const ledgerDigest = createHash("sha256").update(JSON.stringify([payout.id, ledger._count._all, ledger._sum.amountCents, ledger._max.createdAt?.toISOString(), fresh.commissionAmountCents, fresh.adjustmentAmountCents, fresh.heldAmountCents])).digest("hex");
  return { payout: fresh, profile, ledgerDigest };
}

/** Fee policy is supplied by the trusted merchant service, never raw form
 * data. This creates a quote only; it cannot execute a payment or export. */
export async function createAffiliateRemunerationQuote(db: Database, actor: { userId: string }, scope: AffiliateBankScope, payoutId: string, policy: { bankFeeCents: number }) {
  if (![actor.userId, scope.vendorId, scope.affiliateId, payoutId].every(value => Id.safeParse(value).success)) return null;
  z.number().int().min(0).max(2_147_483_647).parse(policy.bankFeeCents);
  return db.$transaction(async tx => {
    const state = await current(tx, actor, scope, payoutId);
    if (!state) return null;
    const { profile, payout, ledgerDigest } = state;
    const quote = calculateAffiliateRemuneration({ grossAmountCents: payout.finalAmountCents, bankFeeCents: policy.bankFeeCents, recipientType: profile.recipientType, nhiTreatment: profile.nhiTreatment, exemptionReference: profile.exemptionReference ?? undefined, invoiceReference: profile.invoiceReference ?? undefined });
    const previous = await tx.affiliateRemunerationSnapshot.findFirst({ where: { ...scope, payoutId }, orderBy: { revision: "desc" } });
    if (previous && ["quoted", "signed"].includes(previous.status) && previous.profileRevision === profile.revision && previous.ledgerDigest === ledgerDigest && previous.bankFeeCents === quote.bankFeeCents && previous.ruleVersion === quote.ruleVersion && previous.grossAmountCents === quote.grossAmountCents) {
      return tx.affiliateRemunerationSnapshot.findUnique({ where: { id: previous.id }, select: publicQuote });
    }
    await tx.affiliateRemunerationSnapshot.updateMany({ where: { ...scope, payoutId, status: { in: ["quoted", "signed"] } }, data: { status: "invalidated", invalidatedAt: new Date() } });
    return tx.affiliateRemunerationSnapshot.create({ data: { ...scope, payoutId, revision: (previous?.revision ?? -1) + 1, profileRevision: profile.revision, ledgerDigest, ...quote, bankEncrypted: profile.bankEncrypted, taxIdentityEncrypted: profile.taxIdentityEncrypted, recipientType: profile.recipientType, nhiTreatment: profile.nhiTreatment, exemptionReference: profile.exemptionReference, invoiceReference: profile.invoiceReference }, select: publicQuote });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function signAffiliateRemunerationQuote(db: Database, actor: { userId: string }, scope: AffiliateBankScope, snapshotId: string, expectedRevision: number) {
  if (![actor.userId, scope.vendorId, scope.affiliateId, snapshotId].every(value => Id.safeParse(value).success)) return null;
  z.number().int().min(0).max(2_147_483_646).parse(expectedRevision);
  return db.$transaction(async tx => {
    const snapshot = await tx.affiliateRemunerationSnapshot.findFirst({ where: { ...scope, id: snapshotId, revision: expectedRevision, status: { in: ["quoted", "signed"] } } });
    if (!snapshot) return null;
    const state = await current(tx, actor, scope, snapshot.payoutId);
    // Do not reveal or invalidate another user's quote on denied access.
    if (!state) return null;
    if (snapshot.ledgerDigest !== state.ledgerDigest || snapshot.profileRevision !== state.profile.revision || snapshot.grossAmountCents !== state.payout.finalAmountCents) {
      await tx.affiliateRemunerationSnapshot.updateMany({ where: { id: snapshot.id, ...scope, status: { in: ["quoted", "signed"] } }, data: { status: "invalidated", invalidatedAt: new Date() } });
      return { status: "stale" as const };
    }
    const recalculated = calculateAffiliateRemuneration({ grossAmountCents: state.payout.finalAmountCents, bankFeeCents: snapshot.bankFeeCents, recipientType: state.profile.recipientType, nhiTreatment: state.profile.nhiTreatment, exemptionReference: state.profile.exemptionReference ?? undefined, invoiceReference: state.profile.invoiceReference ?? undefined });
    if (Object.entries(recalculated).some(([field, value]) => snapshot[field as keyof typeof snapshot] !== value)) return null;
    if (snapshot.status === "signed") return snapshot.signedByUserId === actor.userId ? tx.affiliateRemunerationSnapshot.findUnique({ where: { id: snapshot.id }, select: publicQuote }) : null;
    const signed = await tx.affiliateRemunerationSnapshot.updateMany({ where: { id: snapshot.id, ...scope, revision: expectedRevision, status: "quoted" }, data: { status: "signed", signedByUserId: actor.userId, signedAt: new Date() } });
    if (signed.count !== 1) return null;
    return tx.affiliateRemunerationSnapshot.findUnique({ where: { id: snapshot.id }, select: publicQuote });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
