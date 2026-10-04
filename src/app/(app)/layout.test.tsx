import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorContext: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorContext: mocks.requireVendorContext }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/components/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/app/actions/sales-workspace-actions", () => ({ persistTaskPanelCollapsedAction: vi.fn(), selectSalesProjectAction: vi.fn() }));
import ProtectedLayout from "./layout";

function context(role: string | null) {
  return {
    auth: { user: { id: "user-1" }, member: role ? { role } : null },
    vendor: { id: "vendor-1", name: "Synthetic workspace", email: "owner@example.test", enabledFeatureModules: [], logoUrl: null, supportEmail: null },
  };
}

beforeEach(() => vi.resetAllMocks());

describe("protected shell data boundary", () => {
  it.each(["support", "accountant", "member", null])("does not load manager data for %s", async (role) => {
    mocks.requireVendorContext.mockResolvedValue(context(role));
    mocks.getDb.mockImplementation(() => { throw new Error("Manager data must not be queried"); });
    const view = await ProtectedLayout({ children: "protected content" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(view.props.memberRole).toBe(role);
    expect(view.props).not.toHaveProperty("projects");
    expect(view.props).not.toHaveProperty("onboardingTasks");
    expect(view.props).not.toHaveProperty("selectProject");
    expect(view.props.children).toBe("protected content");
  });

  it.each(["owner", "admin"])("loads tenant-scoped onboarding for %s", async (role) => {
    mocks.requireVendorContext.mockResolvedValue(context(role));
    const db = {
      vendorSubscription: { findFirst: vi.fn().mockResolvedValue({ plan: { name: "Test plan" } }) },
      salesProject: { findMany: vi.fn().mockResolvedValue([]) },
      userOnboardingPreference: { findUnique: vi.fn().mockResolvedValue(null) },
      onboardingTaskState: { findMany: vi.fn().mockResolvedValue([]) },
      paymentMethodReference: { count: vi.fn().mockResolvedValue(0) },
      vendorMember: { count: vi.fn().mockResolvedValue(1) },
      commerceOrder: { count: vi.fn().mockResolvedValue(0) },
    };
    mocks.getDb.mockReturnValue(db);
    const view = await ProtectedLayout({ children: "protected content" });
    expect(view.props.planLabel).toBe("Test plan");
    expect(view.props.projects).toEqual([]);
    expect(view.props.onboardingTasks.length).toBeGreaterThan(0);
    expect(db.userOnboardingPreference.findUnique).toHaveBeenCalledWith({ where: { userId_vendorId: { userId: "user-1", vendorId: "vendor-1" } } });
    for (const query of [db.vendorSubscription.findFirst, db.salesProject.findMany, db.onboardingTaskState.findMany, db.paymentMethodReference.count, db.vendorMember.count, db.commerceOrder.count]) {
      expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1" }) }));
    }
    expect(db.paymentMethodReference.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ verifiedAt: { not: null, lte: expect.any(Date) } }) }));
  });
  it.each(["own-project", "foreign-project"])("binds selected preference %s to the current tenant project list", async (selectedProjectId) => {
    mocks.requireVendorContext.mockResolvedValue(context("owner"));
    const project = { id: "own-project", name: "Own project", status: "draft", primaryFlow: "live", publishedAt: null };
    const db = {
      vendorSubscription: { findFirst: vi.fn().mockResolvedValue(null) },
      salesProject: { findMany: vi.fn().mockResolvedValue([project]) },
      userOnboardingPreference: { findUnique: vi.fn().mockResolvedValue({ selectedProjectId, taskPanelCollapsed: false }) },
      onboardingTaskState: { findMany: vi.fn().mockResolvedValue([]) },
      salesProjectProduct: { count: vi.fn().mockResolvedValue(1) },
      registrationForm: { count: vi.fn().mockResolvedValue(0) },
      live: { count: vi.fn().mockResolvedValue(0) },
      consultationEvent: { findMany: vi.fn().mockResolvedValue([]) },
      paymentMethodReference: { count: vi.fn().mockResolvedValue(0) },
      vendorMember: { count: vi.fn().mockResolvedValue(1) },
      commerceOrder: { count: vi.fn().mockResolvedValue(0) },
    };
    mocks.getDb.mockReturnValue(db);
    const view = await ProtectedLayout({ children: "protected content" });
    const own = selectedProjectId === "own-project";
    expect(view.props.selectedProjectId).toBe(own ? "own-project" : null);
    expect(db.onboardingTaskState.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", scopeKey: own ? "own-project" : "workspace" } }));
    for (const query of [db.salesProjectProduct.count, db.registrationForm.count, db.live.count, db.consultationEvent.findMany]) {
      if (own) expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", projectId: "own-project" }) }));
      else expect(query).not.toHaveBeenCalled();
    }
    if (own) {
      expect(view.props.onboardingTasks).toEqual(expect.arrayContaining([expect.objectContaining({ key: "project_publish", href: "/projects/own-project" })]));
      expect(db.salesProjectProduct.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ product: { isActive: true, priceCents: { gt: 0 } } }) }));
    }
  });

});
