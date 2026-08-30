import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorContext: vi.fn(),
  redirect: vi.fn(),
  dbCalls: 0,
}));

vi.mock("@/lib/auth", () => ({ requireVendorContext: mocks.requireVendorContext }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    mocks.dbCalls += 1;
    return {};
  },
}));
vi.mock("./dashboard-kpis", () => ({ default: () => null }));
vi.mock("./dashboard-details", () => ({ default: () => null }));

import DashboardPage from "./page";

const vendor = {
  id: "vendor-dashboard",
  supportEmail: "support@example.test",
  tracking: { googleTagManagerId: "GTM-SYNTHETIC", facebookPixelId: null, tiktokPixelId: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbCalls = 0;
  mocks.requireVendorContext.mockResolvedValue({ auth: { member: { role: "owner" } }, vendor });
});

describe("/dashboard route shell", () => {
  it("renders the title and action without waiting for dashboard data queries", async () => {
    const html = renderToStaticMarkup(await DashboardPage({}));

    expect(mocks.requireVendorContext).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.dbCalls).toBe(0);
    expect(html).toContain("Dashboard");
    expect(html).toContain('data-dashboard-region="kpis"');
    expect(html).toContain('data-dashboard-region="details"');
    expect(html).toContain('href="/lives/new"');
  });

  it("redirects support before creating any dashboard read model", async () => {
    mocks.requireVendorContext.mockResolvedValue({ auth: { member: { role: "support" } }, vendor });
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });

    await expect(DashboardPage({})).rejects.toThrow("redirect:/support-cases");
    expect(mocks.redirect).toHaveBeenCalledWith("/support-cases");
    expect(mocks.dbCalls).toBe(0);
  });

  it("does not expose manager-only action to a viewer", async () => {
    mocks.requireVendorContext.mockResolvedValue({ auth: { member: { role: "viewer" } }, vendor: { ...vendor, tracking: null } });

    const html = renderToStaticMarkup(await DashboardPage({}));

    expect(html).not.toContain('href="/lives/new"');
  });
});
