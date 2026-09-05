import { describe, expect, it, vi } from "vitest";
import { requestAffiliatePayout } from "@/lib/affiliate-portal-payout";

const input = {
  payoutId: "payout-a",
  vendorId: "vendor-a",
  affiliateId: "affiliate-a",
  userId: "user-a",
  bankAccountEncrypted: "v2.test.encrypted",
  requestedAt: new Date("2026-09-05T08:00:00.000Z"),
  ipAddress: null,
  userAgent: "test",
};

function database(payout: unknown, claimed = 1) {
  const tx = {
    affiliatePayout: {
      findFirst: vi.fn().mockResolvedValue(payout),
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-a" }) },
  };
  return { tx, db: { $transaction: vi.fn(async (callback) => callback(tx)) } };
}

describe("affiliate payout request", () => {
  it("claims an eligible payout with tenant scope and an encrypted bank snapshot", async () => {
    const { db, tx } = database({ id: "payout-a", status: "pending", finalAmountCents: 2_000, requestedAt: null });
    await expect(requestAffiliatePayout(db as never, input)).resolves.toBe("requested");
    expect(tx.affiliatePayout.findFirst).toHaveBeenCalledWith({
      where: { id: "payout-a", vendorId: "vendor-a", affiliateId: "affiliate-a" },
    });
    expect(tx.affiliatePayout.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorId: "vendor-a", affiliateId: "affiliate-a", requestedAt: null }),
      data: expect.objectContaining({ requestedBankAccountEncrypted: "v2.test.encrypted" }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it("does not write when a foreign or missing payout is requested", async () => {
    const { db, tx } = database(null);
    await expect(requestAffiliatePayout(db as never, input)).resolves.toBe("ineligible");
    expect(tx.affiliatePayout.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("is idempotent after the same payout was requested", async () => {
    const { db, tx } = database({ id: "payout-a", status: "pending", finalAmountCents: 2_000, requestedAt: input.requestedAt });
    await expect(requestAffiliatePayout(db as never, input)).resolves.toBe("requested");
    expect(tx.affiliatePayout.updateMany).not.toHaveBeenCalled();
  });
});

