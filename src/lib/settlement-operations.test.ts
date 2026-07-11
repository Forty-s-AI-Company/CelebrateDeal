import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  generateSettlementRecord,
  lockSettlementRecord,
  updateSettlementAdjustmentRecord,
} from "@/lib/settlement-operations";

const vendorIds: string[] = [];
const planIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await getDb().billingPlan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
});

async function fixture(monthKey: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const plan = await getDb().billingPlan.create({
    data: { name: "Settlement Race Plan", code: `settlement-race-${suffix}`, monthlyPriceCents: 9900 },
  });
  planIds.push(plan.id);
  const vendor = await getDb().vendor.create({
    data: {
      name: "Settlement Race Vendor",
      slug: `settlement-race-${suffix}`,
      email: `settlement-${suffix}@example.test`,
      passwordHash: "test",
      subscriptions: { create: { planId: plan.id, status: "active", startedAt: new Date(`${monthKey}-01T00:00:00.000Z`) } },
    },
  });
  vendorIds.push(vendor.id);
  return vendor;
}

describe("settlement period serialization", () => {
  it("never lets a concurrent regenerate reopen a locked settlement", async () => {
    const vendor = await fixture("2026-07");
    const initial = await generateSettlementRecord(vendor.id, "2026-07");

    await Promise.allSettled([
      generateSettlementRecord(vendor.id, "2026-07"),
      lockSettlementRecord(initial.settlement.id, "reviewer-a"),
    ]);

    const final = await getDb().settlement.findUniqueOrThrow({ where: { id: initial.settlement.id } });
    expect(final.status).toBe("locked");
    expect(final.lockedAt).not.toBeNull();
    await expect(generateSettlementRecord(vendor.id, "2026-07")).rejects.toMatchObject({ code: "locked" });
  });

  it("serializes adjustment against lock and rejects every post-lock write", async () => {
    const vendor = await fixture("2026-08");
    const initial = await generateSettlementRecord(vendor.id, "2026-08");

    await Promise.allSettled([
      updateSettlementAdjustmentRecord({
        id: initial.settlement.id,
        adjustmentAmountCents: 500,
        adjustmentReason: "concurrent adjustment",
        reviewedBy: "reviewer-b",
      }),
      lockSettlementRecord(initial.settlement.id, "reviewer-b"),
    ]);

    const locked = await getDb().settlement.findUniqueOrThrow({ where: { id: initial.settlement.id } });
    expect(locked.status).toBe("locked");
    expect(locked.lockedAt).not.toBeNull();
    await expect(updateSettlementAdjustmentRecord({
      id: initial.settlement.id,
      adjustmentAmountCents: 9999,
      adjustmentReason: "must be rejected",
      reviewedBy: "reviewer-b",
    })).rejects.toMatchObject({ code: "locked" });
    await expect(getDb().settlement.findUniqueOrThrow({ where: { id: initial.settlement.id } })).resolves.toMatchObject({
      status: "locked",
      adjustmentAmountCents: locked.adjustmentAmountCents,
      finalPayoutAmountCents: locked.finalPayoutAmountCents,
    });
  });
});
