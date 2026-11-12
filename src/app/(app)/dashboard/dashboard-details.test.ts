import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ count: vi.fn(), list: vi.fn(), usage: vi.fn(), payment: vi.fn(), preference: vi.fn(), project: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  live: { count: mocks.count, findMany: mocks.list }, product: { count: mocks.count },
  affiliate: { findMany: mocks.list }, vendorUsageLimit: { findUnique: mocks.usage },
  interactionScript: { count: mocks.count }, interactionRole: { count: mocks.count },
  paymentMethodReference: { count: mocks.payment }, registrationForm: { findMany: mocks.list, count: mocks.count },
  messageTemplate: { findMany: mocks.list }, video: { count: mocks.count },
  userOnboardingPreference: { findUnique: mocks.preference }, salesProject: { findFirst: mocks.project },
  onboardingTaskState: { findMany: mocks.list }, salesProjectProduct: { count: mocks.count }, consultationEvent: { findMany: mocks.list },
  vendor: { findUnique: async () => ({ betaFeatureGrants: ["courses", "billing", "funnel_binding", "consultation_booking", "browser_live", "danmaku"] }) },
}) }));
vi.mock("@/lib/dashboard-read-model", () => ({
  // 這個測試只驗證付款查詢契約與上線導引來源；計時與其他統計不在本次範圍。
  createDashboardMeasurement: () => ({ measure: async (_name: string, work: () => Promise<unknown>) => work(), snapshot: () => ({}) }),
  readDashboardLiveSubmissionCounts: async () => ({}),
}));

import { loadDashboardDetails } from "./dashboard-details";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.count.mockResolvedValue(1);mocks.list.mockResolvedValue([]);mocks.usage.mockResolvedValue(null);mocks.preference.mockResolvedValue(null);
  vi.useFakeTimers({ toFake: ["Date"] });vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
});
afterEach(() => { vi.useRealTimers(); });

const props = { vendorId: "wp02-synthetic-vendor", userId: "wp02-synthetic-user", supportEmailConfigured: true, trackingConfigured: false };

describe("dashboard platform-payment verification query", () => {
  it.each([0, 1])("uses the unchanged publication validity predicate for persisted count %i", async count => {
    mocks.payment.mockResolvedValue(count);
    const now = new Date("2026-10-16T12:00:00.000Z");
    const result = await loadDashboardDetails({ ...props, memberRole: "owner" });
    expect(mocks.payment).toHaveBeenCalledExactlyOnceWith({ where: {
      vendorId: "wp02-synthetic-vendor", scopeType: "VENDOR", membershipId: null, status: "verified",
      verifiedAt: { not: null, lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    } });
    expect(result.data).not.toBeNull();
    expect(result.data?.checklist.find(item => item.href === "/billing/payment-methods")?.done).toBe(count > 0);
  });
});

describe("dashboard onboarding card", () => {
  it("lists the unified onboarding steps in /onboarding order", async () => {
    mocks.payment.mockResolvedValue(0);
    const result = await loadDashboardDetails({ ...props, memberRole: "owner" });
    expect(result.data?.checklist.map((item) => item.label)).toEqual(["商店與客服資料", "平台服務付款驗證", "建立可販售商品", "完成報名流程", "準備第一場可販售直播"]);
    expect(mocks.preference).toHaveBeenCalledWith({ where: { userId_vendorId: { userId: "wp02-synthetic-user", vendorId: "wp02-synthetic-vendor" } }, select: { selectedProjectId: true } });
  });

  it("adds the selected project's publish step only for a project of this vendor", async () => {
    mocks.payment.mockResolvedValue(1);
    mocks.preference.mockResolvedValue({ selectedProjectId: "project-own" });
    mocks.project.mockResolvedValue({ id: "project-own", name: "春季講座", primaryFlow: "live", publishedAt: null });
    const result = await loadDashboardDetails({ ...props, memberRole: "admin" });
    expect(mocks.project).toHaveBeenCalledWith({ where: { id: "project-own", vendorId: "wp02-synthetic-vendor", status: { not: "archived" } }, select: { id: true, name: true, primaryFlow: true, publishedAt: true } });
    expect(result.data?.checklist.at(-1)).toEqual({ label: "發布專案「春季講座」", href: "/projects/project-own", done: false });
    // One payment read serves both the merchant step and the project gate.
    expect(mocks.payment).toHaveBeenCalledOnce();

    mocks.project.mockResolvedValue(null);
    const foreign = await loadDashboardDetails({ ...props, memberRole: "admin" });
    expect(foreign.data?.checklist).toHaveLength(5);
  });

  it.each(["accountant", "member", null])("does not read onboarding data for %s", async (role) => {
    const result = await loadDashboardDetails({ ...props, memberRole: role });
    expect(result.data?.checklist).toEqual([]);
    expect(mocks.payment).not.toHaveBeenCalled();
    expect(mocks.preference).not.toHaveBeenCalled();
  });
});
