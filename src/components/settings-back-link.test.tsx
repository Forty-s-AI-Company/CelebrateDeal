import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/settings/brand" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { SettingsBackLink } from "./settings-back-link";
import { isNavPathActive } from "@/lib/nav-active";
import { navigationForRole } from "@/lib/app-navigation";

describe("SettingsBackLink", () => {
  beforeEach(() => {
    nav.pathname = "/settings/brand";
  });

  it.each(["/settings/brand", "/billing/invoices/inv-1", "/affiliates/commissions/c-1", "/onboarding"])("links back to the hub from %s", (pathname) => {
    nav.pathname = pathname;
    const html = renderToStaticMarkup(<SettingsBackLink />);

    expect(html).toContain('href="/settings"');
    expect(html).toContain('aria-label="返回設定"');
    expect(html).toContain("設定");
  });

  it("does not link the hub to itself", () => {
    nav.pathname = "/settings";
    expect(renderToStaticMarkup(<SettingsBackLink />)).toBe("");
  });
});

describe("settings hub sidebar highlighting", () => {
  const entry = navigationForRole("owner").flatMap((group) => group.items).find((item) => item.href === "/settings")!;

  it.each(["/settings", "/settings/security", "/billing/usage", "/billing/invoices/inv-1", "/onboarding", "/affiliates/commissions", "/affiliates/commissions/c-1"])("is active on %s", (pathname) => {
    expect(isNavPathActive(pathname, entry.href, entry.activePrefixes)).toBe(true);
  });

  it.each(["/dashboard", "/orders", "/billing-help", "/settingsx"])("is not active on %s", (pathname) => {
    expect(isNavPathActive(pathname, entry.href, entry.activePrefixes)).toBe(false);
  });
});
