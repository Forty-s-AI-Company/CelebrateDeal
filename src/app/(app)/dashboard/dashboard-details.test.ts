import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ count: vi.fn(), list: vi.fn(), usage: vi.fn(), payment: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  live: { count: mocks.count, findMany: mocks.list }, product: { count: mocks.count },
  affiliate: { findMany: mocks.list }, vendorUsageLimit: { findUnique: mocks.usage },
  interactionScript: { count: mocks.count }, interactionRole: { count: mocks.count },
  paymentMethodReference: { count: mocks.payment }, registrationForm: { count: mocks.count },
  messageTemplate: { count: mocks.count },
}) }));
vi.mock("@/lib/dashboard-read-model", () => ({
  // 這個測試只驗證付款查詢契約；計時與其他統計不在本次範圍。
  createDashboardMeasurement: () => ({ measure: async (_name: string, work: () => Promise<unknown>) => work(), snapshot: () => ({}) }),
  readDashboardLiveSubmissionCounts: async () => ({}),
}));

import { loadDashboardDetails } from "./dashboard-details";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.count.mockResolvedValue(1);mocks.list.mockResolvedValue([]);mocks.usage.mockResolvedValue(null);
  vi.useFakeTimers({ toFake: ["Date"] });vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
});
afterEach(() => { vi.useRealTimers(); });

describe("dashboard platform-payment verification query", () => {
  it.each([0, 1])("uses the unchanged publication validity predicate for persisted count %i", async count => {
    mocks.payment.mockResolvedValue(count);
    const now = new Date("2026-10-16T12:00:00.000Z");
    const result = await loadDashboardDetails({ vendorId: "wp02-synthetic-vendor", memberRole: "owner", supportEmailConfigured: true, trackingConfigured: false });
    expect(mocks.payment).toHaveBeenCalledExactlyOnceWith({ where: {
      vendorId: "wp02-synthetic-vendor", scopeType: "VENDOR", membershipId: null, status: "verified",
      verifiedAt: { not: null, lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    } });
    expect(result.data).not.toBeNull();
    expect(result.data?.checklist.find(item => item.href === "/billing/payment-methods")?.done).toBe(count > 0);
  });
});
