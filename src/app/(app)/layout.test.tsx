import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorContext: vi.fn(), getDb: vi.fn(), state: vi.fn(), portal: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorContext: mocks.requireVendorContext }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/merchant-email-verification", () => ({ vendorEmailVerificationState: mocks.state }));
vi.mock("@/lib/affiliate-portal", () => ({ hasActiveAffiliatePortalAccess: mocks.portal }));
vi.mock("@/components/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/app/actions/sales-workspace-actions", () => ({ persistTaskPanelCollapsedAction: vi.fn(), selectSalesProjectAction: vi.fn() }));
import { renderToStaticMarkup } from "react-dom/server";
import ProtectedLayout from "./layout";

function context(role: string | null, emailVerifiedAt: Date | null = new Date("2026-10-25T00:00:00Z"), userId = "user-1") {
  return {
    auth: { user: { id: userId, emailVerifiedAt }, member: role ? { id: "member-1", role } : null },
    vendor: { betaFeatureGrants: ["courses", "billing", "funnel_binding", "consultation_booking", "browser_live", "danmaku"], id: "vendor-1", name: "Synthetic workspace", email: "owner@example.test", enabledFeatureModules: [], logoUrl: null, supportEmail: null },
  };
}

/** Any manager-table access throws; only the (mocked) verification state may receive the client. */
const managerDataTrap = new Proxy({}, { get: () => { throw new Error("Manager data must not be queried"); } });

function managerDb() {
  return {
    vendorSubscription: { findFirst: vi.fn().mockResolvedValue(null) },
    salesProject: { findMany: vi.fn().mockResolvedValue([]) },
    userOnboardingPreference: { findUnique: vi.fn().mockResolvedValue(null) },
    onboardingTaskState: { findMany: vi.fn().mockResolvedValue([]) },
    paymentMethodReference: { count: vi.fn().mockResolvedValue(0) },
    vendorMember: { count: vi.fn().mockResolvedValue(1) },
    commerceOrder: { count: vi.fn().mockResolvedValue(0) },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.state.mockResolvedValue({ verified: true, founder: { userId: "user-1", email: "owner@example.test" } });
  mocks.portal.mockResolvedValue(false);
});

describe("email verification banner (mirrors the vendor gate)", () => {
  it("gives the unverified founding owner the resend flow", async () => {
    mocks.requireVendorContext.mockResolvedValue(context("owner", null));
    mocks.state.mockResolvedValue({ verified: false, founder: { userId: "user-1", email: "owner@example.test" } });
    mocks.getDb.mockReturnValue(managerDb());
    const view = await ProtectedLayout({ children: "protected content" });
    const html = renderToStaticMarkup(view.props.children);
    expect(mocks.state).toHaveBeenCalledWith(expect.anything(), "vendor-1");
    expect(html).toContain("請先驗證 Email");
    expect(html).toContain('href="/verify-email"');
    expect(html).toContain("protected content");
  });

  it.each(["admin", "accountant", "support"])("never shows the owner-only banner to %s, even for an unverified vendor or founder", async (role) => {
    mocks.state.mockResolvedValue({ verified: false, founder: { userId: "user-1", email: "owner@example.test" } });
    mocks.getDb.mockReturnValue(managerDb());
    for (const userId of ["user-1", "user-2"]) {
      mocks.requireVendorContext.mockResolvedValue(context(role, null, userId));
      const view = await ProtectedLayout({ children: "protected content" });
      expect(view.props.children).toBe("protected content");
    }
    expect(mocks.state).not.toHaveBeenCalled();
  });

  it("tells a co-owner who must verify, masked, without a resend button", async () => {
    // The viewer's own email is unverified, but only the founder's counts.
    mocks.requireVendorContext.mockResolvedValue(context("owner", null, "user-2"));
    mocks.state.mockResolvedValue({ verified: false, founder: { userId: "user-1", email: "owner@example.test" } });
    mocks.getDb.mockReturnValue(managerDb());
    const html = renderToStaticMarkup((await ProtectedLayout({ children: "protected content" })).props.children);
    expect(html).toContain("請商家註冊帳號（o***@example.test）完成 Email 驗證");
    expect(html).not.toContain("owner@example.test");
    expect(html).not.toContain('href="/verify-email"');
  });

  it("shows nothing while the vendor counts as verified, even to an unverified owner", async () => {
    mocks.requireVendorContext.mockResolvedValue(context("owner", null, "user-2"));
    mocks.getDb.mockReturnValue(managerDb());
    const view = await ProtectedLayout({ children: "protected content" });
    expect(view.props.children).toBe("protected content");
  });

  it("without a founder, lets an unverified viewer verify and tells a verified one that an owner must", async () => {
    mocks.state.mockResolvedValue({ verified: false, founder: null });
    mocks.getDb.mockReturnValue(managerDb());
    mocks.requireVendorContext.mockResolvedValue(context("owner", null, "user-2"));
    expect(renderToStaticMarkup((await ProtectedLayout({ children: "x" })).props.children)).toContain('href="/verify-email"');
    mocks.requireVendorContext.mockResolvedValue(context("owner", new Date(), "user-2"));
    const html = renderToStaticMarkup((await ProtectedLayout({ children: "x" })).props.children);
    expect(html).toContain("請商家的擁有者完成 Email 驗證");
    expect(html).not.toContain('href="/verify-email"');
  });
});

describe("partner portal link", () => {
  it.each([[true], [false]])("passes the member's own grant state (%s) to the shell for a non-manager", async (granted) => {
    mocks.requireVendorContext.mockResolvedValue(context("support"));
    mocks.getDb.mockReturnValue(managerDataTrap);
    mocks.portal.mockResolvedValue(granted);
    const view = await ProtectedLayout({ children: "x" });
    expect(view.props.hasPartnerPortal).toBe(granted);
  });

  it("passes it for a manager as well", async () => {
    mocks.requireVendorContext.mockResolvedValue(context("owner"));
    mocks.getDb.mockReturnValue(managerDb());
    mocks.portal.mockResolvedValue(true);
    const view = await ProtectedLayout({ children: "x" });
    expect(view.props.hasPartnerPortal).toBe(true);
    expect(mocks.portal).toHaveBeenCalledWith(expect.anything(), { vendorId: "vendor-1", vendorMemberId: "member-1", userId: "user-1" });
  });
});

describe("protected shell data boundary", () => {
  it.each(["support", "accountant", "member", null])("does not load manager data for %s", async (role) => {
    mocks.requireVendorContext.mockResolvedValue(context(role));
    mocks.getDb.mockReturnValue(managerDataTrap);
    const view = await ProtectedLayout({ children: "protected content" });
    // The owner-only banner never queries for these roles.
    expect(mocks.state).not.toHaveBeenCalled();
    // The portal link lookup is the member's own grant; identity checks only,
    // since deep equality would touch the trap.
    if (role) {
      expect(mocks.portal.mock.calls[0]![0] === managerDataTrap).toBe(true);
      expect(mocks.portal.mock.calls[0]![1]).toEqual({ vendorId: "vendor-1", vendorMemberId: "member-1", userId: "user-1" });
    } else {
      expect(mocks.portal).not.toHaveBeenCalled();
    }
    expect(view.props.hasPartnerPortal).toBe(false);
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
    expect(view.props.taskPanelCollapsed).toBe(true);
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
    expect(view.props.taskPanelCollapsed).toBe(false);
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
