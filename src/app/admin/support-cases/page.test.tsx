import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireFinanceAdmin: vi.fn(), findMany: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ supportRefundHandoff: { findMany: mocks.findMany } }),
}));

import AdminSupportCasesPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ user: { id: "finance-1" } });
  mocks.findMany.mockResolvedValue([]);
});

describe("/admin/support-cases route", () => {
  it("requires finance authorization and renders a bounded handoff projection", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "handoff-1", status: "requested", requestedAmountCents: 12_300,
      vendor: { name: "測試商家" },
      supportCase: { caseNumber: "SC-20260808-A1", priority: "p1", status: "waiting_finance" },
      order: { orderNumber: "CD-100", currency: "TWD" },
    }]);

    const html = renderToStaticMarkup(await AdminSupportCasesPage());

    expect(mocks.requireFinanceAdmin).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: 300,
    }));
    expect(html).toContain("退款客服交接");
    expect(html).toContain("測試商家");
    expect(html).toContain("CD-100");
    expect(html).toContain('href="/admin/support-cases/handoff-1"');
  });

  it("states clearly that the queue does not execute a provider refund", async () => {
    const html = renderToStaticMarkup(await AdminSupportCasesPage());
    expect(html).toContain("真正退款仍走既有 provider reservation／MFA／reconciliation 流程");
    expect(html).toContain("目前沒有退款交接");
  });
});
