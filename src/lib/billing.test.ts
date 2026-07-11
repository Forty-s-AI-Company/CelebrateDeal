import { afterEach, describe, expect, it } from "vitest";
import { calculateSettlement } from "@/lib/billing";
import { getDb } from "@/lib/db";

const vendorIds: string[] = [];
const planIds: string[] = [];

afterEach(async () => {
  const db = getDb();
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await db.billingPlan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
});

describe("settlement payment-mode snapshots", () => {
  it("calculates mixed BYO and platform transactions from each immutable transaction mode", async () => {
    const db = getDb();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const plan = await db.billingPlan.create({
      data: { name: `Mixed Mode ${suffix}`, code: `mixed-mode-${suffix}`, transactionFeeRateBps: 100 },
    });
    planIds.push(plan.id);
    const vendor = await db.vendor.create({
      data: {
        name: "Mixed Mode Vendor",
        slug: `mixed-mode-${suffix}`,
        email: `mixed-mode-${suffix}@example.test`,
        passwordHash: "test",
        subscriptions: {
          create: {
            planId: plan.id,
            paymentMode: "byo",
            status: "active",
            startedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      },
    });
    vendorIds.push(vendor.id);

    const platformTransaction = await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber: `PLATFORM-${suffix}`,
        paymentMode: "platform",
        grossAmountCents: 100000,
        gatewayFeeCents: 2000,
        platformFeeCents: 1000,
        netAmountCents: 97000,
        status: "partially_refunded",
        occurredAt: new Date("2026-07-10T00:00:00.000Z"),
        bookingMonthKey: "2026-07",
      },
    });
    const byoTransaction = await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "external-test",
        orderNumber: `BYO-${suffix}`,
        paymentMode: "byo",
        grossAmountCents: 50000,
        gatewayFeeCents: 999,
        platformFeeCents: 999,
        netAmountCents: 48002,
        status: "partially_refunded",
        occurredAt: new Date("2026-07-11T00:00:00.000Z"),
        bookingMonthKey: "2026-07",
      },
    });
    await db.refundRecord.createMany({
      data: [
        {
          vendorId: vendor.id,
          paymentTransactionId: platformTransaction.id,
          providerEventId: `platform-refund-${suffix}`,
          monthKey: "2026-07",
          refundAmountCents: 20000,
          gatewayFeeRefundCents: 400,
          platformFeeRefundCents: 200,
        },
        {
          vendorId: vendor.id,
          paymentTransactionId: byoTransaction.id,
          providerEventId: `byo-refund-${suffix}`,
          monthKey: "2026-07",
          refundAmountCents: 10000,
          gatewayFeeRefundCents: 100,
          platformFeeRefundCents: 100,
        },
      ],
    });

    const settlement = await calculateSettlement(vendor.id, "2026-07");

    expect(settlement).toMatchObject({
      grossRevenueBeforeRefundCents: 100000,
      refundAmountCents: 20000,
      grossRevenueCents: 80000,
      paymentGatewayFeeCents: 1600,
      transactionServiceFeeCents: 800,
      payoutableAmountCents: 77600,
    });
  });
});
