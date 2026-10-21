import { randomUUID } from "node:crypto";
import type { PaymentTransactionPurpose } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { calculateSettlement } from "@/lib/billing";
import { generateSettlementForVendor } from "@/lib/billing-cycle";
import { getDb } from "@/lib/db";

const db = getDb();
const vendorIds: string[] = [];
const planIds: string[] = [];
const monthKey = "2026-09";
const inMonth = new Date("2026-09-15T04:00:00.000Z");

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await db.billingPlan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
});

async function vendorWithPlatformPlan() {
  const suffix = randomUUID();
  const plan = await db.billingPlan.create({
    data: { name: `Settlement ${suffix}`, code: `settlement-${suffix}`, monthlyPriceCents: 99_900, transactionFeeRateBps: 100 },
  });
  planIds.push(plan.id);
  const vendor = await db.vendor.create({
    data: {
      name: "Settlement Revenue",
      slug: `settlement-revenue-${suffix}`,
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

async function paidTransaction(vendorId: string, purpose: PaymentTransactionPurpose, grossAmountCents: number, fees: { gatewayFeeCents?: number; platformFeeCents?: number } = {}) {
  return db.paymentTransaction.create({
    data: {
      vendorId,
      purpose,
      providerName: "payuni",
      orderNumber: `SET-${randomUUID()}`,
      paymentMode: "platform",
      grossAmountCents,
      gatewayFeeCents: fees.gatewayFeeCents ?? 0,
      platformFeeCents: fees.platformFeeCents ?? 0,
      netAmountCents: grossAmountCents,
      currency: "TWD",
      status: "paid",
      occurredAt: inMonth,
    },
  });
}

async function processedRefund(vendorId: string, paymentTransactionId: string, refundAmountCents: number, refundMonthKey = monthKey) {
  return db.refundRecord.create({
    data: { vendorId, paymentTransactionId, monthKey: refundMonthKey, refundAmountCents, status: "processed" },
  });
}

describe("F-038 settlement revenue excludes payments the merchant made to the platform", () => {
  it("counts only buyer orders and their refunds, to the exact cent", async () => {
    const vendor = await vendorWithPlatformPlan();
    const buyer = await paidTransaction(vendor.id, "buyer_order", 100_000, { gatewayFeeCents: 2_800, platformFeeCents: 1_000 });
    const plan = await paidTransaction(vendor.id, "platform_subscription", 99_900, { gatewayFeeCents: 2_797 });
    await paidTransaction(vendor.id, "invoice_payment", 50_000, { gatewayFeeCents: 1_400 });
    await processedRefund(vendor.id, buyer.id, 10_000);
    // The platform refunding the merchant's own plan fee is not a buyer refund.
    await processedRefund(vendor.id, plan.id, 99_900);

    const settlement = await calculateSettlement(vendor.id, monthKey);

    expect(settlement).toMatchObject({
      grossRevenueBeforeRefundCents: 100_000,
      refundAmountCents: 10_000,
      grossRevenueCents: 90_000,
      paymentGatewayFeeCents: 2_800,
      transactionServiceFeeCents: 1_000,
      payoutableAmountCents: 86_200,
      finalPayoutAmountCents: 86_200,
    });
  });

  it("pays nothing out of a month that only has platform plan and invoice payments", async () => {
    const vendor = await vendorWithPlatformPlan();
    await paidTransaction(vendor.id, "platform_subscription", 99_900);
    await paidTransaction(vendor.id, "invoice_payment", 120_000);

    const result = await generateSettlementForVendor(vendor.id, monthKey);

    expect(result.settlement).toMatchObject({ grossRevenueCents: 0, payoutableAmountCents: 0, finalPayoutAmountCents: 0 });
  });

  it("refuses to settle a month with an unclassified paid transaction instead of guessing", async () => {
    const vendor = await vendorWithPlatformPlan();
    await paidTransaction(vendor.id, "buyer_order", 30_000);
    await paidTransaction(vendor.id, "unclassified", 40_000);

    await expect(generateSettlementForVendor(vendor.id, monthKey)).rejects.toMatchObject({ code: "unclassified_payment_purpose" });
    await expect(db.settlement.count({ where: { vendorId: vendor.id } })).resolves.toBe(0);
    await expect(db.invoice.count({ where: { vendorId: vendor.id } })).resolves.toBe(0);
  });

  it("refuses a month whose refund belongs to an older unclassified payment instead of excluding it (review M-3)", async () => {
    const vendor = await vendorWithPlatformPlan();
    await paidTransaction(vendor.id, "buyer_order", 30_000);
    const legacy = await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id, purpose: "unclassified", providerName: "payuni", orderNumber: `SET-${randomUUID()}`,
        grossAmountCents: 20_000, netAmountCents: 20_000, currency: "TWD", status: "partially_refunded",
        occurredAt: new Date("2026-06-15T00:00:00.000Z"),
      },
    });
    await processedRefund(vendor.id, legacy.id, 5_000);

    await expect(generateSettlementForVendor(vendor.id, monthKey)).rejects.toMatchObject({ code: "unclassified_payment_purpose" });
    await expect(db.settlement.count({ where: { vendorId: vendor.id } })).resolves.toBe(0);
  });

  it("excludes demo payments and their refunds without blocking the month (review m-3)", async () => {
    const vendor = await vendorWithPlatformPlan();
    await paidTransaction(vendor.id, "buyer_order", 30_000);
    const demo = await paidTransaction(vendor.id, "demo", 40_000);
    await processedRefund(vendor.id, demo.id, 10_000);

    const result = await generateSettlementForVendor(vendor.id, monthKey);

    expect(result.settlement).toMatchObject({ grossRevenueCents: 30_000, refundAmountCents: 0, finalPayoutAmountCents: 30_000 });
  });

  it("defaults a transaction created without a purpose to unclassified", async () => {
    const vendor = await vendorWithPlatformPlan();
    const created = await db.paymentTransaction.create({ data: { vendorId: vendor.id, providerName: "payuni" } });

    expect(created.purpose).toBe("unclassified");
  });
});
