export const FUNNEL_VISITOR_COOKIE = "celebratedeal_funnel_visitor";
const VISITOR_ID_PATTERN = /^[A-Za-z0-9-]{20,100}$/u;

/** This pseudonym is intentionally not an authentication or authorization token. */
export function isFunnelVisitorId(value: string | undefined | null): value is string {
  return Boolean(value && VISITOR_ID_PATTERN.test(value));
}

/**
 * Funnel visits use their own proxy-issued pseudonym. Do not reuse the older
 * team-attribution visitor cookie here: it would create a fresh ID and break
 * the server-owned visit-to-submission binding.
 */
export function funnelVisitorIdFromRequest(request: Pick<Request, "headers">): string | null {
  const prefix = `${FUNNEL_VISITOR_COOKIE}=`;
  for (const segment of (request.headers.get("cookie") ?? "").split(";")) {
    const value = segment.trim();
    if (!value.startsWith(prefix)) continue;
    try {
      const decoded = decodeURIComponent(value.slice(prefix.length));
      return isFunnelVisitorId(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }
  return null;
}
