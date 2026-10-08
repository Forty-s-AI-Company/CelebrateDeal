import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parseMerchantAffiliateTerms, calculateMerchantAffiliatePlan, type AffiliateCommissionLine } from "./affiliate-tier-policy";
import { buildCommissionDeduplicationKey } from "./affiliate-commission";
import { appendCommissionLedgerEntry } from "./affiliate-commission-accounting";

const Id = z.string().trim().min(1).max(191);
export class MerchantAffiliatePolicyConflict extends Error {}
export class MerchantAffiliatePolicyDenied extends Error {}
type Actor = { vendorId: string; userId: string };

async function assertManager(tx: Prisma.TransactionClient, actor: Actor) {
  Id.parse(actor.vendorId); Id.parse(actor.userId);
  const member = await tx.vendorMember.findFirst({ where: { vendorId: actor.vendorId, userId: actor.userId, status: "active", role: { in: ["owner", "admin"] }, user: { status: "active" }, vendor: { enabledFeatureModules: { has: "affiliate_program" } } }, select: { id: true } });
  if (!member) throw new MerchantAffiliatePolicyDenied("無權管理這個商家的佣金政策。");
}
async function serializable<T>(db: PrismaClient, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await db.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2034", "P2002"].includes(error.code) || attempt === 2) throw error;
    }
  }
  throw new MerchantAffiliatePolicyConflict("佣金政策交易未完成。");
}

/** Publishing never edits old terms or recalculates earlier checkouts. A
 * tenant-bound CAS pointer and immutable version are committed together. */
export async function publishMerchantAffiliatePolicy(db: PrismaClient, actor: Actor, input: { terms: unknown; expectedRevision: number }) {
  const terms = parseMerchantAffiliateTerms(input.terms), revision = z.number().int().nonnegative().parse(input.expectedRevision);
  return serializable(db, async tx => {
    await assertManager(tx, actor);
    let state = await tx.merchantAffiliatePolicyState.findUnique({ where: { vendorId: actor.vendorId } });
    if (!state) {
      if (revision !== 0) throw new MerchantAffiliatePolicyConflict("政策版本已變更。");
      state = await tx.merchantAffiliatePolicyState.create({ data: { vendorId: actor.vendorId, revision: 0 } });
    }
    if (state.revision !== revision) throw new MerchantAffiliatePolicyConflict("政策版本已變更。");
    if (terms.productOverrides.length) {
      const count = await tx.product.count({ where: { vendorId: actor.vendorId, commerceDomain: "merchant", currency: terms.currency, id: { in: terms.productOverrides.map(item => item.productId) } } });
      if (count !== terms.productOverrides.length) throw new MerchantAffiliatePolicyDenied("商品覆蓋率只能使用同一商家的商務商品。");
    }
    const versions = await tx.merchantAffiliatePolicy.aggregate({ where: { vendorId: actor.vendorId }, _max: { version: true } });
    const policy = await tx.merchantAffiliatePolicy.create({ data: { vendorId: actor.vendorId, version: (versions._max.version ?? 0) + 1, terms: terms as Prisma.InputJsonValue } });
    if (terms.productOverrides.length) await tx.merchantAffiliateProductRate.createMany({ data: terms.productOverrides.map(item => ({ vendorId: actor.vendorId, policyId: policy.id, productId: item.productId, rateBps: item.rateBps })) });
    const changed = await tx.merchantAffiliatePolicyState.updateMany({ where: { vendorId: actor.vendorId, revision }, data: { activePolicyId: policy.id, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new MerchantAffiliatePolicyConflict("政策版本已變更。");
    return { policyId: policy.id, version: policy.version, revision: revision + 1 };
  });
}
export async function pauseMerchantAffiliatePolicy(db: PrismaClient, actor: Actor, expectedRevision: number) {
  const revision = z.number().int().nonnegative().parse(expectedRevision);
  return serializable(db, async tx => {
    await assertManager(tx, actor);
    const changed = await tx.merchantAffiliatePolicyState.updateMany({ where: { vendorId: actor.vendorId, revision }, data: { activePolicyId: null, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new MerchantAffiliatePolicyConflict("政策版本已變更。");
    return { revision: revision + 1 };
  });
}
export async function getMerchantAffiliatePolicy(db: PrismaClient, actor: Actor) {
  return db.$transaction(async tx => {
    await assertManager(tx, actor);
    const state = await tx.merchantAffiliatePolicyState.findUnique({ where: { vendorId: actor.vendorId }, include: { activePolicy: true } });
    return { revision: state?.revision ?? 0, policy: state?.activePolicy ? { id: state.activePolicy.id, version: state.activePolicy.version, terms: parseMerchantAffiliateTerms(state.activePolicy.terms) } : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** Called only inside the existing canonical checkout transaction. The
 * verified affiliate ID comes from the signed click, never request form data. */
export async function freezeMerchantAffiliateCheckout(tx: Prisma.TransactionClient, input: {
  vendorId: string; transactionId: string; orderId: string; affiliateId: string; referralCode: string; now?: Date;
}) {
  for (const value of [input.vendorId, input.transactionId, input.orderId, input.affiliateId]) Id.parse(value);
  const state = await tx.merchantAffiliatePolicyState.findUnique({ where: { vendorId: input.vendorId }, include: { activePolicy: true } });
  const order = await tx.commerceOrder.findFirst({ where: { vendorId: input.vendorId, id: input.orderId, primaryPaymentTransactionId: input.transactionId }, select: { id: true, currency: true, totalAmountCents: true, subtotalAmountCents: true, items: { orderBy: { lineIndex: "asc" }, select: { productId: true, lineIndex: true, quantity: true, lineTotalCents: true, commerceDomain: true } } } });
  // Course F/G and platform subscriptions have separate budgets and contracts.
  if (!order || order.items.some(item => item.commerceDomain !== "merchant")) return null;
  const affiliate = await tx.affiliate.findFirst({ where: { vendorId: input.vendorId, id: input.affiliateId, code: input.referralCode, isActive: true }, select: { id: true, commissionRateBps: true } });
  if (!affiliate) throw new MerchantAffiliatePolicyConflict("推薦身分已變更，請重新結帳。");
  const terms = parseMerchantAffiliateTerms(state?.activePolicy?.terms ?? fixedRateTerms(affiliate.commissionRateBps));
  if (order.currency !== terms.currency) throw new MerchantAffiliatePolicyDenied("付款幣別不符合佣金政策。");
  const now = input.now ?? new Date();
  const recipients = await frozenTeamRecipients(tx, { vendorId: input.vendorId, affiliateId: affiliate.id }, terms.uplines.length, now);
  const lines: AffiliateCommissionLine[] = order.items.map(item => ({ productId: Id.parse(item.productId), quantity: item.quantity, amountCents: item.lineTotalCents - (item.lineIndex === 0 ? (order.subtotalAmountCents - order.totalAmountCents) : 0) }));
  // Validate all frozen values, including a zero-cent prospective plan, without
  // consuming quantity: the paid transaction is the sole counter writer.
  calculateMerchantAffiliatePlan({ terms, recipients: recipients.map(({ affiliateId, level }) => ({ affiliateId, level })), lines, qualifiedQuantityBefore: 0, netReferenceAmountCents: order.totalAmountCents });
  return tx.merchantAffiliateCheckoutSnapshot.create({ data: { vendorId: input.vendorId, paymentTransactionId: input.transactionId, orderId: order.id, policyId: state?.activePolicy?.id ?? null, fixedRateBps: state?.activePolicy ? null : affiliate.commissionRateBps, promoterAffiliateId: affiliate.id, currency: order.currency, grossAmountCents: order.totalAmountCents, lines: lines as unknown as Prisma.InputJsonValue, recipientTerms: recipients as Prisma.InputJsonValue, recipients: { create: recipients } } });
}

/** The surrounding payment webhook owns the serializable transaction. Frozen
 * terms and recipients remain payable even if later configuration changes. */
export async function accrueMerchantAffiliatePlan(tx: Prisma.TransactionClient, input: {
  vendorId: string; transactionId: string; providerName: string; occurredAt: Date;
}) {
  const checkout = await tx.merchantAffiliateCheckoutSnapshot.findUnique({ where: { vendorId_paymentTransactionId: { vendorId: input.vendorId, paymentTransactionId: input.transactionId } }, include: { policy: true, recipients: { orderBy: { level: "asc" } }, calculation: true } });
  if (!checkout) return null; // Explicit legacy flat-rate compatibility path.
  const payment = await tx.paymentTransaction.findFirst({ where: { vendorId: input.vendorId, id: input.transactionId }, select: { status: true, grossAmountCents: true, netAmountCents: true, currency: true, orderNumber: true } });
  if (!payment || payment.grossAmountCents !== checkout.grossAmountCents || payment.currency !== checkout.currency) throw new MerchantAffiliatePolicyConflict("付款不符合原始佣金快照。");
  if (checkout.calculation) {
    return { calculation: checkout.calculation, commissions: await tx.affiliateCommission.findMany({ where: { vendorId: input.vendorId, merchantCalculationId: checkout.calculation.id }, orderBy: { merchantLevel: "asc" } }) };
  }
  if (payment.status !== "paid") throw new MerchantAffiliatePolicyConflict("首次佣金計算必須是已付款交易。");
  const key = { vendorId: input.vendorId, affiliateId: checkout.promoterAffiliateId };
  const counter = await tx.merchantAffiliateSalesCounter.upsert({ where: { vendorId_affiliateId: key }, create: { ...key, quantity: BigInt("0") }, update: {} });
  const lines = z.array(z.object({ productId: Id, quantity: z.number().int().positive(), amountCents: z.number().int().nonnegative() }).strict()).parse(checkout.lines);
  const result = calculateMerchantAffiliatePlan({ terms: checkout.policy?.terms ?? fixedRateTerms(checkout.fixedRateBps!), recipients: checkout.recipients.map(({ affiliateId, level }) => ({ affiliateId, level })), lines, qualifiedQuantityBefore: counter.quantity, netReferenceAmountCents: payment.netAmountCents });
  const plan = { ...result, recipients: result.recipients.map(recipient => ({ ...recipient, checkoutRecipientId: checkout.recipients.find(item => item.affiliateId === recipient.affiliateId && item.level === recipient.level)!.id })) };
  const changed = await tx.merchantAffiliateSalesCounter.updateMany({ where: { ...key, quantity: counter.quantity }, data: { quantity: BigInt(plan.qualifiedQuantityAfter) } });
  if (changed.count !== 1) throw new MerchantAffiliatePolicyConflict("成交件數已由其他付款變更。");
  const calculation = await tx.merchantAffiliateCalculation.create({ data: { vendorId: input.vendorId, checkoutId: checkout.id, qualifiedQuantityBefore: BigInt(plan.qualifiedQuantityBefore), qualifiedQuantityAfter: BigInt(plan.qualifiedQuantityAfter), plan: plan as Prisma.InputJsonValue } });
  const commissions = [];
  for (const recipient of plan.recipients) {
    if (!recipient.amountCents) continue; // Zero plans are still immutable and consume quantity exactly once.
    const saved = await tx.affiliateCommission.create({ data: { vendorId: input.vendorId, affiliateId: recipient.affiliateId, sourceType: "webhook", sourceId: input.transactionId, deduplicationKey: buildCommissionDeduplicationKey({ affiliateId: recipient.affiliateId, sourceType: "webhook", sourceId: input.transactionId }), orderNumber: payment.orderNumber, monthKey: input.occurredAt.toISOString().slice(0, 7), orderAmountCents: plan.grossAmountCents, commissionBaseAmountCents: plan.grossAmountCents, netReferenceAmountCents: payment.netAmountCents, commissionRateBps: recipient.effectiveRateBps, commissionAmountCents: recipient.amountCents, merchantCheckoutId: checkout.id, merchantCalculationId: calculation.id, merchantRecipientId: recipient.checkoutRecipientId, merchantLevel: recipient.level, status: "pending", attributedAt: input.occurredAt } });
    await appendCommissionLedgerEntry(tx, { vendorId: input.vendorId, affiliateCommissionId: saved.id, entryType: "accrual", providerName: input.providerName, eventIdentity: `paid:${input.transactionId}`, amountCents: saved.commissionAmountCents, occurredAt: input.occurredAt });
    commissions.push(saved);
  }
  return { calculation, commissions };
}

// Prospective fixed-rate checkouts also preserve the verified affiliate identity.
function fixedRateTerms(rateBps: number) {
  return { schemaVersion: 1, currency: "TWD", maxTotalBps: 10000, tiers: [{ minQuantity: 1, maxQuantity: null, rateBps }], uplines: [], productOverrides: [] };
}

/** Resolve a bounded, tenant-qualified chain without compressing missing levels. */
async function frozenTeamRecipients(tx: Prisma.TransactionClient, input: { vendorId: string; affiliateId: string }, levelLimit: number, now: Date) {
  const membership = await tx.teamMembership.findFirst({ where: { vendorId: input.vendorId, affiliateId: input.affiliateId, status: "ACTIVE", vendorMember: { status: "active", user: { status: "active" } } }, select: { id: true, teamId: true } });
  const recipients: Array<{ id: string; affiliateId: string; level: number; teamId: string | null; teamMembershipId: string | null }> = [{ id: randomUUID(), affiliateId: input.affiliateId, level: 0, teamId: membership?.teamId ?? null, teamMembershipId: membership?.id ?? null }];
  const memberships = new Set<string>(membership ? [membership.id] : []), affiliates = new Set([input.affiliateId]);
  let downline = membership?.id;
  for (let level = 1; downline && level <= levelLimit; level += 1) {
    const edges = await tx.teamMembershipRelationship.findMany({ where: { teamId: membership!.teamId, downlineMembershipId: downline, effectiveAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }] }, take: 2, select: { uplineMembershipId: true } });
    if (!edges.length) break;
    if (edges.length !== 1 || memberships.has(edges[0]!.uplineMembershipId)) throw new MerchantAffiliatePolicyConflict("團隊上線關係不一致。");
    const parent = await tx.teamMembership.findFirst({ where: { vendorId: input.vendorId, teamId: membership!.teamId, id: edges[0]!.uplineMembershipId, status: "ACTIVE", vendorMember: { status: "active", user: { status: "active" } } }, select: { id: true, affiliateId: true, affiliate: { select: { vendorId: true, isActive: true } } } });
    if (!parent) throw new MerchantAffiliatePolicyConflict("團隊上線目前無法確認。");
    memberships.add(parent.id); downline = parent.id;
    if (!parent.affiliateId) continue; // Keep this level's position; never compress a missing recipient.
    if (parent.affiliate?.vendorId !== input.vendorId || !parent.affiliate.isActive || affiliates.has(parent.affiliateId)) throw new MerchantAffiliatePolicyConflict("團隊受益人不一致。");
    affiliates.add(parent.affiliateId);
    recipients.push({ id: randomUUID(), affiliateId: parent.affiliateId, level, teamId: membership!.teamId, teamMembershipId: parent.id });
  }
  return recipients;
}
