import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorContext: vi.fn(), redirect: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireVendorContext: mocks.requireVendorContext }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    mocks.redirect(target);
    throw new Error(`NEXT_REDIRECT:${target}`);
  },
}));

import SettingsHubPage from "./page";

const ALL_MODULES = ["funnel_builder", "live_webinar", "affiliate_program", "tax_remuneration", "analytics_advanced", "consultation_booking"];

function context(role: string | null, enabledFeatureModules: string[] = ALL_MODULES, betaFeatureGrants: string[] = ["billing", "funnel_binding"]) {
  mocks.requireVendorContext.mockResolvedValue({
    auth: { member: role ? { id: "member-1", role } : null },
    vendor: { id: "vendor-1", enabledFeatureModules, betaFeatureGrants },
  });
}

async function render() {
  return renderToStaticMarkup(await SettingsHubPage());
}

function hrefs(html: string) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
}

describe("settings hub page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a heading plus grouped lists of described links for an owner", async () => {
    context("owner");
    const html = await render();

    expect(html).toContain("<h1");
    expect(html).toContain(">設定</h1>");
    for (const group of ["帳號與安全", "工作區", "系統設定", "帳務與方案"]) expect(html).toContain(`>${group}</h2>`);
    expect((html.match(/<ul/g) ?? []).length).toBe(4);
    expect((html.match(/aria-labelledby="settings-group-/g) ?? []).length).toBe(4);
    expect(hrefs(html)).toEqual([
      "/settings/security",
      "/settings/brand",
      "/onboarding",
      "/settings/tracking",
      "/settings/features",
      "/settings/line",
      "/settings/automations",
      "/settings/team",
      "/billing/usage",
      "/billing/payment-methods",
      "/billing/plans",
      "/billing/invoices",
      "/billing/electronic-invoices",
      "/billing/settlements",
      "/billing/payouts",
      "/affiliates/commissions",
      "/billing/course-payouts",
    ]);
    expect(html).toContain("變更登入 Email、密碼");
  });

  it("hides owner-only LINE from an admin but keeps the rest of the manager pages", async () => {
    context("admin");
    const links = hrefs(await render());

    expect(links).not.toContain("/settings/line");
    expect(links).toEqual(expect.arrayContaining(["/settings/security", "/settings/brand", "/settings/team", "/billing/usage"]));
  });

  it("limits an accountant to personal security and billing pages", async () => {
    context("accountant");
    const html = await render();
    const links = hrefs(html);

    expect(links).toContain("/settings/security");
    expect(links).toContain("/billing/invoices");
    expect(links).toContain("/affiliates/commissions");
    for (const hidden of ["/settings/brand", "/settings/team", "/settings/line", "/onboarding", "/settings/features"]) expect(links).not.toContain(hidden);
    expect(html).not.toContain(">工作區</h2>");
    expect(html).not.toContain(">系統設定</h2>");
  });

  it("shows support only the security page", async () => {
    context("support");
    const html = await render();

    expect(hrefs(html)).toEqual(["/settings/security"]);
    expect(html).not.toContain(">帳務與方案</h2>");
  });

  it("omits links for disabled modules", async () => {
    context("owner", ["funnel_builder"], []);
    const links = hrefs(await render());

    expect(links).not.toContain("/billing/payouts");
    expect(links).not.toContain("/billing/course-payouts");
    expect(links).not.toContain("/affiliates/commissions");
    expect(links).toEqual(expect.arrayContaining(["/billing/electronic-invoices", "/settings/features", "/settings/security"]));
  });

  it.each(["member", "partner", null])("sends role %s back to the dashboard instead of rendering an empty hub", async (role) => {
    context(role);

    await expect(SettingsHubPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard?error=insufficient_role");
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard?error=insufficient_role");
  });
});
