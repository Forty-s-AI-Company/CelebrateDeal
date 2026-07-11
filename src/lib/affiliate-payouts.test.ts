import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  approveAffiliateCommission,
  createAffiliatePayout,
  createManualCommissionAdjustment,
  reverseAffiliateCommission,
  transitionAffiliatePayout,
} from "@/lib/affiliate-payouts";
import { lockSettlementRecord } from "@/lib/settlement-operations";

const vendorIds: string[] = [];
const planIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await getDb().billingPlan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
});

async function fixture() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const plan = await getDb().billingPlan.create({
    data: { name: `Affiliate Payout Plan ${suffix}`, code: `affiliate-payout-${suffix}`, monthlyPriceCents: 0 },
  });
  planIds.push(plan.id);
  const vendor = await getDb().vendor.create({
    data: {
      name: "Affiliate Payout Vendor",
      slug: `affiliate-payout-${suffix}`,
      email: `affiliate-payout-${suffix}@example.test`,
      passwordHash: "test",
      subscriptions: { create: { planId: plan.id, status: "active", paymentMode: "platform" } },
    },
  });
  vendorIds.push(vendor.id);
  const affiliate = await getDb().affiliate.create({
    data: { vendorId: vendor.id, name: "Partner", code: `PAYOUT${suffix}`.toUpperCase(), commissionRateBps: 1000 },
  });
  return { vendor, affiliate };
}

describe("affiliate payout ledger", () => {
  it("creates one payout under concurrency and pays the immutable commission set", async () => {
    const { vendor, affiliate } = await fixture();
    await getDb().affiliateCommission.createMany({
      data: [
        { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-07", sourceType: "payment", sourceId: "tx-a", commissionAmountCents: 3000, status: "locked" },
        { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-07", sourceType: "refund_adjustment", sourceId: "refund-a", commissionAmountCents: -500, status: "locked" },
      ],
    });

    const [first, second] = await Promise.all([
      createAffiliatePayout({ vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-07" }),
      createAffiliatePayout({ vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-07" }),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.finalAmountCents).toBe(2500);
    await expect(getDb().affiliatePayout.count({ where: { vendorId: vendor.id } })).resolves.toBe(1);
    await expect(getDb().affiliateCommission.count({ where: { affiliatePayoutId: first.id } })).resolves.toBe(2);

    await transitionAffiliatePayout(first.id, "approved");
    await transitionAffiliatePayout(first.id, "paid");
    await expect(getDb().affiliateCommission.count({ where: { affiliatePayoutId: first.id, status: "paid" } })).resolves.toBe(2);
    await expect(transitionAffiliatePayout(first.id, "reversed")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("supports approval, append-only manual adjustment, and pre-payment reversal", async () => {
    const { vendor, affiliate } = await fixture();
    const pending = await getDb().affiliateCommission.create({
      data: { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-08", sourceType: "payment", sourceId: "tx-pending", commissionAmountCents: 1200, status: "pending" },
    });
    await expect(approveAffiliateCommission(pending.id)).resolves.toMatchObject({ status: "approved" });
    const adjustment = await createManualCommissionAdjustment({
      affiliateId: affiliate.id,
      monthKey: "2026-08",
      amountCents: -200,
      reason: "客服覆核調整",
    });
    expect(adjustment.sourceType).toBe("manual_adjustment");
    expect(adjustment.status).toBe("approved");

    await getDb().affiliateCommission.updateMany({
      where: { id: { in: [pending.id, adjustment.id] } },
      data: { status: "locked" },
    });
    const payout = await createAffiliatePayout({ vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-08" });
    await transitionAffiliatePayout(payout.id, "reversed");
    await expect(getDb().affiliateCommission.count({ where: { affiliatePayoutId: payout.id, status: "reversed" } })).resolves.toBe(2);
  });

  it("rejects manual adjustments for a locked accounting period", async () => {
    const { vendor, affiliate } = await fixture();
    await getDb().settlement.create({
      data: { vendorId: vendor.id, monthKey: "2026-09", status: "locked", lockedAt: new Date() },
    });
    await expect(createManualCommissionAdjustment({
      affiliateId: affiliate.id,
      monthKey: "2026-09",
      amountCents: 500,
      reason: "不得補登已關帳月份",
    })).rejects.toMatchObject({ code: "closed_period" });
    await expect(getDb().affiliateCommission.count({ where: { vendorId: vendor.id, monthKey: "2026-09" } })).resolves.toBe(0);
  });

  it("rejects cross-tenant affiliate relations at the database boundary", async () => {
    const first = await fixture();
    const second = await fixture();
    await expect(getDb().affiliateCommission.create({
      data: {
        vendorId: first.vendor.id,
        affiliateId: second.affiliate.id,
        monthKey: "2026-10",
        sourceType: "manual_adjustment",
        sourceId: "cross-tenant-test",
        commissionAmountCents: 100,
      },
    })).rejects.toMatchObject({ code: "P2003" });
  });

  it("never lets a manual commission reversal overwrite a concurrent settlement lock", async () => {
    const { vendor, affiliate } = await fixture();
    const settlement = await getDb().settlement.create({ data: { vendorId: vendor.id, monthKey: "2026-11", status: "draft" } });
    const commission = await getDb().affiliateCommission.create({
      data: { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-11", sourceType: "payment", sourceId: "void-lock-race", commissionAmountCents: 1000, status: "pending" },
    });

    await Promise.allSettled([
      reverseAffiliateCommission(commission.id),
      lockSettlementRecord(settlement.id, "reviewer-void-race"),
    ]);

    const final = await getDb().affiliateCommission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(["locked", "reversed"]).toContain(final.status);
    await expect(reverseAffiliateCommission(commission.id)).rejects.toMatchObject({ code: "closed_period" });
  });

  it("serializes commission approval with settlement locking", async () => {
    const { vendor, affiliate } = await fixture();
    const settlement = await getDb().settlement.create({ data: { vendorId: vendor.id, monthKey: "2026-12", status: "draft" } });
    const commission = await getDb().affiliateCommission.create({
      data: { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-12", sourceType: "payment", sourceId: "approve-lock-race", commissionAmountCents: 1200, status: "pending" },
    });

    await Promise.allSettled([
      approveAffiliateCommission(commission.id),
      lockSettlementRecord(settlement.id, "reviewer-approve-race"),
    ]);

    await expect(getDb().affiliateCommission.findUniqueOrThrow({ where: { id: commission.id } })).resolves.toMatchObject({ status: "locked" });
    await expect(approveAffiliateCommission(commission.id)).rejects.toMatchObject({ code: "closed_period" });
  });
});
