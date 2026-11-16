/**
 * Where each 上線任務 (onboarding task) sends the merchant. Exact task keys only:
 * substring matching let unrelated keys collide, and an unknown key must fall back
 * to the onboarding overview instead of an arbitrary editor.
 *
 * `project_funnel` points at /forms/new and is titled 建立報名表單 in both flows: the
 * task (and the project publish gate in `publishSalesProjectAction`) is completed by an
 * active registration form in the project (`hasFunnelTemplate`, loaded in
 * `merchant-onboarding-data.ts`). Re-checked for U1: a landing page creates such a form
 * only when an audience Funnel is published independently (`ensureAudienceLeadForm`),
 * so a funnel-template link would neither match the gate nor complete the task.
 * `onboarding-task-links.test.ts` checks every href against the real routes in src/app.
 */
export const ONBOARDING_TASK_FALLBACK_HREF = "/onboarding";

export const ONBOARDING_TASK_HREFS: Readonly<Record<string, string>> = {
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
  // Preview and publish both happen on the project page; /onboarding would only link to itself.
  if ((taskKey === "project_publish" || taskKey === "project_preview") && selectedProjectId) return `/projects/${encodeURIComponent(selectedProjectId)}`;
  return Object.hasOwn(ONBOARDING_TASK_HREFS, taskKey) ? ONBOARDING_TASK_HREFS[taskKey]! : ONBOARDING_TASK_FALLBACK_HREF;
}

export const KNOWN_ONBOARDING_TASK_HREF_KEYS: readonly string[] = Object.keys(ONBOARDING_TASK_HREFS);
