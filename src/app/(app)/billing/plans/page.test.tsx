import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ billingPlan: { findMany: mocks.findMany } }),
}));

import BillingPlansPage from "./page";

const plans = [
  {
    id: "plan-active",
    code: "ACTIVE",
    name: "可用方案",
    description: "仍可購買的方案",
    isActive: true,
    monthlyPriceCents: 9900,
    includedStreamMinutes: 6000,
    includedEvents: 10,
    includedAffiliates: 50,
    includedStorageMinutes: 1200,
    paymentServiceFeeCents: 300,
    transactionFeeRateBps: 250,
    overflowWatchHourPriceCents: 500,
    overflowEventUnitPriceCents: 1000,
    overflowAffiliateUnitPriceCents: 200,
  },
  {
    id: "plan-retired",
    code: "RETIRED",
    name: "停售方案",
    description: "已停止銷售的方案",
    isActive: false,
    monthlyPriceCents: 4900,
    includedStreamMinutes: 3000,
    includedEvents: 5,
    includedAffiliates: 20,
    includedStorageMinutes: 600,
    paymentServiceFeeCents: 100,
    transactionFeeRateBps: 300,
    overflowWatchHourPriceCents: 300,
    overflowEventUnitPriceCents: 800,
    overflowAffiliateUnitPriceCents: 100,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockImplementation(async (query) =>
    plans.filter((plan) => !query.where?.isActive || plan.isActive),
  );
});

describe("/billing/plans route", () => {
  it("queries only active billing plans", async () => {
    await BillingPlansPage();

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { monthlyPriceCents: "asc" },
    });
  });

  it("renders active plans while preserving their prices and quotas", async () => {
    const html = renderToStaticMarkup(await BillingPlansPage());

    expect(html).toContain("可用方案");
    expect(html).toContain("仍可購買的方案");
    expect(html).toContain("$99");
    expect(html).toContain("100 小時 / 月");
    expect(html).toContain("10 場 / 月");
    expect(html).toContain("50 人");
    expect(html).not.toContain("停售方案");
    expect(html).not.toContain("已停止銷售的方案");
    expect(html).not.toContain("RETIRED");
  });
});
