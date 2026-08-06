import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(),
  payoutBatchFindMany: vi.fn(),
  markPayoutBatchExportedAction: vi.fn(),
  updatePayoutItemStatusAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ payoutBatch: { findMany: mocks.payoutBatchFindMany } }),
}));
vi.mock("@/app/actions", () => ({
  markPayoutBatchExportedAction: mocks.markPayoutBatchExportedAction,
  updatePayoutItemStatusAction: mocks.updatePayoutItemStatusAction,
}));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));

import AdminBillingPayoutsPage from "./page";

const batch = {
  id: "batch-1",
  batchNumber: "PAYOUT-2026-07",
  batchDate: new Date("2026-07-01T00:00:00.000Z"),
  totalCount: 2,
  totalAmountCents: 30000,
  status: "draft",
  exportedAt: null,
  items: [
    {
      id: "item-pending",
      bankAccountDisplayName: "收款戶名",
      bankCodeDisplay: "812",
      bankAccountDisplayNumber: "1234567890",
      payoutAmountCents: 10000,
      status: "pending",
      retryCount: 0,
      failReason: null,
      createdAt: new Date("2026-07-02T00:00:00.000Z"),
      vendor: { name: "目前商家" },
      settlement: { monthKey: "2026-07" },
    },
    {
      id: "item-failed",
      bankAccountDisplayName: "失敗戶名",
      bankCodeDisplay: "013",
      bankAccountDisplayNumber: "9876543210",
      payoutAmountCents: 20000,
      status: "failed",
      retryCount: 2,
      failReason: "銀行拒絕",
      createdAt: new Date("2026-07-03T00:00:00.000Z"),
      vendor: { name: "另一商家" },
      settlement: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-admin" } });
  mocks.payoutBatchFindMany.mockResolvedValue([batch]);
});

describe("/admin/billing/payouts route", () => {
  it("authenticates finance staff and renders masked payout actions for each status", async () => {
    const html = renderToStaticMarkup(await AdminBillingPayoutsPage({
      searchParams: Promise.resolve({}),
    }));

    expect(mocks.requireFinanceAdmin).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.payoutBatchFindMany).toHaveBeenCalledWith({
      orderBy: { batchDate: "desc" },
      include: {
        items: {
          include: { vendor: true, settlement: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    expect(html).toContain("標記已匯出");
    expect(html).toContain("標記 paid");
    expect(html).toContain("標記 failed");
    expect(html).toContain("標記 retry");
    expect(html).toContain("****3210");
    expect(html).not.toContain("1234567890");
    expect(html).not.toContain("收款戶名");
    expect(html).toContain("重送 2 次");
    expect(html).toContain("銀行拒絕");
  });

  it("renders the safe error message and empty state without reflecting raw input", async () => {
    mocks.payoutBatchFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await AdminBillingPayoutsPage({
      searchParams: Promise.resolve({ error: "raw-provider-error" }),
    }));

    expect(html).toContain("出款狀態更新未執行");
    expect(html).not.toContain("raw-provider-error");
    expect(html).toContain("尚無出款批次");
    expect(html).not.toContain("標記已匯出");
  });
});
