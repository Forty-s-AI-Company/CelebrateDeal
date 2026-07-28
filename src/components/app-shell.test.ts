import { describe, expect, it } from "vitest";
import { navigationForRole } from "./app-shell";

function linksFor(role: string | null, isPlatformAdmin = false) {
  return navigationForRole(role, isPlatformAdmin).flatMap((group) => group.items.map((item) => item.href));
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
});
