import type { LandingPageRenderContext } from "@/lib/landing-page-content";

/**
 * Server records a registration button needs at render time. Public pages get
 * them from the published version (forms validated for the page's vendor,
 * project and active state); the editor gets the project's active forms and
 * the draft's selected live.
 */
export type FunnelRegistrationLinks = {
  /** Landing page id, sent as the `lp` attribution parameter on public pages. */
  pageId?: string;
  forms: ReadonlyArray<{ id: string; slug: string; name?: string }>;
  live?: { id: string; formId?: string; title?: string };
};

export const EMPTY_REGISTRATION_LINKS: FunnelRegistrationLinks = { forms: [] };

/**
 * Hosted-form URL for a `registration` action, or null when the form is not
 * among the server-provided forms. The slug and live are never taken from the
 * stored document, so renaming a form or re-binding the live is followed.
 */
export function funnelRegistrationHref(action: { formId: string; useBoundLive?: boolean }, links: FunnelRegistrationLinks): string | null {
  const form = links.forms.find((candidate) => candidate.id === action.formId);
  if (!form) return null;
  // Same rule as the legacy renderer: carry the bound live only when it registers through this form.
  const live = action.useBoundLive !== false && links.live?.formId === action.formId ? links.live : undefined;
  return `/form/${encodeURIComponent(form.slug)}${live ? `?liveId=${encodeURIComponent(live.id)}` : ""}`;
}

export const BOUND_LIVE_FORM_RULE = "這個頁面已綁定活動場次，所有報名按鈕都必須使用該場次的報名表。";

/**
 * Forms a registration button may use. With a bound live the server requires
 * every referenced form to be that live's form (`landing_page_live_form_mismatch`),
 * so only that form is offered.
 */
export function registrationFormChoices(links: FunnelRegistrationLinks): FunnelRegistrationLinks["forms"] {
  if (!links.live) return links.forms;
  return links.forms.filter((form) => form.id === links.live?.formId);
}

/** The minimum of the public render context a browser needs for registration links. */
export function publicRegistrationLinks(context: LandingPageRenderContext): FunnelRegistrationLinks {
  return {
    ...(context.pageId ? { pageId: context.pageId } : {}),
    forms: context.forms.map((form) => ({ id: form.id, slug: form.slug })),
    ...(context.live ? { live: { id: context.live.id, ...(context.live.formId ? { formId: context.live.formId } : {}) } } : {}),
  };
}
