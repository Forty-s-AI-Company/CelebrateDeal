import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(),
  payoutFindMany: vi.fn(),
  createPlatformReferralPayoutBatchAction: vi.fn(),
  recordPlatformReferralPayoutOutcomeAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ platformReferralPayout: { findMany: mocks.payoutFindMany } }),
}));
vi.mock("@/app/actions/platform-referral-payout-actions", () => ({
  createPlatformReferralPayoutBatchAction: mocks.createPlatformReferralPayoutBatchAction,
  recordPlatformReferralPayoutOutcomeAction: mocks.recordPlatformReferralPayoutOutcomeAction,
}));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));

import AdminPlatformReferralPayoutsPage from "./page";

const owner = { id: "owner-1", name: "推薦人", email: "owner@example.test" };
const payout = (id: string, status: string, overrides: Record<string, unknown> = {}) => ({
  id,
  monthKey: "2026-07",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  owner,
  status,
  commissionAmountCents: 3000,
  adjustmentAmountCents: 0,
  finalAmountCents: 3000,
  outcomeReference: null,
  outcomeReason: null,
  payoutBatch: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-admin" } });
  mocks.payoutFindMany.mockResolvedValue([
    payout("ref-pending", "pending"),
    payout("ref-batched", "batched", { payoutBatch: { batchNumber: "PRP-202607-001" } }),
    payout("ref-paid", "paid", { outcomeReference: "transfer-ref-1" }),
    payout("ref-void", "void", { outcomeReason: "owner verification failed" }),
  ]);
});

describe("platform referral payout page source attribution", () => {
  it("renders batch creation, open totals, owner identity, and status-specific outcomes", async () => {
    const html = renderToStaticMarkup(await AdminPlatformReferralPayoutsPage({
      searchParams: Promise.resolve({}),
    }));

    expect(mocks.requireFinanceAdmin).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.payoutFindMany).toHaveBeenCalledWith({
      orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
      include: { owner: true, payoutBatch: true },
    });
    expect(html).toContain("Platform referral payable");
    expect(html).toContain("待處理筆數");
    expect(html).toContain("$60");
    expect(html).toContain("推薦人");
    expect(html).toContain("owner@example.test");
    expect(html).toContain("PRP-202607-001");
    expect(html).toContain("transfer-ref-1");
    expect(html).toContain("owner verification failed");
    expect(html).toContain("建立 batch");
    expect(html).toContain("記錄 paid");
    expect(html).toContain("記錄 void");
    expect(html).toContain('name="monthKey"');
    expect(html).toContain('name="batchNumber"');
    expect(html.match(/aria-busy="false"/gu) ?? []).toHaveLength(4);
    expect(html.match(/aria-disabled="false"/gu) ?? []).toHaveLength(4);
  });

  it("renders a safe error and explicit empty state", async () => {
    mocks.payoutFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await AdminPlatformReferralPayoutsPage({
      searchParams: Promise.resolve({ error: "raw-provider-error" }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("平台推薦 payout 操作未完成");
    expect(html).not.toContain("raw-provider-error");
    expect(html).toContain("尚無 platform referral payable");
    expect(html).toContain("建立 batch");
    expect(html).not.toContain("記錄 paid");
  });
});
