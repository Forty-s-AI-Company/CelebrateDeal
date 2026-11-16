import { describe, expect, it } from "vitest";
import { navigationForRole, settingsHubForRole } from "@/lib/app-navigation";
import { paletteEntriesFromNavigation, searchPaletteEntries } from "@/lib/command-palette";
import type { GatedFeature } from "@/lib/vendor-feature-toggles";

function entriesFor(role: string | null, isPlatformAdmin = false, modules?: readonly GatedFeature[], hasPartnerPortal = false) {
  return paletteEntriesFromNavigation(
    navigationForRole(role, isPlatformAdmin, modules, { hasPartnerPortal }),
    settingsHubForRole(role, isPlatformAdmin, modules),
  );
}
const hrefs = (role: string | null, isPlatformAdmin = false, modules?: readonly GatedFeature[]) => entriesFor(role, isPlatformAdmin, modules).map((entry) => entry.href);

describe("command palette entries", () => {
  it("offers exactly the sidebar pages plus the settings hub pages the member may open", () => {
    for (const role of ["owner", "admin", "accountant", "support", "partner", "member", null]) {
      const expected = new Set([
        ...navigationForRole(role).flatMap((group) => group.items.map((item) => item.href)),
        ...settingsHubForRole(role).flatMap((group) => group.items.map((item) => item.href)),
      ]);
      expect(new Set(hrefs(role)), String(role)).toEqual(expected);
    }
  });

  it("never lists a page twice", () => {
    const owner = hrefs("owner");
    expect(new Set(owner).size).toBe(owner.length);
  });

  it("hides manager, owner and finance pages from roles without access", () => {
    const accountant = hrefs("accountant");
    expect(accountant).toContain("/billing/invoices");
    for (const href of ["/orders", "/forms", "/landing-pages", "/settings/brand", "/settings/line", "/admin/billing/dashboard"]) expect(accountant, href).not.toContain(href);
    expect(hrefs("admin")).not.toContain("/settings/line");
    expect(hrefs("owner")).toContain("/settings/line");
    expect(hrefs("support")).toEqual(["/support-cases", "/settings", "/settings/security"]);
    expect(hrefs("member")).toEqual([]);
  });

  it("honours disabled feature modules", () => {
    expect(hrefs("owner", false, [])).not.toContain("/lives");
    expect(hrefs("owner", false, [])).not.toContain("/billing/plans");
    expect(hrefs("owner", false, ["live_webinar"])).toContain("/lives");
  });

  it("gives a platform administrator only platform pages", () => {
    const admin = hrefs(null, true);
    expect(admin).toContain("/admin/billing/dashboard");
    expect(admin.filter((href) => !href.startsWith("/admin/") && href !== "/mfa/setup")).toEqual([]);
  });

  it("labels settings pages with their hub section and includes the partner portal only with a grant", () => {
    const brand = entriesFor("owner").find((entry) => entry.href === "/settings/brand");
    expect(brand).toMatchObject({ label: "品牌設定", group: "設定 › 工作區" });
    expect(entriesFor("owner").some((entry) => entry.href === "/affiliate-portal")).toBe(false);
    expect(entriesFor("owner", false, undefined, true).some((entry) => entry.href === "/affiliate-portal")).toBe(true);
  });
});

describe("searchPaletteEntries", () => {
  const entries = entriesFor("owner");
  const search = (query: string) => searchPaletteEntries(entries, query).map((entry) => entry.href);

  it("lists everything for an empty query", () => {
    expect(search("")).toHaveLength(entries.length);
    expect(search("   ")).toHaveLength(entries.length);
  });

  it("matches Chinese substrings in the label", () => {
    expect(search("訂單")).toContain("/orders");
    expect(search("直播")).toContain("/lives");
    expect(search("夠不到的頁面")).toEqual([]);
  });

  it("ranks label prefix matches first", () => {
    expect(search("訂單")[0]).toBe("/orders");
    expect(search("設定")[0]).toBe("/settings");
  });

  it("ignores case, width and spaces, and matches the group name", () => {
    expect(search("crm")).toContain("/customers");
    expect(search("ＣＲＭ")).toContain("/customers");
    expect(search("學員crm")).toContain("/customers");
    expect(search("夥伴成長")).toContain("/affiliates");
  });

  it("matches the settings hub description", () => {
    expect(search("Pixel")).toContain("/settings/tracking");
  });
});
