import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { appendCommissionLedgerEntry } from "@/lib/affiliate-commission-accounting";
import { calculateSettlement } from "@/lib/billing";
import { generateSettlementForVendor } from "@/lib/billing-cycle";
import { getDb } from "@/lib/db";

// F-044 / B03-08, owner decision D-31 A: affiliate commissions are paid by the
// merchant, so the monthly settlement never withholds them from the merchant
// payout. Commissions still accrue and are reported.

const db = getDb();
const vendorIds: string[] = [];
const planIds: string[] = [];
const monthKey = "2026-09";
const inMonth = new Date("2026-09-15T04:00:00.000Z");

afterEach(async () => {
  const ids = vendorIds.splice(0);
  const plans = planIds.splice(0);
  // Append-only commission ledger rows intentionally block vendor deletion;
  // the disposable database keeps those synthetic fixtures (same as settlement-carry-forward.db.test.ts).
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
    data: { name: `Commission ${suffix}`, code: `commission-${suffix}`, monthlyPriceCents: 0, transactionFeeRateBps: 0 },
  });
  planIds.push(plan.id);
  const vendor = await db.vendor.create({
    data: {
      name: "Merchant Paid Commission",
      slug: `merchant-paid-commission-${suffix}`,
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

async function buyerPayment(vendorId: string, grossAmountCents: number, fees: { gatewayFeeCents: number; platformFeeCents: number }) {
  return db.paymentTransaction.create({
    data: {
      vendorId,
      purpose: "buyer_order",
      providerName: "payuni",
      orderNumber: `F044-${randomUUID()}`,
      paymentMode: "platform",
      grossAmountCents,
      gatewayFeeCents: fees.gatewayFeeCents,
      platformFeeCents: fees.platformFeeCents,
      netAmountCents: grossAmountCents,
      currency: "TWD",
      status: "paid",
      occurredAt: inMonth,
    },
  });
}

async function accruedCommission(vendorId: string, sale: { id: string; orderNumber: string | null; occurredAt: Date | null }, amountCents: number) {
  const affiliate = await db.affiliate.create({
    data: { vendorId, name: "F-044 affiliate", code: `F044-${randomUUID()}`.toUpperCase(), commissionRateBps: 1000 },
  });
  const commission = await db.affiliateCommission.create({
    data: {
      vendorId, affiliateId: affiliate.id, monthKey, sourceType: "webhook", sourceId: sale.id,
      deduplicationKey: `f044-commission-${sale.id}`, referralCode: affiliate.code, orderNumber: sale.orderNumber ?? "",
      orderAmountCents: amountCents * 10, commissionBaseAmountCents: amountCents * 10, netReferenceAmountCents: amountCents * 10,
      commissionRateBps: 1000, commissionAmountCents: amountCents, status: "approved",
    },
  });
  await appendCommissionLedgerEntry(db, {
    vendorId, affiliateCommissionId: commission.id, entryType: "accrual", providerName: "payuni",
    eventIdentity: `paid-${sale.id}`, amountCents, occurredAt: sale.occurredAt ?? inMonth,
  });
  return commission;
}

describe("F-044 monthly settlement does not withhold merchant-paid affiliate commissions (D-31 A)", () => {
  it("pays revenue minus refunds minus fees even when the month has accrued commissions", async () => {
    const vendor = await vendorWithPlatformPlan();
    const sale = await buyerPayment(vendor.id, 100_000, { gatewayFeeCents: 2_800, platformFeeCents: 1_000 });
    await buyerPayment(vendor.id, 20_000, { gatewayFeeCents: 560, platformFeeCents: 200 });
    await accruedCommission(vendor.id, sale, 10_000);
    await db.refundRecord.create({
      data: { vendorId: vendor.id, paymentTransactionId: sale.id, monthKey, refundAmountCents: 5_000, status: "processed" },
    });

    const calculation = await calculateSettlement(vendor.id, monthKey);
    // 120,000 revenue − 5,000 refund − (2,800 + 560) gateway fee − (1,000 + 200) platform fee.
    const expectedPayout = 120_000 - 5_000 - 3_360 - 1_200;
    expect(calculation).toMatchObject({
      grossRevenueCents: 115_000,
      refundAmountCents: 5_000,
      paymentGatewayFeeCents: 3_360,
      transactionServiceFeeCents: 1_200,
      payoutableAmountCents: expectedPayout,
      finalPayoutAmountCents: expectedPayout,
      // Still accrued and reported, never deducted.
      affiliateCommissionCents: 10_000,
    });

    const { settlement } = await generateSettlementForVendor(vendor.id, monthKey);
    expect(settlement).toMatchObject({ payoutableAmountCents: expectedPayout, finalPayoutAmountCents: expectedPayout });
    await expect(db.affiliateCommissionLedgerEntry.aggregate({ where: { vendorId: vendor.id }, _sum: { amountCents: true } }))
      .resolves.toMatchObject({ _sum: { amountCents: 10_000 } });
  });

  it("does not let another vendor's commission touch this vendor's payout", async () => {
    const vendor = await vendorWithPlatformPlan();
    const other = await vendorWithPlatformPlan();
    await buyerPayment(vendor.id, 30_000, { gatewayFeeCents: 0, platformFeeCents: 0 });
    const otherSale = await buyerPayment(other.id, 30_000, { gatewayFeeCents: 0, platformFeeCents: 0 });
    await accruedCommission(other.id, otherSale, 3_000);

    await expect(calculateSettlement(vendor.id, monthKey)).resolves.toMatchObject({ payoutableAmountCents: 30_000, affiliateCommissionCents: 0 });
    await expect(calculateSettlement(other.id, monthKey)).resolves.toMatchObject({ payoutableAmountCents: 30_000, affiliateCommissionCents: 3_000 });
  });
});
