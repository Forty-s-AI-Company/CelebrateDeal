import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ logoutAction: vi.fn() }));
vi.mock("@/app/actions", () => ({ logoutAction: mocks.logoutAction }));
vi.mock("@/components/csrf-field", () => ({
  CsrfField: () => createElement("input", { type: "hidden", name: "csrfToken", value: "synthetic-csrf-token" }),
}));

import { navigationForRole } from "./app-shell";
import { AppShell } from "./app-shell";

function linksFor(role: string | null, isPlatformAdmin = false) {
  return navigationForRole(role, isPlatformAdmin).flatMap((group) => group.items.map((item) => item.href));
}

function renderShell({ memberRole, isPlatformAdmin = false, vendorName = "測試商家" }: { memberRole: string | null; isPlatformAdmin?: boolean; vendorName?: string }) {
  const props = { memberRole, isPlatformAdmin, vendorName } as Parameters<typeof AppShell>[0];
  return renderToStaticMarkup(createElement(AppShell, props, createElement("p", null, "shell content") as ReactNode));
}

describe("AppShell role navigation", () => {
  it("keeps accountant navigation tenant-scoped and read-oriented", () => {
    const links = linksFor("accountant");

    expect(links).toContain("/billing/invoices");
    expect(links).toContain("/affiliates/commissions");
    expect(links).toContain("/team-performance");
    expect(links).not.toContain("/forms");
    expect(links).not.toContain("/settings/brand");
    expect(links).not.toContain("/admin/billing/dashboard");
  });

  it.each(["owner", "admin"])("shows operational tools to a vendor %s without platform routes", (role) => {
    const links = linksFor(role);

    expect(links).toContain("/forms");
    expect(links).toContain("/settings/brand");
    expect(links).not.toContain("/admin/billing/dashboard");
  });

  it("hides every finance route from a non-finance member", () => {
    const links = linksFor("member");

    expect(links).not.toContain("/billing/usage");
    expect(links).not.toContain("/billing/plans");
    expect(links).not.toContain("/billing/invoices");
    expect(links).not.toContain("/billing/settlements");
    expect(links).not.toContain("/billing/payouts");
    expect(links).not.toContain("/affiliates/commissions");
  });

  it("shows only platform operations to a platform administrator", () => {
    const links = linksFor(null, true);

    expect(links).toEqual([
      "/admin/billing/dashboard",
      "/admin/billing/webhooks",
      "/admin/cloudflare/videos",
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
    expect(html).toContain('href="/billing/invoices"');
    expect(html).toContain('href="/affiliates/commissions"');
    expect(html).not.toContain('href="/admin/billing/dashboard"');
    expect((html.match(/name="csrfToken"/g) ?? [])).toHaveLength(2);
    expect((html.match(/>登出<\/button>/g) ?? [])).toHaveLength(2);
  });

  it("server-renders platform-admin operations without vendor or affiliate navigation", () => {
    const html = renderShell({ memberRole: null, isPlatformAdmin: true, vendorName: "平台管理" });

    expect(html).toContain("平台管理");
    expect(html).toContain("shell content");
    expect(html).toContain('href="/admin/billing/dashboard"');
    expect(html).toContain('href="/admin/billing/webhooks"');
    expect(html).toContain('href="/admin/cloudflare/videos"');
    expect(html).not.toContain('href="/forms"');
    expect(html).not.toContain('href="/settings/brand"');
    expect(html).not.toContain('href="/affiliates/commissions"');
    expect(html).toContain('<main id="main-content" tabindex="-1"');
    expect(html).toContain('aria-label="主要導覽"');
    expect(html).toContain('aria-label="行動版主要導覽"');
  });
});
