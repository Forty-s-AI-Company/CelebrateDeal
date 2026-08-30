import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorFinance: vi.fn(),
  payoutFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ coursePayout: { findMany: mocks.payoutFindMany } }) }));

import MerchantCoursePayoutsPage from "./page";

const payout = {
  id: "payout-current",
  vendorId: "vendor-current",
  recipientMembershipId: "recipient-f",
  monthKey: "2026-07",
  commissionAmountCents: 500,
  adjustmentAmountCents: -100,
  finalAmountCents: 400,
  grossSalesAmountCents: 10_000,
  netReferenceAmountCents: 8_600,
  status: "pending",
  outcomeReference: null,
  outcomeReason: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  recipient: { vendorMember: { user: { name: "課程推廣者 F" } } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorFinance.mockResolvedValue({ vendor: { id: "vendor-current" } });
  mocks.payoutFindMany.mockResolvedValue([payout]);
});

describe("/billing/course-payouts", () => {
  it("requires merchant finance access and scopes the list to the current vendor", async () => {
    await MerchantCoursePayoutsPage();

    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith("/billing/course-payouts");
    expect(mocks.payoutFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current" },
      orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        recipient: {
          include: { vendorMember: { include: { user: { select: { name: true } } } } },
        },
      },
    });
  });

  it("renders gross, net, payable and a tenant-owned ledger link without mutation controls", async () => {
    const html = renderToStaticMarkup(await MerchantCoursePayoutsPage());

    expect(html).toContain("課程推廣者 F");
    expect(html).toContain("Gross");
    expect(html).toContain("Net reference");
    expect(html).toContain("$100");
    expect(html).toContain("$86");
    expect(html).toContain("$4");
    expect(html).toContain('href="/billing/course-payouts/payout-current"');
    expect(html).not.toContain("記錄 paid");
    expect(html).not.toContain("記錄 void");
    expect(html).not.toContain("<form");
  });
});
