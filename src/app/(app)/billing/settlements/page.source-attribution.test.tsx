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

const vendor = { id: "vendor-current", name: "目前商家" };
const settlement = (id: string, status: string, overrides: Record<string, unknown> = {}) => ({
  id,
  vendorId: vendor.id,
  monthKey: "2026-07",
  status,
  grossRevenueCents: 250000,
  monthlyFeeCents: 10000,
  overflowFeeCents: 2000,
  paymentServiceFeeCents: 1500,
  transactionServiceFeeCents: 1000,
  affiliateManagementFeeCents: 500,
  paymentGatewayFeeCents: 750,
  adjustmentAmountCents: -250,
  finalPayoutAmountCents: 234250,
  lockedAt: null,
  batchNumber: null,
  payoutDate: null,
  payoutBatch: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorFinance.mockResolvedValue({ vendor });
  mocks.settlementFindMany.mockResolvedValue([
    settlement("paid", "paid", {
      lockedAt: new Date("2026-08-01T00:00:00.000Z"),
      batchNumber: "PAYOUT-2026-07",
      payoutDate: new Date("2026-08-05T00:00:00.000Z"),
      payoutBatch: { batchNumber: "PAYOUT-2026-07", status: "exported" },
    }),
    settlement("reviewing", "reviewing"),
    settlement("draft", "draft"),
    settlement("ready", "ready_for_payout"),
  ]);
});

describe("merchant settlement source attribution", () => {
  it("renders all settlement states, reconciliation metrics, and payout batch details", async () => {
    const html = renderToStaticMarkup(await BillingSettlementsPage());

    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith("/billing/settlements");
    expect(html).toContain("本期成交額");
    expect(html).toContain("平台費用");
    expect(html).toContain("金流手續費");
    expect(html).toContain("預計撥款");
    expect(html).toContain("paid");
    expect(html).toContain("reviewing");
    expect(html).toContain("draft");
    expect(html).toContain("ready_for_payout");
    expect(html).toContain("聯盟管理費");
    expect(html).toContain("調整金額");
    expect(html).toContain("已連結出款批次");
    expect(html).toContain("PAYOUT-2026-07");
    expect(html).toContain("exported");
  });
});
