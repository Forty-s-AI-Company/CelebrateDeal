/**
 * Largest serialized landing-page content (`LandingPage.draftContent`) the
 * editor may store. `landingPageAction` checks the submitted JSON; the
 * template service checks the content it builds on the server against the
 * same number, so a template cannot grow a draft past what the editor accepts.
 */
// Custom code nodes may hold up to 50 KB HTML + 20 KB CSS + 50 KB JS each (JSON-escaped here).
export const LANDING_PAGE_MAX_CONTENT_BYTES = 512 * 1024;

/** UTF-8 size of the JSON that would be stored, measured like the action measures its form field. */
export function landingPageContentBytes(content: unknown) {
  return new TextEncoder().encode(JSON.stringify(content)).length;
}
