import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { encryptAffiliateBankAccount, type AffiliateBankScope } from "./affiliate-bank-account";
import { encryptAffiliateTaxIdentity } from "./affiliate-tax-identity";
import { loadRuntimeBankAccountKeyring, type BankAccountKeyring } from "./bank-account";
import { validateAffiliateRecipientClassification } from "./affiliate-remuneration";
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u);
const Revision = z.number().int().min(0).max(2_147_483_646);
const Submission = z.object({ expectedRevision: Revision, bank: z.unknown(), taxIdentity: z.unknown(), recipientType: z.enum(["resident_individual", "nonresident_individual", "domestic_invoice_business"]), nhiTreatment: z.enum(["subject_execution_business", "documented_exemption", "not_insured", "not_applicable_business"]), exemptionReference: Id.optional(), invoiceReference: Id.optional() }).strict();
type Database = Pick<PrismaClient, "$transaction">;
export class AffiliatePayeeConflict extends Error {}
const publicProfile = { revision: true, recipientType: true, nhiTreatment: true, approvedRevision: true } as const;

/** Authenticated routes supply actor/scope. Never trust role, approved fields,
 * encrypted payloads or monetary amounts supplied by the browser. */
export async function submitAffiliatePayeeProfile(db: Database, actor: { userId: string }, scope: AffiliateBankScope, raw: unknown, injectedKeyring?: BankAccountKeyring) {
  if (![actor.userId, scope.vendorId, scope.affiliateId].every(value => Id.safeParse(value).success)) return null;
  const input = Submission.parse(raw);
  // Validate the claimed classification shape, without granting approval.
  validateAffiliateRecipientClassification({ recipientType: input.recipientType, nhiTreatment: input.nhiTreatment, exemptionReference: input.exemptionReference, invoiceReference: input.invoiceReference });
  return db.$transaction(async tx => {
    const access = await tx.affiliatePortalAccess.findFirst({ where: { ...scope, active: true, affiliate: { isActive: true }, member: { status: "active", userId: actor.userId, user: { status: "active" } } }, select: { revision: true } });
    if (!access) return null;
    const keyring = injectedKeyring ?? loadRuntimeBankAccountKeyring();
    const data = { bankEncrypted: encryptAffiliateBankAccount(input.bank, scope, keyring), taxIdentityEncrypted: encryptAffiliateTaxIdentity(input.taxIdentity, scope, keyring), recipientType: input.recipientType, nhiTreatment: input.nhiTreatment, exemptionReference: input.exemptionReference ?? null, invoiceReference: input.invoiceReference ?? null, approvedRevision: null, approvedByUserId: null, approvedAt: null };
    const existing = await tx.affiliatePayeeProfile.findUnique({ where: { vendorId_affiliateId: scope }, select: { revision: true } });
    if (!existing) {
      if (input.expectedRevision !== 0) throw new AffiliatePayeeConflict();
      return tx.affiliatePayeeProfile.create({ data: { ...scope, ...data, revision: 1 }, select: publicProfile });
    }
    const changed = await tx.affiliatePayeeProfile.updateMany({ where: { ...scope, revision: input.expectedRevision }, data: { ...data, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new AffiliatePayeeConflict();
    await tx.affiliateRemunerationSnapshot.updateMany({ where: { ...scope, status: { in: ["quoted", "signed"] } }, data: { status: "invalidated", invalidatedAt: new Date() } });
    return tx.affiliatePayeeProfile.findUnique({ where: { vendorId_affiliateId: scope }, select: publicProfile });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function approveAffiliatePayeeProfile(db: Database, actor: { userId: string }, scope: AffiliateBankScope, expectedRevision: number) {
  if (![actor.userId, scope.vendorId, scope.affiliateId].every(value => Id.safeParse(value).success)) return null;
  Revision.parse(expectedRevision);
  return db.$transaction(async tx => {
    const manager = await tx.vendorMember.findFirst({ where: { vendorId: scope.vendorId, userId: actor.userId, status: "active", role: { in: ["owner", "admin"] }, user: { status: "active" } }, select: { id: true } });
    if (!manager) return null;
    const affiliate = await tx.affiliate.findFirst({ where: { id: scope.affiliateId, vendorId: scope.vendorId, isActive: true }, select: { id: true } });
    if (!affiliate) return null;
    const approvedAt = new Date();
    const changed = await tx.affiliatePayeeProfile.updateMany({ where: { ...scope, revision: expectedRevision, approvedRevision: null }, data: { approvedRevision: expectedRevision, approvedByUserId: actor.userId, approvedAt } });
    if (changed.count !== 1) throw new AffiliatePayeeConflict();
    // Persist version approval provenance independently of the editable profile.
    await tx.auditLog.create({ data: {
      vendorId: scope.vendorId, actorId: manager.id, action: "approve_affiliate_payee_profile",
      targetType: "AffiliatePayeeProfile", targetId: scope.affiliateId,
      after: { affiliateId: scope.affiliateId, profileRevision: expectedRevision, approvedByUserId: actor.userId, approvedAt: approvedAt.toISOString() },
    } });
    return tx.affiliatePayeeProfile.findUnique({ where: { vendorId_affiliateId: scope }, select: publicProfile });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
