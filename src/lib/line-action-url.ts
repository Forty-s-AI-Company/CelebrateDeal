/**
 * Whether LINE accepts `uri` as a button link: an absolute HTTPS URL. An http
 * deployment (local, e2e) builds http links, which never are; in production
 * only a link from outside the app can be (an http booking meeting URL).
 * Shared by the LINE message builders (line-notification.ts) and the
 * automation engine, which records such a message as skipped (A2-09); kept
 * free of imports so either side can use it without loading the other.
 */
export function isLineActionUrl(uri: string) {
  try {
    return new URL(uri).protocol === "https:";
  } catch {
    return false;
  }
}
