import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  requireVendor: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ payoutBatch: { findMany: mocks.findMany } }),
}));

import BillingPayoutsPage from "./page";

const currentVendor = { id: "vendor-current" };
const batch = {
  id: "batch-1",
  batchNumber: "PAYOUT-2026-07",
  batchDate: new Date("2026-07-01T00:00:00.000Z"),
  totalCount: 2,
  totalAmountCents: 30000,
  status: "reviewing",
  items: [
    {
      id: "payout-current",
      vendorId: "vendor-current",
      bankCode: "812",
      bankAccountNumber: "1234567890",
      bankAccountName: "目前商家",
      payoutAmountCents: 10000,
      status: "pending",
      failReason: null,
      createdAt: new Date("2026-07-02T00:00:00.000Z"),
      vendor: { name: "目前商家" },
    },
    {
      id: "payout-other",
      vendorId: "vendor-other",
      bankCode: "999",
      bankAccountNumber: "0987654321",
      bankAccountName: "其他商家戶名",
      payoutAmountCents: 20000,
      status: "paid",
      failReason: "其他商家結算失敗",
      createdAt: new Date("2026-07-03T00:00:00.000Z"),
      vendor: { name: "其他商家" },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue(currentVendor);
  mocks.findMany.mockImplementation(async (query) => {
    const vendorId = query.include.items.where.vendorId;
    return query.where.items.some.vendorId === vendorId
      ? [{ ...batch, items: batch.items.filter((item) => item.vendorId === vendorId) }]
      : [];
  });
});

describe("/billing/payouts route", () => {
  it("authenticates the current vendor and scopes payout batches and items to it", async () => {
    await BillingPayoutsPage();

    expect(mocks.requireVendor).toHaveBeenCalledOnce();
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { items: { some: { vendorId: currentVendor.id } } },
      orderBy: { batchDate: "desc" },
      include: {
        items: {
          where: { vendorId: currentVendor.id },
          include: { vendor: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  });

  it("does not render another vendor's payout data from a shared batch", async () => {
    const html = renderToStaticMarkup(await BillingPayoutsPage());

    expect(html).toContain("目前商家");
    expect(html).toContain("812");
    expect(html).toContain("1234567890");
    expect(html).toContain("$100");
    expect(html).toContain("1 筆");
    expect(html).not.toContain("其他商家");
    expect(html).not.toContain("999");
    expect(html).not.toContain("0987654321");
    expect(html).not.toContain("$300");
    expect(html).not.toContain("其他商家結算失敗");
  });
});
