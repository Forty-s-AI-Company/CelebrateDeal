import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorFinance: vi.fn(),
  settlementFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ settlement: { findMany: mocks.settlementFindMany } }),
}));

import BillingSettlementsPage from "./page";

const currentVendor = { id: "vendor-current", name: "目前商家" };
const settlement = {
  id: "settlement-1",
  vendorId: currentVendor.id,
  monthKey: "2026-07",
  status: "locked",
  grossRevenueCents: 250000,
  monthlyFeeCents: 10000,
  overflowFeeCents: 2000,
  paymentServiceFeeCents: 1500,
  transactionServiceFeeCents: 1000,
  affiliateManagementFeeCents: 500,
  paymentGatewayFeeCents: 750,
  adjustmentAmountCents: -250,
  finalPayoutAmountCents: 234250,
  lockedAt: new Date("2026-08-01T00:00:00.000Z"),
  batchNumber: "PAYOUT-2026-07",
  payoutDate: new Date("2026-08-05T00:00:00.000Z"),
  payoutBatch: { batchNumber: "PAYOUT-2026-07", status: "exported" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorFinance.mockResolvedValue({ vendor: currentVendor });
  mocks.settlementFindMany.mockResolvedValue([settlement]);
});

describe("/billing/settlements route", () => {
  it("loads only the current vendor settlements and renders the financial summary", async () => {
    const html = renderToStaticMarkup(await BillingSettlementsPage());

    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith("/billing/settlements");
    expect(mocks.settlementFindMany).toHaveBeenCalledWith({
      where: { vendorId: currentVendor.id },
      orderBy: [{ monthKey: "desc" }],
      include: { payoutBatch: true },
    });
    expect(html).toContain("本期成交額");
    expect(html).toContain("平台費用");
    expect(html).toContain("預計撥款");
    expect(html).toContain("2026-07 月結");
    expect(html).toContain("PAYOUT-2026-07");
    expect(html).toContain("已鎖單");
    expect(html).toContain("已連結出款批次");
    expect(html).toContain("$2,343");
  });

  it("renders an explicit empty state when no settlement exists", async () => {
    mocks.settlementFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await BillingSettlementsPage());

    expect(html).toContain("尚無月結資料");
    expect(html).toContain("月結批次建立後");
    expect(html).not.toContain("本期成交額");
    expect(html).not.toContain("PAYOUT-2026-07");
  });
});
