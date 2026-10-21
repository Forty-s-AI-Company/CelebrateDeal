import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendCommissionLedgerEntry } from "@/lib/affiliate-commission-accounting";
import { generateSettlementForVendor } from "@/lib/billing-cycle";
import { getDb } from "@/lib/db";
import { applyPaymentRefundAccounting } from "@/lib/payment-refund-accounting";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { submitSettlementAdjustment } from "@/lib/settlement-adjustment";
import {
  assertSettlementInputsUnchanged,
  nextSettlementMonthKey,
  refundSettlementMonthKey,
  settlementMonthKeyOf,
} from "@/lib/settlement-period";

const db = getDb();
const vendorIds: string[] = [];
const planIds: string[] = [];
const admin = { id: "synthetic-admin", label: "platform_admin" };

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "settlement-carry-forward-test-secret-longer-than-32-bytes");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  const ids = vendorIds.splice(0);
  const plans = planIds.splice(0);
  // Append-only commission ledger rows intentionally block vendor deletion;
  // the disposable database keeps those synthetic fixtures (same as payment-webhooks.test.ts).
  try {
    await db.vendor.deleteMany({ where: { id: { in: ids } } });
  } catch (error) {
    if (!(error instanceof Error) || !/append-only|foreign key constraint|RESTRICT setting/i.test(error.message)) throw error;
    await db.billingPlan.updateMany({ where: { id: { in: plans } }, data: { isActive: false } });
    return;
  }
  await db.billingPlan.deleteMany({ where: { id: { in: plans } } });
});

async function vendorWithPlatformPlan() {
  const suffix = randomUUID();
  const plan = await db.billingPlan.create({
    data: { name: `Carry ${suffix}`, code: `carry-${suffix}`, monthlyPriceCents: 0, transactionFeeRateBps: 0 },
  });
  planIds.push(plan.id);
  const vendor = await db.vendor.create({
    data: {
      name: "Carry Forward",
      slug: `carry-forward-${suffix}`,
      email: `${suffix}@example.test`,
      passwordHash: "synthetic-only",
      subscriptions: {
        create: { planId: plan.id, paymentMode: "platform", status: "active", startedAt: new Date("2026-01-01T00:00:00.000Z") },
      },
    },
  });
  vendorIds.push(vendor.id);
  return vendor;
}

async function buyerPayment(vendorId: string, grossAmountCents: number, occurredAt: Date, status = "paid") {
  return db.paymentTransaction.create({
    data: {
      vendorId,
      purpose: "buyer_order",
      providerName: "payuni",
      orderNumber: `CARRY-${randomUUID()}`,
      paymentMode: "platform",
      grossAmountCents,
      netAmountCents: grossAmountCents,
      currency: "TWD",
      status,
      occurredAt,
    },
  });
}

async function processedRefund(vendorId: string, paymentTransactionId: string, monthKey: string, refundAmountCents: number) {
  return db.refundRecord.create({
    data: { vendorId, paymentTransactionId, monthKey, refundAmountCents, status: "processed" },
  });
}

async function lockMonth(vendorId: string, monthKey: string) {
  return db.settlement.upsert({
    where: { vendorId_monthKey: { vendorId, monthKey } },
    create: { vendorId, monthKey, status: "locked", lockedAt: new Date(), lockedBy: admin.id },
    update: { status: "locked", lockedAt: new Date(), lockedBy: admin.id },
  });
}

describe("F-039 refund settlement month comes from the server", () => {
  it("books into the completion month and moves past locked months", async () => {
    const vendor = await vendorWithPlatformPlan();
    const completedAt = new Date("2026-09-30T23:59:59.000Z");

    await expect(refundSettlementMonthKey(db, vendor.id, completedAt)).resolves.toBe("2026-09");
    await lockMonth(vendor.id, "2026-09");
    await lockMonth(vendor.id, "2026-10");
    await expect(refundSettlementMonthKey(db, vendor.id, completedAt)).resolves.toBe("2026-11");
    expect(nextSettlementMonthKey("2026-12")).toBe("2027-01");
  });

  it("ignores the provider event time and skips the locked current month for a webhook refund", async () => {
    const vendor = await vendorWithPlatformPlan();
    const orderNumber = `CARRY-WEBHOOK-${randomUUID()}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id, purpose: "buyer_order", providerName: "demo", orderNumber, paymentMode: "platform",
        grossAmountCents: 30_000, netAmountCents: 30_000, currency: "TWD", status: "pending",
      },
    });
    const soldAt = new Date("2026-03-10T02:00:00.000Z");
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo", eventId: `paid-${orderNumber}`, eventType: "paid", vendorSlug: vendor.slug, orderNumber,
      grossAmountCents: 30_000, occurredAt: soldAt.toISOString(),
    }));
    const currentMonthKey = settlementMonthKeyOf(new Date());
    await lockMonth(vendor.id, currentMonthKey);

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo", eventId: `refund-${orderNumber}`, eventType: "partially_refunded", vendorSlug: vendor.slug, orderNumber,
      refundAmountCents: 12_000, occurredAt: soldAt.toISOString(),
    }));

    const refund = await db.refundRecord.findFirstOrThrow({ where: { vendorId: vendor.id } });
    expect(refund.monthKey).toBe(nextSettlementMonthKey(currentMonthKey));
  });
});

describe("F-039 negative settlement balance carries forward (D-32)", () => {
  it("carries a refund above revenue into the next month to the exact cent instead of truncating it", async () => {
    const vendor = await vendorWithPlatformPlan();
    const august = await buyerPayment(vendor.id, 30_000, new Date("2026-08-20T00:00:00.000Z"), "partially_refunded");
    await buyerPayment(vendor.id, 10_000, new Date("2026-09-05T00:00:00.000Z"));
    await processedRefund(vendor.id, august.id, "2026-09", 25_000);

    const september = await generateSettlementForVendor(vendor.id, "2026-09");

    expect(september.settlement).toMatchObject({
      grossRevenueCents: -15_000,
      refundAmountCents: 25_000,
      payoutableAmountCents: -15_000,
      finalPayoutAmountCents: 0,
      carriedOutCents: -15_000,
    });
    await expect(db.settlementAdjustmentLedgerEntry.findMany({ where: { vendorId: vendor.id } })).resolves.toEqual([
      expect.objectContaining({ kind: "negative_balance_carry_forward", sourceMonthKey: "2026-09", targetMonthKey: "2026-10", amountCents: -15_000 }),
    ]);

    await buyerPayment(vendor.id, 40_000, new Date("2026-10-03T00:00:00.000Z"));
    const october = await generateSettlementForVendor(vendor.id, "2026-10");

    expect(october.settlement).toMatchObject({
      grossRevenueCents: 40_000,
      carriedInCents: -15_000,
      payoutableAmountCents: 25_000,
      finalPayoutAmountCents: 25_000,
      carriedOutCents: 0,
    });
  });

  it("returns refunded fees from an earlier month to the exact cent instead of truncating them (review M-2)", async () => {
    const vendor = await vendorWithPlatformPlan();
    const august = await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id, purpose: "buyer_order", providerName: "payuni", orderNumber: `CARRY-${randomUUID()}`,
        paymentMode: "platform", grossAmountCents: 10_000, gatewayFeeCents: 280, platformFeeCents: 500,
        netAmountCents: 9_220, currency: "TWD", status: "refunded", occurredAt: new Date("2026-08-20T00:00:00.000Z"),
      },
    });
    await db.refundRecord.create({
      data: {
        vendorId: vendor.id, paymentTransactionId: august.id, monthKey: "2026-09", refundAmountCents: 10_000,
        gatewayFeeRefundCents: 280, platformFeeRefundCents: 500, status: "processed",
      },
    });

    const september = await generateSettlementForVendor(vendor.id, "2026-09");

    expect(september.settlement).toMatchObject({
      grossRevenueCents: -10_000,
      paymentGatewayFeeCents: 0,
      transactionServiceFeeCents: 0,
      payoutableAmountCents: -9_220,
      finalPayoutAmountCents: 0,
      carriedOutCents: -9_220,
    });
  });

  it("follows a regenerated source month and requires the target month to be regenerated before locking", async () => {
    const vendor = await vendorWithPlatformPlan();
    const august = await buyerPayment(vendor.id, 30_000, new Date("2026-08-20T00:00:00.000Z"), "partially_refunded");
    await processedRefund(vendor.id, august.id, "2026-09", 8_000);
    await generateSettlementForVendor(vendor.id, "2026-09");
    const october = await generateSettlementForVendor(vendor.id, "2026-10");
    expect(october.settlement).toMatchObject({ carriedInCents: -8_000, finalPayoutAmountCents: 0, carriedOutCents: -8_000 });
    await expect(assertSettlementInputsUnchanged(db, october.settlement)).resolves.toBeUndefined();

    // A late September sale removes September's shortfall.
    await buyerPayment(vendor.id, 20_000, new Date("2026-09-28T00:00:00.000Z"));
    const september = await generateSettlementForVendor(vendor.id, "2026-09");
    expect(september.settlement).toMatchObject({ finalPayoutAmountCents: 12_000, carriedOutCents: 0 });
    await expect(assertSettlementInputsUnchanged(db, october.settlement)).rejects.toMatchObject({ code: "stale_settlement" });

    const regenerated = await generateSettlementForVendor(vendor.id, "2026-10");
    expect(regenerated.settlement).toMatchObject({ carriedInCents: 0, finalPayoutAmountCents: 0, carriedOutCents: 0 });
    await expect(db.settlementAdjustmentLedgerEntry.findMany({ where: { vendorId: vendor.id }, orderBy: { sourceMonthKey: "asc" } }))
      .resolves.toEqual([
        expect.objectContaining({ sourceMonthKey: "2026-09", amountCents: 0 }),
        expect.objectContaining({ sourceMonthKey: "2026-10", amountCents: 0 }),
      ]);
  });

  it("detects a refund booked after the calculation as a stale lock input", async () => {
    const vendor = await vendorWithPlatformPlan();
    const payment = await buyerPayment(vendor.id, 30_000, new Date("2026-09-02T00:00:00.000Z"), "partially_refunded");
    const { settlement } = await generateSettlementForVendor(vendor.id, "2026-09");
    await expect(assertSettlementInputsUnchanged(db, settlement)).resolves.toBeUndefined();

    await processedRefund(vendor.id, payment.id, "2026-09", 1_000);

    await expect(assertSettlementInputsUnchanged(db, settlement)).rejects.toMatchObject({ code: "stale_settlement" });
  });

  it("never changes a carry that a locked month already deducted", async () => {
    const vendor = await vendorWithPlatformPlan();
    const august = await buyerPayment(vendor.id, 30_000, new Date("2026-08-20T00:00:00.000Z"), "partially_refunded");
    await processedRefund(vendor.id, august.id, "2026-09", 5_000);
    await generateSettlementForVendor(vendor.id, "2026-09");
    await lockMonth(vendor.id, "2026-10");
    await buyerPayment(vendor.id, 1_000, new Date("2026-09-28T00:00:00.000Z"));

    await expect(generateSettlementForVendor(vendor.id, "2026-09")).rejects.toMatchObject({ code: "carry_forward_target_locked" });
    await expect(db.settlementAdjustmentLedgerEntry.findFirstOrThrow({ where: { vendorId: vendor.id } }))
      .resolves.toMatchObject({ targetMonthKey: "2026-10", amountCents: -5_000 });
  });

  it("lets a positive manual adjustment reduce the carry but refuses a negative one below zero", async () => {
    const vendor = await vendorWithPlatformPlan();
    const august = await buyerPayment(vendor.id, 30_000, new Date("2026-08-20T00:00:00.000Z"), "partially_refunded");
    await processedRefund(vendor.id, august.id, "2026-09", 15_000);
    const { settlement } = await generateSettlementForVendor(vendor.id, "2026-09");

    await expect(submitSettlementAdjustment(db, { settlementId: settlement.id, amountCents: -100, reason: "recover", actor: admin }))
      .rejects.toMatchObject({ code: "negative_payout" });
    await expect(submitSettlementAdjustment(db, { settlementId: settlement.id, amountCents: 5_000, reason: "absorb part", actor: admin }))
      .resolves.toMatchObject({ outcome: "applied", settlement: { finalPayoutAmountCents: 0, carriedOutCents: -10_000 } });
    await expect(db.settlementAdjustmentLedgerEntry.findFirstOrThrow({ where: { vendorId: vendor.id } }))
      .resolves.toMatchObject({ amountCents: -10_000 });
    await expect(submitSettlementAdjustment(db, { settlementId: settlement.id, amountCents: 20_000, reason: "absorb all", actor: admin }))
      .resolves.toMatchObject({ outcome: "applied", settlement: { finalPayoutAmountCents: 5_000, carriedOutCents: 0 } });
    await expect(db.settlementAdjustmentLedgerEntry.findFirstOrThrow({ where: { vendorId: vendor.id } }))
      .resolves.toMatchObject({ amountCents: 0 });
  });

  it("settles the commission reversal of a cross-month refund in the refund month when the sale month is locked (review M-1)", async () => {
    const vendor = await vendorWithPlatformPlan();
    const affiliate = await db.affiliate.create({
      data: { vendorId: vendor.id, name: "Carry affiliate", code: `CARRY-${randomUUID()}`.toUpperCase(), commissionRateBps: 1000 },
    });
    const sale = await buyerPayment(vendor.id, 10_000, new Date("2026-09-10T00:00:00.000Z"));
    const commission = await db.affiliateCommission.create({
      data: {
        vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-09", sourceType: "webhook", sourceId: sale.id,
        deduplicationKey: `carry-commission-${sale.id}`, referralCode: affiliate.code, orderNumber: sale.orderNumber,
        orderAmountCents: 10_000, commissionBaseAmountCents: 10_000, netReferenceAmountCents: 10_000,
        commissionRateBps: 1000, commissionAmountCents: 1_000, status: "approved",
      },
    });
    await appendCommissionLedgerEntry(db, {
      vendorId: vendor.id, affiliateCommissionId: commission.id, entryType: "accrual", providerName: "payuni",
      eventIdentity: `paid-${sale.id}`, amountCents: 1_000, occurredAt: sale.occurredAt,
    });

    const september = await generateSettlementForVendor(vendor.id, "2026-09");
    // F-044 / D-31 A: the merchant pays the affiliate; the payout is not reduced.
    expect(september.settlement).toMatchObject({ grossRevenueCents: 10_000, payoutableAmountCents: 10_000, finalPayoutAmountCents: 10_000 });
    await lockMonth(vendor.id, "2026-09");

    // October: the full refund is booked into October; so is its commission reversal.
    const refundedAt = new Date("2026-10-04T00:00:00.000Z");
    const refund = await processedRefund(vendor.id, sale.id, "2026-10", 10_000);
    await db.paymentTransaction.update({ where: { id: sale.id }, data: { status: "refunded", refundedAmountCents: 10_000, refundedAt } });
    await db.$transaction((tx) => applyPaymentRefundAccounting(tx, {
      vendorId: vendor.id, transactionId: sale.id, orderNumber: sale.orderNumber, providerName: "payuni",
      eventIdentity: `refund:${refund.id}`, refundRecordId: refund.id, refundAmountCents: 10_000,
      netReferenceAmountCents: 0, isFullRefund: true, transactionOccurredAt: sale.occurredAt, occurredAt: refundedAt,
      settlementMonthKey: refund.monthKey,
    }));
    await expect(db.affiliateCommissionLedgerEntry.findFirstOrThrow({ where: { affiliateCommissionId: commission.id, entryType: "refund" } }))
      .resolves.toMatchObject({ amountCents: -1_000, settlementMonthKey: "2026-10" });

    const october = await generateSettlementForVendor(vendor.id, "2026-10");

    // -10,000 refunded to the buyer is carried. The -1,000 commission reversal
    // is the merchant's to reclaim from its affiliate (F-044 / D-31 A).
    expect(october.settlement).toMatchObject({
      grossRevenueCents: -10_000,
      refundAmountCents: 10_000,
      payoutableAmountCents: -10_000,
      finalPayoutAmountCents: 0,
      carriedOutCents: -10_000,
    });
  });

  it("nets a sale and its same-month refund reversal to zero commission", async () => {
    const vendor = await vendorWithPlatformPlan();
    const affiliate = await db.affiliate.create({
      data: { vendorId: vendor.id, name: "Same month affiliate", code: `SAME-${randomUUID()}`.toUpperCase(), commissionRateBps: 1000 },
    });
    const sale = await buyerPayment(vendor.id, 10_000, new Date("2026-09-10T00:00:00.000Z"));
    await buyerPayment(vendor.id, 20_000, new Date("2026-09-12T00:00:00.000Z"));
    const commission = await db.affiliateCommission.create({
      data: {
        vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-09", sourceType: "webhook", sourceId: sale.id,
        deduplicationKey: `same-commission-${sale.id}`, referralCode: affiliate.code, orderNumber: sale.orderNumber,
        orderAmountCents: 10_000, commissionBaseAmountCents: 10_000, netReferenceAmountCents: 10_000,
        commissionRateBps: 1000, commissionAmountCents: 1_000, status: "approved",
      },
    });
    await appendCommissionLedgerEntry(db, {
      vendorId: vendor.id, affiliateCommissionId: commission.id, entryType: "accrual", providerName: "payuni",
      eventIdentity: `paid-${sale.id}`, amountCents: 1_000, occurredAt: sale.occurredAt,
    });
    const refund = await processedRefund(vendor.id, sale.id, "2026-09", 10_000);
    await db.paymentTransaction.update({ where: { id: sale.id }, data: { status: "refunded", refundedAmountCents: 10_000 } });
    await db.$transaction((tx) => applyPaymentRefundAccounting(tx, {
      vendorId: vendor.id, transactionId: sale.id, orderNumber: sale.orderNumber, providerName: "payuni",
      eventIdentity: `refund:${refund.id}`, refundRecordId: refund.id, refundAmountCents: 10_000,
      netReferenceAmountCents: 0, isFullRefund: true, transactionOccurredAt: sale.occurredAt, occurredAt: new Date("2026-09-20T00:00:00.000Z"),
      settlementMonthKey: refund.monthKey,
    }));
    await expect(db.affiliateCommission.findUniqueOrThrow({ where: { id: commission.id } })).resolves.toMatchObject({ status: "void" });

    const september = await generateSettlementForVendor(vendor.id, "2026-09");

    expect(september.settlement).toMatchObject({ grossRevenueCents: 20_000, payoutableAmountCents: 20_000, finalPayoutAmountCents: 20_000 });
  });

  it("never turns an earlier negative adjustment into a carry when a regeneration shrinks the payable (review m-1)", async () => {
    const vendor = await vendorWithPlatformPlan();
    const sale = await buyerPayment(vendor.id, 1_000, new Date("2026-09-05T00:00:00.000Z"), "partially_refunded");
    const { settlement } = await generateSettlementForVendor(vendor.id, "2026-09");
    await expect(submitSettlementAdjustment(db, { settlementId: settlement.id, amountCents: -800, reason: "recover", actor: admin }))
      .resolves.toMatchObject({ outcome: "applied", settlement: { finalPayoutAmountCents: 200 } });

    await processedRefund(vendor.id, sale.id, "2026-09", 500);
    const regenerated = await generateSettlementForVendor(vendor.id, "2026-09");

    expect(regenerated.settlement).toMatchObject({ payoutableAmountCents: 500, adjustmentAmountCents: -800, finalPayoutAmountCents: 0, carriedOutCents: 0 });
    await expect(db.settlementAdjustmentLedgerEntry.count({ where: { vendorId: vendor.id } })).resolves.toBe(0);
  });

  it("enforces carry invariants in the database", async () => {
    const vendor = await vendorWithPlatformPlan();
    await expect(db.settlement.create({ data: { vendorId: vendor.id, monthKey: "2026-09", finalPayoutAmountCents: 100, carriedOutCents: -1 } }))
      .rejects.toThrow();
    await expect(db.settlementAdjustmentLedgerEntry.create({
      data: { vendorId: vendor.id, kind: "negative_balance_carry_forward", sourceMonthKey: "2026-09", targetMonthKey: "2026-09", amountCents: -1 },
    })).rejects.toThrow();
    await expect(db.settlementAdjustmentLedgerEntry.create({
      data: { vendorId: vendor.id, kind: "negative_balance_carry_forward", sourceMonthKey: "2026-09", targetMonthKey: "2026-10", amountCents: 1 },
    })).rejects.toThrow();
  });
});
