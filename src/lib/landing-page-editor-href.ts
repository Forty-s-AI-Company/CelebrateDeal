/** Canonical URL of the full-screen landing page editor for one funnel step. */
export function landingPageEditorHref(id: string, step?: string | string[] | null) {
  const requested = typeof step === "string" ? step.trim() : "";
  return `/landing-pages/${encodeURIComponent(id)}/edit${requested ? `?step=${encodeURIComponent(requested)}` : ""}`;
}
