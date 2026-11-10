/**
 * Where each 上線任務 (onboarding task) sends the merchant. Exact task keys only:
 * substring matching let unrelated keys collide, and an unknown key must fall back
 * to the onboarding overview instead of an arbitrary editor.
 *
 * `project_funnel` intentionally points at /forms/new: the task is completed (and the
 * project publish gate is satisfied) by an active registration form in the project,
 * see `hasFunnelTemplate` in the app layout. Landing pages only create such a form on
 * independent publish, so linking there would not complete the task.
 */
export const ONBOARDING_TASK_FALLBACK_HREF = "/onboarding";

const TASK_HREFS: Readonly<Record<string, string>> = {
  workspace_profile: "/settings/brand",
  workspace_logo: "/settings/brand",
  workspace_support: "/settings/brand",
  workspace_payment: "/billing/payment-methods",
  workspace_team: "/settings/team",
  workspace_test_order: ONBOARDING_TASK_FALLBACK_HREF,
  project_created: ONBOARDING_TASK_FALLBACK_HREF,
  project_product: "/products/new",
  project_price: "/products/new",
  project_funnel: "/forms/new",
  project_live: "/lives/new",
  project_consultation: "/consultations",
  project_availability: "/consultations",
  project_payment: "/billing/payment-methods",
  project_preview: ONBOARDING_TASK_FALLBACK_HREF,
  project_publish: ONBOARDING_TASK_FALLBACK_HREF,
};

const PAYMENT_TASK_KEYS: ReadonlySet<string> = new Set(["workspace_payment", "project_payment"]);

export function isPaymentOnboardingTask(taskKey: string) {
  return PAYMENT_TASK_KEYS.has(taskKey);
}

export function onboardingTaskHref(taskKey: string, selectedProjectId: string | null) {
  if (taskKey === "project_publish" && selectedProjectId) return `/projects/${encodeURIComponent(selectedProjectId)}`;
  return Object.hasOwn(TASK_HREFS, taskKey) ? TASK_HREFS[taskKey]! : ONBOARDING_TASK_FALLBACK_HREF;
}

export const KNOWN_ONBOARDING_TASK_HREF_KEYS: readonly string[] = Object.keys(TASK_HREFS);
