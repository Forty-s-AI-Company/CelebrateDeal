/**
 * Server-side reveal of evergreen offers (優惠／CTA／商品聚焦).
 *
 * A public evergreen page only ships the offers whose trigger second the
 * visitor's own server-computed session has already reached. Later offers are
 * withheld from the payload; the page only learns the next reveal second and
 * refreshes when its session clock gets there, so editing client state or the
 * video position cannot reveal them early.
 */

export const EVERGREEN_PITCH_EVENT_ID = "evergreen-pitch";
export const EVERGREEN_CONSULTATION_EVENT_ID = "evergreen-consultation";
export const EVERGREEN_CONSULTATION_EVENT_TYPE = "evergreen_consultation";

const OFFER_EVENT_TYPES = new Set(["product_spotlight", "cta_switch", EVERGREEN_CONSULTATION_EVENT_TYPE]);

/**
 * These interactions run as one shared LiveInteractionRun per live with a
 * window derived from the live's scheduledAt; they cannot follow per-visitor
 * evergreen sessions, so evergreen pages do not offer them.
 */
export const EVERGREEN_UNSUPPORTED_EVENT_TYPES = new Set(["lucky_draw", "poll", "flash_voucher", "flash_sale"]);

type TimelineEvent = { eventType: string; triggerSec: number; productId: string | null };

/** "all" is for replay, where the session already ended and every offer was reached. */
export type EvergreenRevealPosition = number | "all" | "none";

export function revealEvergreenTimeline<T extends TimelineEvent>(events: readonly T[], position: EvergreenRevealPosition) {
  const supported = events.filter((event) => !EVERGREEN_UNSUPPORTED_EVENT_TYPES.has(event.eventType));
  if (position === "all") return { events: supported, nextRevealAtSec: null };
  const visible: T[] = [];
  let nextRevealAtSec: number | null = null;
  for (const event of supported) {
    const reached = position !== "none" && Number.isFinite(event.triggerSec) && event.triggerSec <= position;
    if (!OFFER_EVENT_TYPES.has(event.eventType) || reached) {
      visible.push(event);
      continue;
    }
    if (position !== "none" && Number.isFinite(event.triggerSec)) {
      nextRevealAtSec = nextRevealAtSec === null ? event.triggerSec : Math.min(nextRevealAtSec, event.triggerSec);
    }
  }
  return { events: visible, nextRevealAtSec };
}

/** Only products an already revealed spotlight points at are shipped before replay. */
export function revealEvergreenProducts<P extends { id: string }>(
  products: readonly P[],
  visibleEvents: readonly TimelineEvent[],
  position: EvergreenRevealPosition,
) {
  if (position === "all") return [...products];
  const revealed = new Set(visibleEvents
    .filter((event) => event.eventType === "product_spotlight" && event.productId)
    .map((event) => event.productId));
  return products.filter((product) => revealed.has(product.id));
}

/**
 * The evergreen settings' coupon (優惠券) and consultation CTA seconds become
 * timeline events: the coupon spotlights the live's first purchasable product
 * and the consultation CTA opens the live's registration form.
 */
export function evergreenSettingEvents(input: {
  pitchAtSeconds: number | null;
  consultationAtSeconds: number | null;
  pitchProduct: { id: string; offerLabel: string | null } | null;
  consultationFormAvailable: boolean;
}) {
  const events: Array<{
    id: string;
    eventType: string;
    triggerSec: number;
    title: string;
    message: string | null;
    productId: string | null;
    ctaLabel: string | null;
    ctaUrl: string | null;
    role: null;
  }> = [];
  if (validSecond(input.pitchAtSeconds) && input.pitchProduct) {
    events.push({
      id: EVERGREEN_PITCH_EVENT_ID,
      eventType: "product_spotlight",
      triggerSec: input.pitchAtSeconds,
      title: input.pitchProduct.offerLabel?.trim() || "限時優惠",
      message: null,
      productId: input.pitchProduct.id,
      ctaLabel: null,
      ctaUrl: null,
      role: null,
    });
  }
  if (validSecond(input.consultationAtSeconds) && input.consultationFormAvailable) {
    events.push({
      id: EVERGREEN_CONSULTATION_EVENT_ID,
      eventType: EVERGREEN_CONSULTATION_EVENT_TYPE,
      triggerSec: input.consultationAtSeconds,
      title: "預約諮詢",
      message: null,
      productId: null,
      ctaLabel: "預約諮詢",
      ctaUrl: null,
      role: null,
    });
  }
  return events;
}

function validSecond(value: number | null): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
