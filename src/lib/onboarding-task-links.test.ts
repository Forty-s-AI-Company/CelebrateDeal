import { describe, expect, it } from "vitest";
import { CONSULTATION_PROJECT_TASKS, LIVE_PROJECT_TASKS, WORKSPACE_ONBOARDING_TASKS } from "./sales-workspace";
import { isPaymentOnboardingTask, KNOWN_ONBOARDING_TASK_HREF_KEYS, ONBOARDING_TASK_FALLBACK_HREF, onboardingTaskHref } from "./onboarding-task-links";

const allKeys = [...new Set([...WORKSPACE_ONBOARDING_TASKS, ...LIVE_PROJECT_TASKS, ...CONSULTATION_PROJECT_TASKS].map((task) => task.key))];

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
    ["project_preview", "/onboarding"],
  ])("%s -> %s", (key, href) => {
    expect(onboardingTaskHref(key, "p1")).toBe(href);
    expect(onboardingTaskHref(key, null)).toBe(href);
  });

  it("sends project_publish to the selected project, else the overview", () => {
    expect(onboardingTaskHref("project_publish", "p 1")).toBe("/projects/p%201");
    expect(onboardingTaskHref("project_publish", null)).toBe("/onboarding");
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
