import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONSULTATION_PROJECT_TASKS, LIVE_PROJECT_TASKS, WORKSPACE_ONBOARDING_TASKS } from "./sales-workspace";
import { isPaymentOnboardingTask, KNOWN_ONBOARDING_TASK_HREF_KEYS, ONBOARDING_TASK_FALLBACK_HREF, ONBOARDING_TASK_HREFS, onboardingTaskHref } from "./onboarding-task-links";
import { merchantOnboardingOutline, merchantOnboardingProgress } from "./merchant-onboarding";

const allTasks = [...WORKSPACE_ONBOARDING_TASKS, ...LIVE_PROJECT_TASKS, ...CONSULTATION_PROJECT_TASKS];
const allKeys = [...new Set(allTasks.map((task) => task.key))];

/**
 * Every page route under src/app as segment patterns. Route groups add no URL
 * segment; parallel slots (`@checkout`, with its catch-all default) and
 * intercepting routes only render inside real routes, so they are skipped.
 */
function appPageRoutes() {
  const appDir = path.resolve(__dirname, "../app");
  const routes: string[][] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const name = entry.name;
        if (name.startsWith("_") || name.startsWith("@") || name.startsWith("(.")) continue;
        const grouped = name.startsWith("(") && name.endsWith(")");
        walk(path.join(dir, name), grouped ? segments : [...segments, name]);
      } else if (/^page\.(tsx|ts|jsx|js|mdx)$/u.test(entry.name)) {
        routes.push(segments);
      }
    }
  };
  walk(appDir, []);
  return routes;
}

const ROUTES = appPageRoutes();

function routeExists(href: string) {
  const [pathname] = href.split(/[?#]/u);
  const parts = pathname!.split("/").filter(Boolean).map(decodeURIComponent);
  return ROUTES.some((route) => {
    if (route.some((segment) => segment.startsWith("[..."))) {
      const fixed = route.findIndex((segment) => segment.startsWith("[..."));
      return parts.length > fixed && route.slice(0, fixed).every((segment, index) => segment.startsWith("[") || segment === parts[index]);
    }
    return route.length === parts.length && route.every((segment, index) => (segment.startsWith("[") && segment.endsWith("]")) || segment === parts[index]);
  });
}

describe("onboardingTaskHref", () => {
  it("has an explicit entry for every defined task key and no stale entries", () => {
    expect([...KNOWN_ONBOARDING_TASK_HREF_KEYS].sort()).toEqual([...allKeys].sort());
  });

  it.each([
    ["workspace_profile", "/settings/brand"],
    ["workspace_logo", "/settings/brand"],
    ["workspace_support", "/settings/brand"],
    ["workspace_payment", "/billing/payment-methods"],
    ["workspace_team", "/settings/team"],
    ["workspace_test_order", "/onboarding"],
    ["project_created", "/onboarding"],
    ["project_product", "/products/new"],
    ["project_price", "/products/new"],
    ["project_funnel", "/forms/new"],
    ["project_live", "/lives/new"],
    ["project_consultation", "/consultations"],
    ["project_availability", "/consultations"],
    ["project_payment", "/billing/payment-methods"],
  ])("%s -> %s", (key, href) => {
    expect(onboardingTaskHref(key, "p1")).toBe(href);
    expect(onboardingTaskHref(key, null)).toBe(href);
  });

  it.each(["project_publish", "project_preview"])("sends %s to the selected project page, else the overview", (key) => {
    expect(onboardingTaskHref(key, "p 1")).toBe("/projects/p%201");
    expect(onboardingTaskHref(key, null)).toBe("/onboarding");
  });

  it("does not match unknown keys by substring", () => {
    for (const key of ["funnel", "my_form_funnel", "payment_live", "unknown", "constructor", "__proto__"]) {
      expect(onboardingTaskHref(key, null)).toBe(ONBOARDING_TASK_FALLBACK_HREF);
    }
  });

  it("identifies payment tasks exactly", () => {
    expect(allKeys.filter(isPaymentOnboardingTask).sort()).toEqual(["project_payment", "workspace_payment"]);
    expect(isPaymentOnboardingTask("payment_extra")).toBe(false);
  });
});

describe("task names match where their links go", () => {
  // The title tells the merchant what the linked page lets them do.
  it.each([
    ["project_funnel", "建立報名表單", "/forms/new"],
    ["project_product", "建立商品", "/products/new"],
    ["project_price", "設定價格", "/products/new"],
    ["project_live", "設定直播場次", "/lives/new"],
    ["project_consultation", "建立諮詢服務", "/consultations"],
    ["project_availability", "設定可預約時間", "/consultations"],
    ["project_payment", "檢查發布所需付款驗證", "/billing/payment-methods"],
    ["workspace_payment", "驗證平台服務付款方式", "/billing/payment-methods"],
    ["workspace_team", "邀請團隊成員", "/settings/team"],
  ])("%s is「%s」and opens %s", (key, title, href) => {
    const titles = new Set(allTasks.filter((task) => task.key === key).map((task) => task.title));
    expect([...titles]).toEqual([title]);
    expect(onboardingTaskHref(key, "p1")).toBe(href);
  });

  it("never calls the registration-form task a funnel template", () => {
    for (const task of allTasks.filter((item) => item.key === "project_funnel")) {
      expect(task.title).not.toMatch(/漏斗|模板/u);
    }
  });
});

describe("every onboarding link opens a real route in src/app", () => {
  it("can tell a real route from a missing one", () => {
    expect(routeExists("/forms/new")).toBe(true);
    expect(routeExists("/projects/any-id")).toBe(true);
    // /forms/[id] would accept "/forms/create", so the misses below use paths no segment can match.
    expect(routeExists("/settings/profile")).toBe(false);
    expect(routeExists("/registration-forms")).toBe(false);
    expect(routeExists("/onboarding/funnel-template")).toBe(false);
  });

  it.each(Object.entries(ONBOARDING_TASK_HREFS))("task %s -> %s", (_key, href) => {
    expect(routeExists(href)).toBe(true);
  });

  it.each(allKeys)("task %s with a selected project", (key) => {
    expect(routeExists(onboardingTaskHref(key, "synthetic-project"))).toBe(true);
  });

  it("every step, requirement and suggestion of the unified list", () => {
    const hrefs = new Set<string>();
    for (const signals of [0, 1]) {
      const progress = merchantOnboardingProgress({
        supportEmailConfigured: Boolean(signals), verifiedVendorPaymentMethodCount: signals, sellableProductCount: signals,
        activeFormCount: signals, activeInteractionRoleCount: signals, publishedInteractionScriptCount: signals,
        registrationEmailTemplateCount: signals, sellableLiveCount: signals, readyVideoCount: signals, trackingConfigured: Boolean(signals),
      });
      for (const step of progress.steps) {
        hrefs.add(step.href);
        for (const item of [...step.requirements, ...(step.suggestions ?? [])]) if (item.href) hrefs.add(item.href);
      }
    }
    for (const step of merchantOnboardingOutline()) hrefs.add(step.href);
    expect(hrefs.size).toBeGreaterThan(5);
    expect([...hrefs].filter((href) => !routeExists(href))).toEqual([]);
  });
});
