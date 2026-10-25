type TimedEvent = { eventType: string; triggerSec: number };

// Returns the earliest product spotlight second when it falls at or past the
// end of the bound video, so viewers would never reach the product card.
// An unknown duration (0 or missing) never warns.
export function productEventBeyondVideoSec(durationSec: number | null | undefined, events: TimedEvent[]) {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  const productSeconds = events
    .filter((event) => event.eventType === "product_spotlight")
    .map((event) => event.triggerSec);
  if (productSeconds.length === 0) return null;
  const firstProductSec = Math.min(...productSeconds);
  return firstProductSec >= durationSec ? firstProductSec : null;
}
