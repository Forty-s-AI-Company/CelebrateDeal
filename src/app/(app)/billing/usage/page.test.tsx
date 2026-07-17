import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  findUnique: vi.fn(),
  usageRecordFindMany: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  transactionFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendorUsageLimit: { findUnique: mocks.findUnique },
    usageRecord: { findMany: mocks.usageRecordFindMany },
    vendorSubscription: { findFirst: mocks.subscriptionFindFirst },
    paymentTransaction: { findMany: mocks.transactionFindMany },
  }),
}));

import BillingUsagePage from "./page";

const currentVendor = { id: "vendor-current" };
const transactions = [
  { id: "paid-at-start", vendorId: "vendor-current", status: "paid", occurredAt: new Date("2026-07-01T00:00:00.000Z"), grossAmountCents: 10000, platformFeeCents: 500 },
  { id: "refund-before-end", vendorId: "vendor-current", status: "partially_refunded", occurredAt: new Date("2026-07-31T23:59:59.999Z"), grossAmountCents: 5400, platformFeeCents: 300 },
  { id: "other-vendor", vendorId: "vendor-other", status: "paid", occurredAt: new Date("2026-07-15T00:00:00.000Z"), grossAmountCents: 100000, platformFeeCents: 5000 },
  { id: "pending", vendorId: "vendor-current", status: "pending", occurredAt: new Date("2026-07-15T00:00:00.000Z"), grossAmountCents: 200000, platformFeeCents: 10000 },
  { id: "previous-month", vendorId: "vendor-current", status: "refunded", occurredAt: new Date("2026-06-30T23:59:59.999Z"), grossAmountCents: 300000, platformFeeCents: 15000 },
  { id: "next-month", vendorId: "vendor-current", status: "paid", occurredAt: new Date("2026-08-01T00:00:00.000Z"), grossAmountCents: 400000, platformFeeCents: 20000 },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue(currentVendor);
  mocks.findUnique.mockResolvedValue(null);
  mocks.usageRecordFindMany.mockResolvedValue([]);
  mocks.subscriptionFindFirst.mockResolvedValue(null);
  mocks.transactionFindMany.mockImplementation(async ({ where }) =>
    transactions.filter((transaction) =>
      transaction.vendorId === where.vendorId &&
      where.status.in.includes(transaction.status) &&
      transaction.occurredAt >= where.occurredAt.gte &&
      transaction.occurredAt < where.occurredAt.lt,
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/billing/usage route", () => {
  it("queries the current vendor's completed transactions in the current month's half-open interval", async () => {
    await BillingUsagePage();

    expect(mocks.requireVendor).toHaveBeenCalledOnce();
    expect(mocks.transactionFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: currentVendor.id,
        status: { in: ["paid", "partially_refunded", "refunded"] },
        occurredAt: {
          gte: new Date("2026-07-01T00:00:00.000Z"),
          lt: new Date("2026-08-01T00:00:00.000Z"),
        },
      },
      orderBy: { occurredAt: "desc" },
    });
  });

  it("renders revenue and estimated fees from only matching transactions", async () => {
    const html = renderToStaticMarkup(await BillingUsagePage());

    expect(html).toContain("本月成交額");
    expect(html).toContain("預估交易服務費");
    expect(html).toContain("$154");
    expect(html).toContain("$8");
    expect(html).not.toContain("$10,154");
    expect(html).not.toContain("$508");
  });
});
