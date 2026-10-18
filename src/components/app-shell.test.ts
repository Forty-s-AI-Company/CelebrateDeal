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
import type { VendorFeatureModule } from "@/lib/vendor-feature-toggles";
import { AppShell } from "./app-shell";

function linksFor(role: string | null, isPlatformAdmin = false, enabledModules?: readonly VendorFeatureModule[]) {
  return navigationForRole(role, isPlatformAdmin, enabledModules).flatMap((group) => group.items.map((item) => item.href));
}

function renderShell({ memberRole, isPlatformAdmin = false, vendorName = "測試商家" }: { memberRole: string | null; isPlatformAdmin?: boolean; vendorName?: string }) {
  formStatuses.cursor = 0;
  const props = { memberRole, isPlatformAdmin, vendorName } as Parameters<typeof AppShell>[0];
  return renderToStaticMarkup(createElement(AppShell, props, createElement("p", null, "shell content") as ReactNode));
}

beforeEach(() => {
  formStatuses.cursor = 0;
  formStatuses.values = [];
});

describe("AppShell role navigation", () => {
  it("exposes LINE only to the owner allowed by the existing settings page", () => {
    expect(linksFor("owner")).toContain("/settings/line");
    for (const role of ["admin", "accountant", "support", "member", null]) {
      expect(linksFor(role)).not.toContain("/settings/line");
    }
    expect(linksFor(null, true)).not.toContain("/settings/line");
    expect(renderShell({ memberRole: "owner" })).toContain('href="/settings/line"');
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
    const links = new Set(["owner", "admin", "accountant", "support"].flatMap((role) => linksFor(role))
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

    expect(links).toContain("/billing/invoices");
    expect(links).toContain("/billing/payment-methods");
    expect(links).toContain("/affiliates/commissions");
    expect(links).toContain("/billing/course-payouts");
    expect(links).toContain("/team-performance");
    expect(links).not.toContain("/forms");
    expect(links).not.toContain("/landing-pages");
    expect(links).not.toContain("/settings/brand");
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
    expect(linksFor("support")).toEqual(["/support-cases", "/settings/security"]);
  });

  it("defaults unknown member roles to no navigation", () => {
    expect(linksFor("member")).toEqual([]);
    expect(linksFor(null)).toEqual([]);
  });

  it.each(["owner", "admin"])("shows operational tools to a vendor %s without platform routes", (role) => {
    const links = linksFor(role);

    expect(links).toContain("/forms");
    expect(links).toContain("/landing-pages");
    expect(links).toContain("/onboarding");
    expect(links).toContain("/settings/brand");
    expect(links).toContain("/settings/automations");
    expect(links).not.toContain("/admin/billing/dashboard");
  });

  it("filters feature-owned navigation while keeping the module settings entry", () => {
    const links = linksFor("owner", false, ["funnel_builder"]);

    expect(links).toContain("/forms");
    expect(links).toContain("/landing-pages");
    expect(linksFor("owner", false, ["live_webinar"])).not.toContain("/landing-pages");
    expect(links).toContain("/settings/features");
    expect(links).not.toContain("/lives");
    expect(links).not.toContain("/affiliates");
    expect(links).not.toContain("/billing/payouts");
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
    expect(html).toContain('href="/onboarding"');
    expect(html).toContain('href="/support-cases"');
    expect(html).toContain('href="/billing/invoices"');
    expect(html).toContain('href="/affiliates/commissions"');
    expect(html).toContain('href="/billing/course-payouts"');
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
    expect((html.match(/正在撤銷目前 session 並登出/g) ?? [])).toHaveLength(1);
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
