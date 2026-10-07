import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { getDb } from "./db";
import { createReservedPaymentTransaction } from "./inventory-reservations";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition } from "./commerce-orders";
import { applyPaymentRefundAccounting } from "./payment-refund-accounting";
import { publishMerchantAffiliatePolicy, pauseMerchantAffiliatePolicy, freezeMerchantAffiliateCheckout, accrueMerchantAffiliatePlan, MerchantAffiliatePolicyDenied, MerchantAffiliatePolicyConflict } from "./merchant-affiliate-policy-service";
import { appendDisputeLedgerEntry, commissionLedgerPayableState } from "./affiliate-commission-accounting";
import { reconcileAffiliatePendingPayout } from "./affiliate-payout-accounting";

const db = getDb();
const terms = { schemaVersion: 1, currency: "TWD", maxTotalBps: 10000, tiers: [{ minQuantity: 1, maxQuantity: 1, rateBps: 1000 }, { minQuantity: 2, maxQuantity: null, rateBps: 2000 }], uplines: [], productOverrides: [] };
async function fixture() {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic policy shop", slug: `policy-${id}`, email: `${id}@example.test`, passwordHash: "synthetic-only", enabledFeatureModules: ["affiliate_program"] } });
  const user = await db.user.create({ data: { name: "Synthetic owner", email: `owner-${id}@example.test`, passwordHash: "synthetic-only", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } });
  const affiliate = await db.affiliate.create({ data: { vendorId: vendor.id, name: "Synthetic promoter", code: id } });
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic physical", slug: id, priceCents: 1000, currency: "TWD", inventory: 10, isActive: true, fulfillmentTypeConfirmed: true, commerceDomain: "merchant", fulfillmentType: "physical" } });
  return { vendor, user, affiliate, product, actor: { vendorId: vendor.id, userId: user.id } };
}
async function checkout(f: Awaited<ReturnType<typeof fixture>>, gross = 900, discount = 100) {
  const key = randomUUID();
  return createReservedPaymentTransaction({ vendorId: f.vendor.id, productId: f.product.id, checkoutIdempotencyKey: key,
    transactionData: { vendorId: f.vendor.id, providerName: "demo", orderNumber: key, checkoutIdempotencyKey: key, grossAmountCents: gross, netAmountCents: gross, currency: "TWD", status: "pending", metadata: { productId: f.product.id } },
    createCommerceOrder: async (tx, payment) => {
      const order = await createCommerceOrderForCheckout(tx, { vendorId: f.vendor.id, productId: f.product.id, orderNumber: key, checkoutIdempotencyKey: key, paymentTransactionId: payment.id, totalAmountCents: gross, discountAmountCents: discount, currency: "TWD", buyer: { name: "Synthetic buyer", email: "buyer@example.test", phone: "0912345678" }, shipping: { recipientName: "Synthetic buyer", phone: "0912345678", countryCode: "TW", postalCode: "100", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" } });
      await freezeMerchantAffiliateCheckout(tx, { vendorId: f.vendor.id, orderId: order.id, transactionId: payment.id, affiliateId: f.affiliate.id, referralCode: f.affiliate.code });
    } });
}
async function accrue(f: Awaited<ReturnType<typeof fixture>>, paymentId: string) {
  return db.$transaction(async tx => {
    await tx.paymentTransaction.update({ where: { id: paymentId }, data: { status: "paid" } });
    await reconcileCommerceOrderPaymentTransition(tx, { vendorId: f.vendor.id, paymentTransactionId: paymentId, transition: "paid", eventIdentity: `paid:${paymentId}`, occurredAt: new Date("2026-10-06T00:00:00Z") });
    return accrueMerchantAffiliatePlan(tx, { vendorId: f.vendor.id, transactionId: paymentId, providerName: "demo", occurredAt: new Date("2026-10-06T00:00:00Z") });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// Append-only rows are preserved until the owned disposable container is destroyed.
describe("merchant policy real disposable database", () => {
  it("binds management, overrides and CAS to the authenticated tenant", async () => {
    const f = await fixture(), other = await fixture();
    await expect(publishMerchantAffiliatePolicy(db, { ...f.actor, userId: other.user.id }, { terms, expectedRevision: 0 })).rejects.toBeInstanceOf(MerchantAffiliatePolicyDenied);
    await expect(publishMerchantAffiliatePolicy(db, f.actor, { terms: { ...terms, productOverrides: [{ productId: other.product.id, rateBps: 1000 }] }, expectedRevision: 0 })).rejects.toBeInstanceOf(MerchantAffiliatePolicyDenied);
    const results = await Promise.allSettled([0, 1, 2].map(() => publishMerchantAffiliatePolicy(db, f.actor, { terms, expectedRevision: 0 })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toBeInstanceOf(MerchantAffiliatePolicyConflict);
    expect(await db.merchantAffiliatePolicy.count({ where: { vendorId: f.vendor.id } })).toBe(1);
  });
  it("freezes discounted order terms and retries the original plan after configuration changes", async () => {
    const f = await fixture();
    await publishMerchantAffiliatePolicy(db, f.actor, { terms, expectedRevision: 0 });
    const payment = await checkout(f);
    await publishMerchantAffiliatePolicy(db, f.actor, { terms: { ...terms, tiers: [{ minQuantity: 1, maxQuantity: null, rateBps: 5000 }] }, expectedRevision: 1 });
    const first = await accrue(f, payment.id);
    expect(first!.commissions.map(item => item.commissionAmountCents)).toEqual([90]);
    await db.affiliate.update({ where: { id: f.affiliate.id }, data: { isActive: false, commissionRateBps: 9000 } });
    const retry = await accrue(f, payment.id);
    expect(retry!.calculation.id).toBe(first!.calculation.id);
    expect(await db.merchantAffiliateSalesCounter.findUniqueOrThrow({ where: { vendorId_affiliateId: { vendorId: f.vendor.id, affiliateId: f.affiliate.id } } })).toMatchObject({ quantity: BigInt(1) });
    expect(await db.affiliateCommissionLedgerEntry.count({ where: { vendorId: f.vendor.id } })).toBe(1);
    await expect(db.merchantAffiliateCheckoutSnapshot.update({ where: { id: first!.calculation.checkoutId }, data: { grossAmountCents: 901 } })).rejects.toThrow();
    await expect(db.merchantAffiliateCalculation.update({ where: { id: first!.calculation.id }, data: { plan: {} } })).rejects.toThrow();
  });
  it("serializes concurrent paid quantity and retries without paying the same unit twice", async () => {
    const f = await fixture();
    await publishMerchantAffiliatePolicy(db, f.actor, { terms, expectedRevision: 0 });
    const payments = [await checkout(f), await checkout(f)];
    const attempt = await Promise.allSettled(payments.map(payment => accrue(f, payment.id)));
    // Serializable conflicts must roll back the entire counter/plan/ledger write.
    for (const result of attempt) if (result.status === "rejected") {
      expect(result.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(result.reason.code).toBe("P2034");
    }
    const results = [];
    for (const payment of payments) results.push(await accrue(f, payment.id));
    expect(results.map(result => result!.commissions[0]!.commissionAmountCents).sort((a, b) => a - b)).toEqual([90, 180]);
    expect(await db.merchantAffiliateCalculation.count({ where: { vendorId: f.vendor.id } })).toBe(2);
    expect(await db.affiliateCommissionLedgerEntry.count({ where: { vendorId: f.vendor.id } })).toBe(2);
    expect(await db.merchantAffiliateSalesCounter.findUniqueOrThrow({ where: { vendorId_affiliateId: { vendorId: f.vendor.id, affiliateId: f.affiliate.id } } })).toMatchObject({ quantity: BigInt(2) });
  });
  it("persists a zero commission plan and advances paid quantity exactly once", async () => {
    const f = await fixture();
    await publishMerchantAffiliatePolicy(db, f.actor, { terms: { ...terms, tiers: [{ minQuantity: 1, maxQuantity: null, rateBps: 0 }] }, expectedRevision: 0 });
    const payment = await checkout(f);
    const first = await accrue(f, payment.id), retry = await accrue(f, payment.id);
    expect(first!.commissions).toEqual([]);
    expect(retry!.calculation.id).toBe(first!.calculation.id);
    expect(await db.merchantAffiliateCalculation.count({ where: { vendorId: f.vendor.id } })).toBe(1);
    expect(await db.affiliateCommissionLedgerEntry.count({ where: { vendorId: f.vendor.id } })).toBe(0);
    expect(await db.merchantAffiliateSalesCounter.findUniqueOrThrow({ where: { vendorId_affiliateId: { vendorId: f.vendor.id, affiliateId: f.affiliate.id } } })).toMatchObject({ quantity: BigInt(1) });
  });
  it("refunds every frozen team beneficiary with exact records, cumulative rounding and idempotent replay", async () => {
    const f = await fixture(), id = randomUUID();
    const parent = await db.affiliate.create({ data: { vendorId: f.vendor.id, name: "Synthetic upline", code: id } });
    const user = await db.user.create({ data: { name: "Synthetic upline", email: `${id}@example.test`, passwordHash: "synthetic-only", memberships: { create: { vendorId: f.vendor.id, role: "partner", status: "active" } } }, include: { memberships: true } });
    const member = await db.vendorMember.findFirstOrThrow({ where: { vendorId: f.vendor.id, userId: f.user.id } });
    const team = await db.salesTeam.create({ data: { vendorId: f.vendor.id, name: "Synthetic team", slug: id } });
    const downline = await db.teamMembership.create({ data: { vendorId: f.vendor.id, teamId: team.id, vendorMemberId: member.id, affiliateId: f.affiliate.id } });
    const upline = await db.teamMembership.create({ data: { vendorId: f.vendor.id, teamId: team.id, vendorMemberId: user.memberships[0]!.id, affiliateId: parent.id } });
    await db.teamMembershipRelationship.create({ data: { teamId: team.id, uplineMembershipId: upline.id, downlineMembershipId: downline.id, effectiveAt: new Date("2026-01-01T00:00:00Z") } });
    await publishMerchantAffiliatePolicy(db, f.actor, { terms: { ...terms, uplines: [{ level: 1, rateBps: 500 }] }, expectedRevision: 0 });
    const payment = await checkout(f), result = await accrue(f, payment.id);
    expect(result!.commissions.map(item => item.commissionAmountCents)).toEqual([90, 45]);
    let cumulative = 0;
    for (const amount of [1, 299, 600]) {
      cumulative += amount;
      const event = randomUUID();
      await db.$transaction(async tx => {
        await tx.paymentTransaction.update({ where: { id: payment.id }, data: { status: cumulative === 900 ? "refunded" : "partially_refunded", refundedAmountCents: cumulative } });
        const record = await tx.refundRecord.create({ data: { vendorId: f.vendor.id, paymentTransactionId: payment.id, providerEventId: event, monthKey: "2026-10", refundAmountCents: amount, status: "processed" } });
        const input = { vendorId: f.vendor.id, transactionId: payment.id, orderNumber: payment.orderNumber, providerName: "demo", eventIdentity: event, refundRecordId: record.id, refundAmountCents: amount, netReferenceAmountCents: 900 - cumulative, isFullRefund: cumulative === 900, transactionOccurredAt: new Date("2026-10-06T00:00:00Z"), occurredAt: new Date("2026-10-06T01:00:00Z") };
        await applyPaymentRefundAccounting(tx, input);
        const before = await tx.affiliateCommissionLedgerEntry.count({ where: { vendorId: f.vendor.id } });
        await applyPaymentRefundAccounting(tx, input);
        expect(await tx.affiliateCommissionLedgerEntry.count({ where: { vendorId: f.vendor.id } })).toBe(before);
        const replay = await accrueMerchantAffiliatePlan(tx, { vendorId: f.vendor.id, transactionId: payment.id, providerName: "demo", occurredAt: new Date("2026-10-06T02:00:00Z") });
        expect(replay!.calculation.id).toBe(result!.calculation.id);
        expect((await tx.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(cumulative === 900 ? "refunded" : "partially_refunded");
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    for (const commission of result!.commissions) {
      expect((await db.affiliateCommissionLedgerEntry.aggregate({ where: { vendorId: f.vendor.id, affiliateCommissionId: commission.id }, _sum: { amountCents: true } }))._sum.amountCents).toBe(0);
      expect(await db.affiliateCommission.findUniqueOrThrow({ where: { id: commission.id } })).toMatchObject({ commissionAmountCents: commission.commissionAmountCents, status: "void" });
    }
    expect(await db.merchantAffiliateSalesCounter.findUniqueOrThrow({ where: { vendorId_affiliateId: { vendorId: f.vendor.id, affiliateId: f.affiliate.id } } })).toMatchObject({ quantity: BigInt(1) });
  });
  it("closes both beneficiary disputes after a one-cent refund leaves one zero balance", async () => {
    const f = await fixture(), id = randomUUID();
    const parent = await db.affiliate.create({ data: { vendorId: f.vendor.id, name: "Synthetic upline", code: id } });
    const user = await db.user.create({ data: { name: "Synthetic upline", email: `${id}@example.test`, passwordHash: "synthetic-only", memberships: { create: { vendorId: f.vendor.id, role: "partner", status: "active" } } }, include: { memberships: true } });
    const member = await db.vendorMember.findFirstOrThrow({ where: { vendorId: f.vendor.id, userId: f.user.id } });
    const team = await db.salesTeam.create({ data: { vendorId: f.vendor.id, name: "Synthetic team", slug: id } });
    const downline = await db.teamMembership.create({ data: { vendorId: f.vendor.id, teamId: team.id, vendorMemberId: member.id, affiliateId: f.affiliate.id } });
    const upline = await db.teamMembership.create({ data: { vendorId: f.vendor.id, teamId: team.id, vendorMemberId: user.memberships[0]!.id, affiliateId: parent.id } });
    await db.teamMembershipRelationship.create({ data: { teamId: team.id, uplineMembershipId: upline.id, downlineMembershipId: downline.id, effectiveAt: new Date("2026-01-01T00:00:00Z") } });
    await db.product.update({ where: { id: f.product.id }, data: { priceCents: 2 } });
    await publishMerchantAffiliatePolicy(db, f.actor, { terms: { ...terms, tiers: [{ minQuantity: 1, maxQuantity: null, rateBps: 5000 }], uplines: [{ level: 1, rateBps: 5000 }] }, expectedRevision: 0 });
    const payment = await checkout(f, 2, 0), result = await accrue(f, payment.id);
    expect(result!.commissions.map(row => row.commissionAmountCents)).toEqual([1, 1]);
    await db.$transaction(async tx => {
      const record = await tx.refundRecord.create({ data: { vendorId: f.vendor.id, paymentTransactionId: payment.id, monthKey: "2026-10", refundAmountCents: 1, status: "processed" } });
      await applyPaymentRefundAccounting(tx, { vendorId: f.vendor.id, transactionId: payment.id, orderNumber: payment.orderNumber, providerName: "demo", eventIdentity: "one-cent", refundRecordId: record.id, refundAmountCents: 1, netReferenceAmountCents: 1, isFullRefund: false, transactionOccurredAt: new Date(), occurredAt: new Date() });
      const balances = [];
      for (const commission of result!.commissions) {
        const before = await commissionLedgerPayableState(tx, f.vendor.id, commission.id);
        balances.push(before.balanceCents);
        const base = { vendorId: f.vendor.id, affiliateCommissionId: commission.id, providerName: "demo", disputeCaseId: "two-beneficiary-case", occurredAt: new Date() };
        await appendDisputeLedgerEntry(tx, { ...base, entryType: "dispute_opened", eventIdentity: "opened" });
        const terminal = await appendDisputeLedgerEntry(tx, { ...base, entryType: "dispute_lost", eventIdentity: "lost" });
        expect(terminal.amountCents).toBe(before.balanceCents === 0 ? 0 : -before.balanceCents);
        expect((await appendDisputeLedgerEntry(tx, { ...base, entryType: "dispute_lost", eventIdentity: "distinct-retry" })).id).toBe(terminal.id);
        expect(await commissionLedgerPayableState(tx, f.vendor.id, commission.id)).toMatchObject({ balanceCents: 0, hasOpenDispute: false, payableCents: 0 });
      }
      expect(balances.sort()).toEqual([0, 1]);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(await db.affiliateCommissionLedgerEntry.count({ where: { vendorId: f.vendor.id, entryType: "dispute_lost" } })).toBe(2);
  });
  it.each([["active", 899], ["active", 0], ["absent", 899], ["absent", 0]] as const)("preserves paid gross commissions for %s policy with net %i", async (mode, net) => {
    const f = await fixture();
    await db.affiliate.update({ where: { id: f.affiliate.id }, data: { commissionRateBps: 10000 } });
    if (mode === "active") await publishMerchantAffiliatePolicy(db, f.actor, { terms: { ...terms, tiers: [{ minQuantity: 1, maxQuantity: null, rateBps: 10000 }] }, expectedRevision: 0 });
    const payment = await checkout(f);
    await db.paymentTransaction.update({ where: { id: payment.id }, data: { netAmountCents: net } });
    const first = await accrue(f, payment.id), retry = await accrue(f, payment.id);
    expect(first!.commissions[0]).toMatchObject({ commissionAmountCents: 900, commissionBaseAmountCents: 900, netReferenceAmountCents: net });
    expect(retry!.calculation.id).toBe(first!.calculation.id);
    expect((await db.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("paid");
    expect(await db.affiliateCommissionLedgerEntry.count({ where: { vendorId: f.vendor.id } })).toBe(1);
  });
  it.each(["absent", "paused"])("freezes prospective fixed-rate identity and amount when policy is %s", async mode => {
    const f = await fixture();
    await db.affiliate.update({ where: { id: f.affiliate.id }, data: { commissionRateBps: 1000 } });
    if (mode === "paused") {
      await publishMerchantAffiliatePolicy(db, f.actor, { terms, expectedRevision: 0 });
      await pauseMerchantAffiliatePolicy(db, f.actor, 1);
    }
    const payment = await checkout(f);
    await db.affiliate.update({ where: { id: f.affiliate.id }, data: { code: randomUUID(), commissionRateBps: 9000, isActive: false } });
    const other = await db.affiliate.create({ data: { vendorId: f.vendor.id, name: "Synthetic code reuse", code: f.affiliate.code, commissionRateBps: 5000 } });
    const result = await accrue(f, payment.id);
    expect(result!.commissions).toHaveLength(1);
    expect(result!.commissions[0]).toMatchObject({ affiliateId: f.affiliate.id, commissionAmountCents: 90, commissionRateBps: 1000 });
    expect(await db.affiliateCommission.count({ where: { affiliateId: other.id } })).toBe(0);
  });
  it("holds locked payouts through partial refund and terminal release/loss, including zero outcomes", async () => {
    const f = await fixture();
    await publishMerchantAffiliatePolicy(db, f.actor, { terms, expectedRevision: 0 });
    const payment = await checkout(f), result = await accrue(f, payment.id), commission = result!.commissions[0]!;
    await db.affiliateCommission.update({ where: { id: commission.id }, data: { status: "locked" } });
    const payout = await db.affiliatePayout.create({ data: { vendorId: f.vendor.id, affiliateId: f.affiliate.id, monthKey: commission.monthKey, commissionAmountCents: 90, finalAmountCents: 90, status: "pending" } });
    const base = { vendorId: f.vendor.id, affiliateCommissionId: commission.id, providerName: "demo", disputeCaseId: randomUUID(), occurredAt: new Date() };
    await db.$transaction(async tx => {
      await appendDisputeLedgerEntry(tx, { ...base, entryType: "dispute_opened", eventIdentity: "opened" });
      await reconcileAffiliatePendingPayout(tx, { vendorId: f.vendor.id, affiliateId: f.affiliate.id, monthKey: commission.monthKey });
      expect(await commissionLedgerPayableState(tx, f.vendor.id, commission.id)).toMatchObject({ balanceCents: 90, payableCents: 0, heldCents: 90, hasOpenDispute: true });
    });
    expect(await db.affiliatePayout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({ heldAmountCents: 90, commissionAmountCents: 90 });
    await db.$transaction(async tx => {
      const record = await tx.refundRecord.create({ data: { vendorId: f.vendor.id, paymentTransactionId: payment.id, monthKey: commission.monthKey, refundAmountCents: 450, status: "processed" } });
      await applyPaymentRefundAccounting(tx, { vendorId: f.vendor.id, transactionId: payment.id, orderNumber: payment.orderNumber, providerName: "demo", eventIdentity: "partial", refundRecordId: record.id, refundAmountCents: 450, netReferenceAmountCents: 450, isFullRefund: false, transactionOccurredAt: new Date(), occurredAt: new Date() });
    });
    expect(await db.affiliatePayout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({ commissionAmountCents: 45, finalAmountCents: 45, heldAmountCents: 45 });
    await db.$transaction(async tx => {
      await appendDisputeLedgerEntry(tx, { ...base, entryType: "dispute_released", eventIdentity: "released" });
      await reconcileAffiliatePendingPayout(tx, { vendorId: f.vendor.id, affiliateId: f.affiliate.id, monthKey: commission.monthKey });
    });
    expect(await db.affiliatePayout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({ commissionAmountCents: 45, finalAmountCents: 45, heldAmountCents: 0 });
    const next = { ...base, disputeCaseId: randomUUID() };
    await db.$transaction(async tx => {
      await appendDisputeLedgerEntry(tx, { ...next, entryType: "dispute_opened", eventIdentity: "next-opened" });
      await appendDisputeLedgerEntry(tx, { ...next, entryType: "dispute_lost", eventIdentity: "next-lost" });
      await reconcileAffiliatePendingPayout(tx, { vendorId: f.vendor.id, affiliateId: f.affiliate.id, monthKey: commission.monthKey });
    });
    expect(await db.affiliatePayout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({ commissionAmountCents: 0, finalAmountCents: 0, heldAmountCents: 0 });
    await db.$transaction(async tx => {
      const zero = { ...base, disputeCaseId: randomUUID() };
      await appendDisputeLedgerEntry(tx, { ...zero, entryType: "dispute_opened", eventIdentity: "zero-opened" });
      const terminal = await appendDisputeLedgerEntry(tx, { ...zero, entryType: "dispute_lost", eventIdentity: "zero-lost" });
      expect(terminal.amountCents).toBe(0);
      expect((await appendDisputeLedgerEntry(tx, { ...zero, entryType: "dispute_lost", eventIdentity: "zero-lost-retry-distinct-event" })).id).toBe(terminal.id);
      expect(await commissionLedgerPayableState(tx, f.vendor.id, commission.id)).toMatchObject({ hasOpenDispute: false, payableCents: 0 });
    });
  });
});
