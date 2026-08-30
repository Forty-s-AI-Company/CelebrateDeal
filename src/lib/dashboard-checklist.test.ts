import { describe, expect, it } from "vitest";
import {
  dashboardChecklistForRole,
  filterDashboardChecklistForRole,
  isDashboardManagerRole,
  type DashboardChecklistCounts,
} from "@/lib/dashboard-checklist";

const counts: DashboardChecklistCounts = {
  productCount: 1,
  liveCount: 0,
  interactionRoleCount: 1,
  interactionScriptCount: 0,
  trackingConfigured: true,
  verifiedPaymentMethodCount: 0,
  onboardingComplete: false,
};

describe("dashboardChecklistForRole", () => {
  it.each(["owner", "admin"])("identifies %s as a dashboard manager", (role) => {
    expect(isDashboardManagerRole(role)).toBe(true);
  });

  it.each(["accountant", "member", null])(
    "does not identify non-manager role %s as a dashboard manager",
    (role) => {
      expect(isDashboardManagerRole(role)).toBe(false);
    },
  );

  it.each(["owner", "admin"])("keeps manager-only setup links for %s", (role) => {
    expect(dashboardChecklistForRole(counts, role).map((item) => item.href)).toEqual([
      "/products/new",
      "/lives/new",
      "/interaction-roles/new",
      "/interaction-scripts/new",
      "/settings/tracking",
      "/billing/payment-methods",
      "/onboarding",
    ]);
  });

  it("reflects real onboarding completion instead of a permanently false item", () => {
    const item = dashboardChecklistForRole({ ...counts, onboardingComplete: true }, "owner")
      .find((candidate) => candidate.href === "/onboarding");

    expect(item).toMatchObject({ label: "完成商家 onboarding", done: true });
  });

  it.each(["accountant", "member", null])(
    "removes manager-only setup links for non-manager role %s",
    (role) => {
      expect(dashboardChecklistForRole(counts, role)).toEqual([]);
    },
  );

  it("does not remove a checklist item that is not manager-only", () => {
    const publicItem = { label: "查看個人設定", href: "/settings/security", done: false };
    const managerItem = {
      label: "建立互動角色",
      href: "/interaction-roles/new",
      done: false,
      managerOnly: true,
    };

    expect(filterDashboardChecklistForRole([publicItem, managerItem], "accountant")).toEqual([
      publicItem,
    ]);
  });
});
