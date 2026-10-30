import { createElement, type ReactNode } from "react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ logoutAction: vi.fn() }));
const formStatuses = vi.hoisted(() => ({
  cursor: 0,
  values: [] as Array<{ pending: boolean; data: FormData | null; action: null; method: null }>,
}));
vi.mock("@/app/actions", () => ({ logoutAction: mocks.logoutAction }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/sales-workspace-actions", () => ({ controlOnboardingGuideAction: vi.fn() }));

vi.mock("@/components/csrf-field", () => ({
  CsrfField: () => createElement("input", { type: "hidden", name: "csrfToken", value: "synthetic-csrf-token" }),
}));
vi.mock("react-dom", async (importOriginal) => {
  const reactDom = await importOriginal<typeof import("react-dom")>();
  return {
    ...reactDom,
    useFormStatus: () => formStatuses.values[formStatuses.cursor++] ?? {
      pending: false,
      data: null,
      action: null,
      method: null,
    },
  };
});

import { navigationForRole } from "./app-shell";
import { settingsGroups, settingsHubForRole } from "@/lib/app-navigation";
import type { VendorFeatureModule } from "@/lib/vendor-feature-toggles";
import { AppShell } from "./app-shell";

function linksFor(role: string | null, isPlatformAdmin = false, enabledModules?: readonly VendorFeatureModule[]) {
  return navigationForRole(role, isPlatformAdmin, enabledModules).flatMap((group) => group.items.map((item) => item.href));
}

function hubLinksFor(role: string | null, isPlatformAdmin = false, enabledModules?: readonly VendorFeatureModule[]) {
  return settingsHubForRole(role, isPlatformAdmin, enabledModules).flatMap((group) => group.items.map((item) => item.href));
}

function renderShell({ memberRole, isPlatformAdmin = false, vendorName = "測試商家", hasPartnerPortal }: { memberRole: string | null; isPlatformAdmin?: boolean; vendorName?: string; hasPartnerPortal?: boolean }) {
  formStatuses.cursor = 0;
  const props = { memberRole, isPlatformAdmin, vendorName, ...(hasPartnerPortal === undefined ? {} : { hasPartnerPortal }) } as Parameters<typeof AppShell>[0];
  return renderToStaticMarkup(createElement(AppShell, props, createElement("p", null, "shell content") as ReactNode));
}

beforeEach(() => {
  formStatuses.cursor = 0;
  formStatuses.values = [];
});

describe("AppShell role navigation", () => {
  it("exposes LINE only to the owner allowed by the existing settings page", () => {
    expect(hubLinksFor("owner")).toContain("/settings/line");
    for (const role of ["admin", "accountant", "support", "member", null]) {
      expect(hubLinksFor(role)).not.toContain("/settings/line");
    }
    expect(hubLinksFor(null, true)).not.toContain("/settings/line");
    expect(renderShell({ memberRole: "owner" })).not.toContain('href="/settings/line"');
  });

  it("makes partner pages discoverable with the funnel feature", () => {
    for (const role of ["owner", "admin", "accountant"]) {
      expect(linksFor(role, false, ["funnel_builder"])).toContain("/partner-pages");
      expect(linksFor(role, false, [])).not.toContain("/partner-pages");
    }
    expect(linksFor("support")).not.toContain("/partner-pages");
    expect(renderShell({ memberRole: "owner" })).toContain('href="/partner-pages"');
  });

  it("links every supported role to an existing page rather than a missing settings route", () => {
    const links = new Set(["owner", "admin", "accountant", "support"].flatMap((role) => linksFor(role).concat(hubLinksFor(role)))
      .concat(linksFor(null, true)));
    expect(links.has("/settings/commissions")).toBe(false);
    for (const href of links) {
      const route = href.replace(/^\//, "");
      expect(["src/app", "src/app/(app)"].some((root) =>
        existsSync(path.join(process.cwd(), root, route, "page.tsx"))), href).toBe(true);
    }
  });
  it("keeps accountant navigation tenant-scoped and read-oriented", () => {
    const links = linksFor("accountant");
    const hub = hubLinksFor("accountant");

    expect(links).toContain("/settings");
    expect(hub).toContain("/billing/invoices");
    expect(hub).toContain("/billing/payment-methods");
    expect(hub).toContain("/affiliates/commissions");
    expect(hub).toContain("/billing/course-payouts");
    expect(hub).toContain("/settings/security");
    expect(links).toContain("/team-performance");
    expect(links).not.toContain("/forms");
    expect(links).not.toContain("/landing-pages");
    expect(hub).not.toContain("/settings/brand");
    expect(hub).not.toContain("/onboarding");
    expect(links).not.toContain("/admin/billing/dashboard");
  });

  it("exposes canonical orders only to merchant managers", () => {
    expect(linksFor("owner", false)).toContain("/orders");
    expect(linksFor("admin", false)).toContain("/orders");
    expect(linksFor("owner", false)).toContain("/support-cases");
    expect(linksFor("admin", false)).toContain("/support-cases");
    expect(linksFor("accountant", false)).not.toContain("/orders");
    expect(linksFor("accountant", false)).not.toContain("/support-cases");
  });

  it("gives support only its case queue and personal security settings", () => {
    expect(linksFor("support")).toEqual(["/support-cases", "/settings"]);
    expect(hubLinksFor("support")).toEqual(["/settings/security"]);
  });

  it("defaults unknown member roles to no navigation", () => {
    expect(linksFor("member")).toEqual([]);
    expect(linksFor(null)).toEqual([]);
  });

  it.each(["owner", "admin"])("shows operational tools to a vendor %s without platform routes", (role) => {
    const links = linksFor(role);

    expect(links).toContain("/forms");
    expect(links).toContain("/landing-pages");
    expect(links).toContain("/settings");
    expect(links).not.toContain("/settings/brand");
    expect(hubLinksFor(role)).toEqual(expect.arrayContaining(["/onboarding", "/settings/brand", "/settings/automations", "/settings/security"]));
    expect(links).not.toContain("/admin/billing/dashboard");
  });

  it("filters feature-owned navigation while keeping the module settings entry", () => {
    const links = linksFor("owner", false, ["funnel_builder"]);

    expect(links).toContain("/forms");
    expect(links).toContain("/landing-pages");
    expect(linksFor("owner", false, ["live_webinar"])).not.toContain("/landing-pages");
    expect(links).toContain("/settings");
    expect(hubLinksFor("owner", false, ["funnel_builder"])).toContain("/settings/features");
    expect(links).not.toContain("/lives");
    expect(links).not.toContain("/affiliates");
    expect(hubLinksFor("owner", false, ["funnel_builder"])).not.toContain("/billing/payouts");
  });

  it("hides every finance route from a non-finance member", () => {
    const links = linksFor("member");

    expect(links).not.toContain("/billing/usage");
    expect(links).not.toContain("/billing/payment-methods");
    expect(links).not.toContain("/billing/plans");
    expect(links).not.toContain("/billing/invoices");
    expect(links).not.toContain("/billing/settlements");
    expect(links).not.toContain("/billing/payouts");
    expect(links).not.toContain("/affiliates/commissions");
    expect(links).not.toContain("/billing/course-payouts");
  });

  it("shows platform operations and voluntary MFA setup to a platform administrator", () => {
    const links = linksFor(null, true);

    expect(links).toEqual([
      "/admin/billing/dashboard",
      "/admin/billing/stream-reconciliation",
      "/admin/billing/webhooks",
      "/admin/support-cases",
      "/admin/vendor-features",
      "/admin/merchant-invitations",
      "/admin/account-holds",
      "/admin/cloudflare/videos",
      "/mfa/setup",
    ]);
  });

  it("server-renders the owner shell with accessible desktop/mobile navigation and safe logout forms", () => {
    const html = renderShell({ memberRole: "owner", vendorName: "星光商務" });

    expect(html).toContain("星光商務");
    expect(html).toContain("shell content");
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('<main id="main-content" tabindex="-1"');
    expect(html).toContain('aria-label="主要導覽"');
    expect(html).toContain('aria-label="行動版主要導覽"');
    expect(html).toContain('href="/forms"');
    expect(html).toContain('href="/support-cases"');
    // Settings and billing pages collapse into the 設定 hub entry (sidebar, account menu, mobile).
    expect(html).toContain('href="/settings"');
    expect(html).toContain('href="/settings/security"');
    for (const href of ["/onboarding", "/settings/brand", "/settings/line", "/billing/invoices", "/affiliates/commissions", "/billing/course-payouts"]) {
      expect(html).not.toContain(`href="${href}"`);
    }
    expect(html).not.toContain("帳務與方案");
    expect(html).not.toContain("系統設定");
    expect(html).toContain("客服與付款協助");
    expect(html).toContain("服務條款與政策");
    expect(html).toContain('href="/policies"');
    expect(html).toContain('href="/support"');
    expect(html).toContain('class="mb-3 text-xs font-semibold text-slate-600"');
    expect(html).not.toContain('href="/admin/billing/dashboard"');
    expect((html.match(/name="csrfToken"/g) ?? [])).toHaveLength(2);
    expect((html.match(/>登出<\/button>/g) ?? [])).toHaveLength(2);
  });

  it.each([
    [true, false],
    [false, true],
  ])("keeps logout pending feedback scoped to one responsive form", (desktopPending, mobilePending) => {
    formStatuses.values = [
      { pending: desktopPending, data: null, action: null, method: null },
      { pending: mobilePending, data: null, action: null, method: null },
    ];

    const html = renderShell({ memberRole: "owner" });

    expect((html.match(/登出中…/g) ?? [])).toHaveLength(1);
    expect((html.match(/aria-busy="true"/g) ?? [])).toHaveLength(1);
    expect((html.match(/aria-busy="false"/g) ?? [])).toHaveLength(1);
    expect((html.match(/data-loading-indicator="true"/g) ?? [])).toHaveLength(1);
    expect((html.match(/正在結束目前登入並登出/g) ?? [])).toHaveLength(1);
    expect((html.match(/ disabled=""/g) ?? [])).toHaveLength(1);
  });

  it("server-renders platform-admin operations without vendor or affiliate navigation", () => {
    const html = renderShell({ memberRole: null, isPlatformAdmin: true, vendorName: "平台管理" });

    expect(html).toContain("平台管理");
    expect(html).toContain("shell content");
    expect(html).toContain('href="/admin/billing/dashboard"');
    expect(html).toContain('href="/admin/billing/stream-reconciliation"');
    expect(html).toContain('href="/admin/billing/webhooks"');
    expect(html).toContain('href="/admin/cloudflare/videos"');
    expect(html).toContain('href="/admin/support-cases"');
    expect(html).not.toContain('href="/forms"');
    expect(html).not.toContain('href="/settings/brand"');
    expect(html).not.toContain('href="/affiliates/commissions"');
    expect(html).toContain('<main id="main-content" tabindex="-1"');
    expect(html).toContain('aria-label="主要導覽"');
    expect(html).toContain('aria-label="行動版主要導覽"');
  });

  it("routes support logos to support cases without exposing manager or finance navigation", () => {
    const html = renderShell({ memberRole: "support" });

    expect((html.match(/href="\/support-cases"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('href="/settings/security"');
    expect(html).not.toContain('href="/dashboard"');
    expect(html).not.toContain('href="/orders"');
    expect(html).not.toContain('href="/billing/invoices"');
  });
});

describe("AppShell partner portal entry", () => {
  const portalLinks = (role: string | null, hasPartnerPortal: boolean, isPlatformAdmin = false) =>
    navigationForRole(role, isPlatformAdmin, undefined, { hasPartnerPortal }).flatMap((group) => group.items.map((item) => item.href));

  it("gives a partner nothing but the partner portal", () => {
    expect(portalLinks("partner", false)).toEqual(["/affiliate-portal"]);
    expect(portalLinks("partner", true)).toEqual(["/affiliate-portal"]);
    const html = renderShell({ memberRole: "partner" });
    expect(html).toContain('href="/affiliate-portal"');
    for (const href of ["/dashboard", "/support-cases", "/settings/security", "/orders", "/affiliates", "/billing/usage", "/partner-pages"]) {
      expect(html).not.toContain(`href="${href}"`);
    }
    expect(html).toContain("夥伴");
  });

  it.each(["owner", "admin", "accountant", "support"])("adds the portal for a %s only with a valid grant", (role) => {
    expect(portalLinks(role, false)).not.toContain("/affiliate-portal");
    expect(portalLinks(role, true)).toContain("/affiliate-portal");
    expect(renderShell({ memberRole: role })).not.toContain('href="/affiliate-portal"');
    expect(renderShell({ memberRole: role, hasPartnerPortal: false })).not.toContain('href="/affiliate-portal"');
    expect(renderShell({ memberRole: role, hasPartnerPortal: true })).toContain('href="/affiliate-portal"');
  });

  it("keeps support's queue and adds only the portal next to it", () => {
    expect(portalLinks("support", true)).toEqual(["/support-cases", "/settings", "/affiliate-portal"]);
  });

  it("adds only the portal for a legacy role with a grant, and nothing without a member or for the platform administrator", () => {
    // Legacy roles keep their (empty) back-office navigation; the grant adds just the portal.
    expect(portalLinks("member", false)).toEqual([]);
    expect(portalLinks("member", true)).toEqual(["/affiliate-portal"]);
    expect(portalLinks(null, true)).toEqual([]);
    expect(portalLinks(null, true, true)).not.toContain("/affiliate-portal");
  });
});

it("keeps every merchant navigation label aligned with its destination title", () => {
  const labels = navigationForRole("owner").flatMap((group) => group.items.map((item) => ({ href: item.href, label: item.label })));
  const componentTitles: Record<string, string> = { "/team-performance": "src/components/team-performance-dashboard.tsx" };
  for (const { href, label } of labels) {
    const filename = componentTitles[href] ?? `src/app/(app)${href}/page.tsx`;
    const source = readFileSync(path.join(process.cwd(), filename), "utf8");
    const titles = [...source.matchAll(/<PageHeader\b[^>]*?title="([^"]+)"/g)];
    expect(titles, `${href}: expected one literal PageHeader title`).toHaveLength(1);
    const title = titles[0][1];
    expect(title, href).toBe(label);
  }
  expect(labels).toMatchSnapshot();
});

describe("settings hub role and feature filtering", () => {
  const hubGroups = (role: string | null, isPlatformAdmin = false, modules?: readonly VendorFeatureModule[]) =>
    Object.fromEntries(settingsHubForRole(role, isPlatformAdmin, modules).map((group) => [group.label, group.items.map((item) => item.href)]));
  const allHubLinks = settingsGroups.flatMap((group) => group.items.map((item) => item.href));

  it("shows the owner every settings and billing page", () => {
    expect(hubLinksFor("owner")).toEqual(allHubLinks);
    expect(Object.keys(hubGroups("owner"))).toEqual(["帳號與安全", "工作區", "系統設定", "帳務與方案"]);
  });

  it("hides only the owner-only LINE page from an admin", () => {
    expect(hubLinksFor("admin")).toEqual(allHubLinks.filter((href) => href !== "/settings/line"));
  });

  it("gives an accountant billing pages and personal security, nothing else", () => {
    const groups = hubGroups("accountant");
    expect(Object.keys(groups)).toEqual(["帳號與安全", "帳務與方案"]);
    expect(groups["帳號與安全"]).toEqual(["/settings/security"]);
    expect(groups["帳務與方案"]).toHaveLength(9);
  });

  it("gives support only personal security", () => {
    expect(hubGroups("support")).toEqual({ "帳號與安全": ["/settings/security"] });
  });

  it("gives partners, platform administrators and unknown roles an empty hub", () => {
    expect(settingsHubForRole("partner")).toEqual([]);
    expect(settingsHubForRole("partner", false, ["billing"])).toEqual([]);
    expect(settingsHubForRole(null, true)).toEqual([]);
    expect(settingsHubForRole("owner", true)).toEqual([]);
    expect(settingsHubForRole("member")).toEqual([]);
    expect(settingsHubForRole(null)).toEqual([]);
  });

  it("drops pages whose module is disabled", () => {
    const withoutAny = hubLinksFor("owner", false, []);
    for (const href of ["/billing/usage", "/billing/payment-methods", "/billing/plans", "/billing/invoices", "/billing/settlements", "/billing/payouts", "/affiliates/commissions", "/billing/course-payouts"]) {
      expect(withoutAny, href).not.toContain(href);
    }
    // Pages without a feature gate stay available.
    expect(withoutAny).toEqual(expect.arrayContaining(["/billing/electronic-invoices", "/settings/security", "/settings/brand", "/onboarding", "/settings/features"]));

    const affiliateOnly = hubLinksFor("accountant", false, ["affiliate_program"]);
    expect(affiliateOnly).toContain("/affiliates/commissions");
    expect(affiliateOnly).not.toContain("/billing/course-payouts");
    expect(hubLinksFor("accountant", false, ["tax_remuneration"])).toEqual(expect.arrayContaining(["/billing/payouts", "/billing/course-payouts"]));
  });

  it("keeps an ungated billing page when every module is disabled", () => {
    expect(hubGroups("accountant", false, [])["帳務與方案"]).toEqual(["/billing/electronic-invoices"]);
  });

  it("only offers the sidebar entry when the hub has a page to show", () => {
    expect(linksFor("owner")).toContain("/settings");
    expect(linksFor("member")).not.toContain("/settings");
    expect(linksFor(null, true)).not.toContain("/settings");
    expect(navigationForRole("partner")).toEqual([expect.objectContaining({ label: "夥伴入口" })]);
  });

  it("keeps every hub label aligned with its destination title", () => {
    for (const { href, label } of settingsGroups.flatMap((group) => group.items)) {
      const source = readFileSync(path.join(process.cwd(), `src/app/(app)${href}/page.tsx`), "utf8");
      const titles = [...source.matchAll(/<PageHeader\b[^>]*?\btitle="([^"]+)"/g)].map((match) => match[1]);
      expect(titles, href).toContain(label);
    }
  });

  it("describes every hub page", () => {
    for (const item of settingsGroups.flatMap((group) => group.items)) expect(item.description?.length, item.href).toBeGreaterThan(0);
  });
});
