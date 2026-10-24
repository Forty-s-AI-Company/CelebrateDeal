/**
 * True on the full-screen editor route (`src/app/(editor)/landing-pages/[id]/edit`).
 * Global floating chrome (e.g. the 最新消息 launcher) stays out of that canvas.
 */
export function isLandingPageEditorPath(pathname: string | null | undefined) {
  return /^\/landing-pages\/[^/]+\/edit\/?$/u.test(pathname ?? "");
}

/** Canonical URL of the full-screen landing page editor for one funnel step. */
export function landingPageEditorHref(id: string, step?: string | string[] | null) {
  const requested = typeof step === "string" ? step.trim() : "";
  return `/landing-pages/${encodeURIComponent(id)}/edit${requested ? `?step=${encodeURIComponent(requested)}` : ""}`;
}
