import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(),
  settlementFindMany: vi.fn(),
  vendorFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    settlement: { findMany: mocks.settlementFindMany },
    vendor: { findMany: mocks.vendorFindMany },
  }),
}));

import AdminBillingSettlementsPage from "./page";

const vendor = {
  id: "vendor-1",
  name: "示範商家",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  subscriptions: [{ status: "active", plan: { name: "專業方案" } }],
};

const settlement = (overrides: Record<string, unknown> = {}) => ({
  id: "settlement-1",
  vendorId: vendor.id,
  vendor,
  monthKey: "2026-07",
  status: "locked",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  lockedAt: new Date("2026-08-02T00:00:00.000Z"),
  payoutBatchId: null,
  payoutBatch: null,
  monthlyFeeCents: 10000,
  overflowFeeCents: 2000,
  paymentServiceFeeCents: 1500,
  transactionServiceFeeCents: 1000,
  paymentGatewayFeeCents: 750,
  adjustmentAmountCents: -250,
  adjustmentReason: "退款手續費調整",
  finalPayoutAmountCents: 234250,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-admin" } });
  mocks.vendorFindMany.mockResolvedValue([vendor, {
    ...vendor,
    id: "vendor-2",
    name: "未設定方案商家",
    subscriptions: [],
  }]);
  mocks.settlementFindMany.mockResolvedValue([
    settlement(),
    settlement({
      id: "settlement-paid",
      status: "paid",
      payoutBatchId: "batch-1",
      payoutBatch: { batchNumber: "PAYOUT-2026-07" },
      finalPayoutAmountCents: 100000,
    }),
    settlement({ id: "settlement-ready", status: "ready_for_payout", lockedAt: null }),
    settlement({ id: "settlement-reviewing", status: "reviewing", lockedAt: null }),
    settlement({ id: "settlement-failed", status: "failed", lockedAt: null, finalPayoutAmountCents: 0 }),
    settlement({ id: "settlement-draft", status: "draft", lockedAt: null, finalPayoutAmountCents: 0 }),
  ]);
});

describe("admin settlement source attribution", () => {
  it("renders vendor, settlement states, reconciliation amounts, and available actions", async () => {
    const html = renderToStaticMarkup(await AdminBillingSettlementsPage({
      searchParams: Promise.resolve({}),
    }));

    expect(mocks.requireFinanceAdmin).toHaveBeenCalledExactlyOnceWith();
    expect(html).toContain("平台月結管理");
    expect(html).toContain("示範商家 · 2026-07");
    expect(html).toContain("專業方案");
    expect(html).toContain("未設定方案商家");
    expect(html).toContain("待出款月結");
    expect(html).toContain("建立出款");
    expect(html).toContain("鎖定月結");
    expect(html).toContain("PAYOUT-2026-07");
    expect(html).toContain("退款手續費調整");
    expect(html).toContain("paid");
    expect(html).toContain("ready_for_payout");
    expect(html).toContain("reviewing");
    expect(html).toContain("failed");
    expect(html).toContain("draft");
    expect(html).toContain('name="settlementIds"');
    expect(html).toContain('name="adjustmentAmount"');
  });

  it.each([
    ["locked", "這筆月結已鎖定，不能再重新計算或調整。"],
    ["missing", "找不到指定的商家或月結資料。"],
  ])("renders allowlisted feedback for %s", async (error, message) => {
    const html = renderToStaticMarkup(await AdminBillingSettlementsPage({
      searchParams: Promise.resolve({ error }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain(message);
    expect(html).not.toContain("raw-provider-error");
  });
});
