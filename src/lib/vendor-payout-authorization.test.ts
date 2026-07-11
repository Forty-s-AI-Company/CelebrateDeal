import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, requireVendor } = vi.hoisted(() => ({
  findMany: vi.fn(),
  requireVendor: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendor }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ payoutBatch: { findMany } }),
}));

import BillingPayoutsPage from "@/app/(app)/billing/payouts/page";

describe("vendor payout authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireVendor.mockResolvedValue({ id: "vendor-a", name: "Vendor A" });
    findMany.mockResolvedValue([]);
  });

  it("scopes both payout batches and included bank items to the current vendor", async () => {
    await BillingPayoutsPage();

    expect(requireVendor).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith({
      where: { items: { some: { vendorId: "vendor-a" } } },
      orderBy: { batchDate: "desc" },
      select: {
        id: true,
        batchNumber: true,
        batchDate: true,
        status: true,
        items: {
          where: { vendorId: "vendor-a" },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            bankAccountName: true,
            bankCode: true,
            bankAccountNumber: true,
            payoutAmountCents: true,
            status: true,
            failReason: true,
          },
        },
      },
    });
  });
});
