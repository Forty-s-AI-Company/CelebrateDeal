import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorSupportMfa: vi.fn(),
  supportCaseFindFirst: vi.fn(),
  vendorMemberFindMany: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/lib/auth", () => ({ requireVendorSupportMfa: mocks.requireVendorSupportMfa }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    supportCase: { findFirst: mocks.supportCaseFindFirst },
    vendorMember: { findMany: mocks.vendorMemberFindMany },
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("@/app/actions/support-case-actions", () => ({
  addSupportCaseNoteAction: vi.fn(),
  addSupportCaseCustomerReplyAction: vi.fn(),
  assignSupportCaseAction: vi.fn(),
  requestSupportRefundHandoffAction: vi.fn(),
  transitionSupportCaseAction: vi.fn(),
}));

import SupportCaseDetailPage from "./page";

const supportCase = {
  id: "case-1",
  caseNumber: "SC-100",
  category: "general",
  priority: "p1",
  status: "open",
  revision: 4,
  assignedMemberId: null,
  firstRespondedAt: null,
  responseDueAt: new Date("2099-01-01T00:00:00.000Z"),
  createdBy: null,
  assignedMember: null,
  events: [],
  refundHandoff: null,
  order: {
    id: "order-1",
    orderNumber: "CD-100",
    status: "paid",
    currency: "TWD",
    paidAmountCents: 10_000,
    refundedAmountCents: 0,
    buyerMaskedName: "王＊明",
    buyerMaskedEmail: "w***@example.test",
    primaryPaymentTransactionId: "transaction-1",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorSupportMfa.mockResolvedValue({
    vendor: { id: "vendor-1" },
    member: { id: "support-1", role: "support" },
  });
  mocks.supportCaseFindFirst.mockResolvedValue(supportCase);
  mocks.vendorMemberFindMany.mockResolvedValue([
    { id: "support-1", role: "support", user: { name: "客服一號" } },
  ]);
});

describe("/support-cases/[id] role controls", () => {
  it("keeps reply and note tools for support while hiding workflow management", async () => {
    const html = renderToStaticMarkup(await SupportCaseDetailPage({
      params: Promise.resolve({ id: "case-1" }),
    }));

    expect(html).toContain("回覆買家");
    expect(html).toContain("新增內部紀錄");
    expect(html).not.toContain("指派 owner");
    expect(html).not.toContain("更新狀態");
    expect(html).not.toContain("退款交接");
    expect(html).not.toContain('href="/orders/order-1"');
    expect(mocks.vendorMemberFindMany).not.toHaveBeenCalled();
    expect(mocks.supportCaseFindFirst).toHaveBeenCalledTimes(1);
    const supportProjection = mocks.supportCaseFindFirst.mock.calls[0][0];
    expect(supportProjection.include).not.toHaveProperty("refundHandoff");
    expect(supportProjection.include.order.select).not.toHaveProperty("paidAmountCents");
    expect(supportProjection.include.order.select).not.toHaveProperty("refundedAmountCents");
    expect(supportProjection.include.order.select).not.toHaveProperty("primaryPaymentTransactionId");
  });

  it("shows assignment, status and refund workflow only to owner or admin", async () => {
    mocks.requireVendorSupportMfa.mockResolvedValue({
      vendor: { id: "vendor-1" },
      member: { id: "owner-1", role: "owner" },
    });

    const html = renderToStaticMarkup(await SupportCaseDetailPage({
      params: Promise.resolve({ id: "case-1" }),
    }));

    expect(html).toContain("指派 owner");
    expect(html).toContain("更新狀態");
    expect(html).toContain("退款交接");
    expect(html).toContain('href="/orders/order-1"');
    expect(mocks.vendorMemberFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", status: "active", role: { in: ["owner", "admin", "support"] } },
    }));
    expect(mocks.supportCaseFindFirst).toHaveBeenCalledTimes(2);
    const managerProjection = mocks.supportCaseFindFirst.mock.calls
      .map(([query]) => query)
      .find((query) => query.select?.refundHandoff === true);
    expect(managerProjection).toEqual(expect.objectContaining({
      select: expect.objectContaining({
        refundHandoff: true,
        order: { select: {
          status: true,
          paidAmountCents: true,
          refundedAmountCents: true,
          primaryPaymentTransactionId: true,
        } },
      }),
    }));
  });
});
