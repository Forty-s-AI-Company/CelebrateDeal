import { parseFunnelOperations } from "@/lib/funnel-operations";
import type { FunnelTypographyViewport } from "@/lib/funnel-typography";

/**
 * Server-side hints for the public funnel render (I-1, I-5). Both only
 * affect presentation: the registration deadline is still enforced by
 * `resolveFunnelDeadline` before any form or checkout write.
 */

/**
 * First-paint viewport guessed from the User-Agent, so phones and tablets get
 * their layout in the server HTML instead of switching after hydration
 * (layout shift). The client corrects it with matchMedia right after mount.
 */
export function funnelViewportHint(userAgent: string | null | undefined): FunnelTypographyViewport {
  const ua = userAgent ?? "";
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/iu.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/iu.test(ua)) return "mobile";
  return "desktop";
}

/** Registration deadline (only when enabled) and the server render time. */
export function funnelPublicRenderEvent(operations: unknown, now: number = Date.now()): { registrationClosesAt: string | null; renderedAt: number } {
  const deadline = parseFunnelOperations(operations)?.deadline;
  const closes = deadline?.enabled && deadline.expiresAt && Number.isFinite(Date.parse(deadline.expiresAt)) ? new Date(deadline.expiresAt).toISOString() : null;
  return { registrationClosesAt: closes, renderedAt: now };
}
