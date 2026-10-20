import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { readDashboardOrderSummary } from "./dashboard-read-model";

describe("readDashboardOrderSummary", () => {
  it("issues one vendor-scoped groupBy and counts only paid TWD orders", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { status: "paid", currency: "TWD", _count: { _all: 3 }, _sum: { totalAmountCents: 900000 } },
      { status: "paid", currency: "USD", _count: { _all: 1 }, _sum: { totalAmountCents: 5000 } },
      { status: "pending_payment", currency: "TWD", _count: { _all: 5 }, _sum: { totalAmountCents: 400000 } },
      { status: "refunded", currency: "TWD", _count: { _all: 1 }, _sum: { totalAmountCents: 100000 } },
    ]);
    const since = new Date("2026-10-13T00:00:00Z");
    const result = await readDashboardOrderSummary({ commerceOrder: { groupBy } } as unknown as PrismaClient, "vendor-a", since);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy.mock.calls[0]![0].where).toEqual({ vendorId: "vendor-a", createdAt: { gte: since } });
    expect(result).toEqual({ created: 10, paidOrders: 3, paidAmountCents: 900000 });
  });

  it("returns zeros when there are no orders", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    expect(await readDashboardOrderSummary({ commerceOrder: { groupBy } } as unknown as PrismaClient, "v", new Date()))
      .toEqual({ created: 0, paidOrders: 0, paidAmountCents: 0 });
  });
});
