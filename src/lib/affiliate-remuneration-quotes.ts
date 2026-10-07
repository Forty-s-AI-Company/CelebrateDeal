import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { calculateAffiliateRemuneration } from "./affiliate-remuneration";
import { AffiliatePayoutMutationConflict, reconcileAffiliatePendingPayout } from "./affiliate-payout-accounting";
import type { AffiliateBankScope } from "./affiliate-bank-account";
import { decryptAffiliateBankAccount } from "./affiliate-bank-account";
import { decryptAffiliateTaxIdentity } from "./affiliate-tax-identity";
import { loadRuntimeBankAccountKeyring, type BankAccountKeyring } from "./bank-account";
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u);
type Database = Pick<PrismaClient, "$transaction">;
const publicQuote = { id: true, revision: true, profileRevision: true, ruleVersion: true, grossAmountCents: true, withholdingTaxCents: true, nhiSupplementaryTaxCents: true, bankFeeCents: true, netPayoutAmountCents: true, status: true, signedAt: true } as const;
export function affiliatePaidRemunerationFields(proof: { snapshotId: string; netPayoutAmountCents: number } | null) {
  return proof ? { remunerationSnapshotId: proof.snapshotId, paidNetAmountCents: proof.netPayoutAmountCents } : {};
}
export async function assertAffiliatePayoutFinanceActor(tx: Prisma.TransactionClient, vendorId: string, memberId: string) {
  const payer = await tx.vendorMember.findFirst({
    where: { id: memberId, vendorId, status: "active", role: { in: ["owner", "admin", "accountant"] }, user: { status: "active" } },
    select: { id: true },
  });
  if (!payer) throw new AffiliatePayoutMutationConflict();
}
async function current(tx: Prisma.TransactionClient, actor: { userId: string }, scope: AffiliateBankScope, payoutId: string) {
  const access = await tx.affiliatePortalAccess.findFirst({ where: { ...scope, active: true, affiliate: { isActive: true }, member: { userId: actor.userId, status: "active", user: { status: "active" } } }, select: { revision: true } });
  if (!access) return null;
  const payoutPolicy = await tx.merchantAffiliatePayoutPolicy.findUnique({ where: { vendorId: scope.vendorId } });
  if (!payoutPolicy?.enabled) return null;
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
  return { payout: fresh, profile, ledgerDigest, payoutPolicy };
}

/** Fee policy is supplied by the trusted merchant service, never raw form
 * data. This creates a quote only; it cannot execute a payment or export. */
export async function createAffiliateRemunerationQuote(db: Database, actor: { userId: string }, scope: AffiliateBankScope, payoutId: string, policy: { bankFeeCents: number }) {
  if (![actor.userId, scope.vendorId, scope.affiliateId, payoutId].every(value => Id.safeParse(value).success)) return null;
  z.number().int().min(0).max(2_147_483_647).parse(policy.bankFeeCents);
  return db.$transaction(async tx => {
    const state = await current(tx, actor, scope, payoutId);
    if (!state || state.payoutPolicy.bankFeeCents !== policy.bankFeeCents) return null;
    const { profile, payout, ledgerDigest, payoutPolicy } = state;
    const quote = calculateAffiliateRemuneration({ grossAmountCents: payout.finalAmountCents, bankFeeCents: policy.bankFeeCents, recipientType: profile.recipientType, nhiTreatment: profile.nhiTreatment, exemptionReference: profile.exemptionReference ?? undefined, invoiceReference: profile.invoiceReference ?? undefined });
    const previous = await tx.affiliateRemunerationSnapshot.findFirst({ where: { ...scope, payoutId }, orderBy: { revision: "desc" } });
    if (previous && ["quoted", "signed", "exported"].includes(previous.status) && previous.payoutPolicyRevision === payoutPolicy.revision && previous.profileRevision === profile.revision && previous.ledgerDigest === ledgerDigest && previous.bankFeeCents === quote.bankFeeCents && previous.ruleVersion === quote.ruleVersion && previous.grossAmountCents === quote.grossAmountCents) {
      return tx.affiliateRemunerationSnapshot.findUnique({ where: { id: previous.id }, select: publicQuote });
    }
    await tx.affiliateRemunerationSnapshot.updateMany({ where: { ...scope, payoutId, status: { in: ["quoted", "signed"] } }, data: { status: "invalidated", invalidatedAt: new Date() } });
    return tx.affiliateRemunerationSnapshot.create({ data: { ...scope, payoutId, revision: (previous?.revision ?? -1) + 1, profileRevision: profile.revision, payoutPolicyRevision: payoutPolicy.revision, ledgerDigest, ...quote, bankEncrypted: profile.bankEncrypted, taxIdentityEncrypted: profile.taxIdentityEncrypted, recipientType: profile.recipientType, nhiTreatment: profile.nhiTreatment, exemptionReference: profile.exemptionReference, invoiceReference: profile.invoiceReference }, select: publicQuote });
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
    if (snapshot.ledgerDigest !== state.ledgerDigest || snapshot.profileRevision !== state.profile.revision || snapshot.grossAmountCents !== state.payout.finalAmountCents || snapshot.payoutPolicyRevision !== state.payoutPolicy.revision || snapshot.bankFeeCents !== state.payoutPolicy.bankFeeCents) {
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

/** Private export data for a tenant manager. The HTTP layer must use no-store,
 * CSRF protection and an attachment response; never log this return value.
 * Export is not payment, and re-download revalidates every current invariant. */
export async function exportAffiliateRemunerationQuote(db: Database, actor: { userId: string }, scope: AffiliateBankScope, snapshotId: string, policy: { bankFeeCents: number }, injectedKeyring?: BankAccountKeyring) {
  if (![actor.userId, scope.vendorId, scope.affiliateId, snapshotId].every(value => Id.safeParse(value).success)) return null;
  z.number().int().min(0).max(2_147_483_647).parse(policy.bankFeeCents);
  return db.$transaction(async tx => {
    const manager = await tx.vendorMember.findFirst({ where: { vendorId: scope.vendorId, userId: actor.userId, role: { in: ["owner", "admin"] }, status: "active", user: { status: "active" } }, select: { id: true } });
    if (!manager) return null;
    const snapshot = await tx.affiliateRemunerationSnapshot.findFirst({ where: { ...scope, id: snapshotId, status: { in: ["signed", "exported"] } } });
    if (!snapshot?.signedByUserId) return null;
    const state = await current(tx, { userId: snapshot.signedByUserId }, scope, snapshot.payoutId);
    if (!state || snapshot.ledgerDigest !== state.ledgerDigest || snapshot.profileRevision !== state.profile.revision || snapshot.payoutPolicyRevision !== state.payoutPolicy.revision || snapshot.bankFeeCents !== state.payoutPolicy.bankFeeCents || snapshot.bankFeeCents !== policy.bankFeeCents || snapshot.bankEncrypted !== state.profile.bankEncrypted || snapshot.taxIdentityEncrypted !== state.profile.taxIdentityEncrypted) return null;
    const quote = calculateAffiliateRemuneration({ grossAmountCents: state.payout.finalAmountCents, bankFeeCents: policy.bankFeeCents, recipientType: state.profile.recipientType, nhiTreatment: state.profile.nhiTreatment, exemptionReference: state.profile.exemptionReference ?? undefined, invoiceReference: state.profile.invoiceReference ?? undefined });
    if (Object.entries(quote).some(([field, value]) => snapshot[field as keyof typeof snapshot] !== value)) return null;
    const keyring = injectedKeyring ?? loadRuntimeBankAccountKeyring();
    const bank = decryptAffiliateBankAccount(snapshot.bankEncrypted, scope, keyring);
    const taxIdentity = decryptAffiliateTaxIdentity(snapshot.taxIdentityEncrypted, scope, keyring);
    if (snapshot.status === "signed") {
      const changed = await tx.affiliateRemunerationSnapshot.updateMany({ where: { ...scope, id: snapshot.id, status: "signed" }, data: { status: "exported", exportedAt: new Date() } });
      if (changed.count !== 1) return null;
      await tx.affiliateRemunerationExport.create({ data: { ...scope, snapshotId, exportedByUserId: actor.userId } });
    }
    const receipt = await tx.affiliateRemunerationExport.findUnique({ where: { snapshotId } });
    if (!receipt) throw new Error("Export receipt is required.");
    return { snapshotId, payoutId: snapshot.payoutId, revision: snapshot.revision, exportedAt: receipt.createdAt, ...quote, bank, taxIdentity };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Existing merchant finance action calls this inside its serializable payout
 * transaction. Enrolled payouts cannot bypass current signature/export proof;
 * legacy payouts without a policy or snapshot keep their original contract. */
export async function affiliateRemunerationPaymentProof(tx: Prisma.TransactionClient, scope: AffiliateBankScope, payoutId: string, confirmation: FormData) {
  const policy = await tx.merchantAffiliatePayoutPolicy.findUnique({ where: { vendorId: scope.vendorId } });
  const latest = await tx.affiliateRemunerationSnapshot.findFirst({ where: { ...scope, payoutId }, orderBy: { revision: "desc" } });
  if (!policy?.enabled && !latest) return null;
  if (!policy?.enabled || latest?.status !== "exported" || !latest.signedByUserId) throw new AffiliatePayoutMutationConflict();
  const state = await current(tx, { userId: latest.signedByUserId }, scope, payoutId);
  if (!state || latest.ledgerDigest !== state.ledgerDigest || latest.profileRevision !== state.profile.revision || latest.payoutPolicyRevision !== state.payoutPolicy.revision || latest.bankFeeCents !== state.payoutPolicy.bankFeeCents || latest.bankEncrypted !== state.profile.bankEncrypted || latest.taxIdentityEncrypted !== state.profile.taxIdentityEncrypted) throw new AffiliatePayoutMutationConflict();
  const quote = calculateAffiliateRemuneration({ grossAmountCents: state.payout.finalAmountCents, bankFeeCents: state.payoutPolicy.bankFeeCents, recipientType: state.profile.recipientType, nhiTreatment: state.profile.nhiTreatment, exemptionReference: state.profile.exemptionReference ?? undefined, invoiceReference: state.profile.invoiceReference ?? undefined });
  if (Object.entries(quote).some(([field, value]) => latest[field as keyof typeof latest] !== value)) throw new AffiliatePayoutMutationConflict();
  if (!await tx.affiliateRemunerationExport.findUnique({ where: { snapshotId: latest.id }, select: { snapshotId: true } })) throw new AffiliatePayoutMutationConflict();
  // Confirm the human-recorded transfer against the current immutable snapshot.
  if (confirmation.get("remunerationSnapshotId") !== latest.id
    || !/^\d{1,10}$/u.test(String(confirmation.get("paidNetAmountCents") ?? ""))
    || Number(confirmation.get("paidNetAmountCents")) !== latest.netPayoutAmountCents
    || confirmation.get("paidNetConfirmed") !== "on") throw new AffiliatePayoutMutationConflict();
  return { snapshotId: latest.id, netPayoutAmountCents: latest.netPayoutAmountCents };
}
