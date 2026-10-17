/** Durable workers use this decision without retaining provider response bodies. */
export type TrackingDeliveryDecision =
  | { outcome: "accepted" }
  | { outcome: "retry"; retryAt: Date }
  | { outcome: "rejected" };

export const TRACKING_MAX_ATTEMPTS = 8;

export function decideTrackingDelivery(input: {
  attempt: number;
  now: Date;
  status: number | null;
  acceptedEvents: number | null;
}): TrackingDeliveryDecision {
  if (!Number.isInteger(input.attempt) || input.attempt < 1 || input.attempt > TRACKING_MAX_ATTEMPTS ||
      !Number.isFinite(input.now.getTime()) ||
      (input.status !== null && (!Number.isInteger(input.status) || input.status < 100 || input.status > 599))) {
    throw new TypeError("Invalid tracking delivery decision.");
  }
  // An HTTP success alone does not prove this single-event request was accepted.
  if (input.status !== null && input.status >= 200 && input.status < 300 && input.acceptedEvents === 1) {
    return { outcome: "accepted" };
  }
  const transient = input.status === null || input.status === 408 || input.status === 429 || input.status >= 500;
  if (!transient || input.attempt === TRACKING_MAX_ATTEMPTS) return { outcome: "rejected" };
  const delayMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** (input.attempt - 1));
  const timestamp = input.now.getTime() + delayMs;
  if (!Number.isFinite(new Date(timestamp).getTime())) throw new TypeError("Invalid tracking retry time.");
  return { outcome: "retry", retryAt: new Date(timestamp) };
}
