/** Approved WP20 rules only. Callers must supply verified, same-person,
 * same-tenant, same-session/content-version facts. This module does not join
 * identities, infer missing events, or decide any metric denominator.
 */
export const COMPLETION_PERCENT = 90;
export const POST_COMPLETION_ORDER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Unavailable = { status: "unavailable"; reason: "missing_data" | "invalid_data" };
export type MediaInterval = Readonly<{ startMs: number; endMs: number }>;

/** Intervals describe actually played media positions, not seek endpoints.
 * null means incomplete/unknown evidence; [] means a known empty history.
 * Replaying the same positions cannot increase unique coverage.
 */
export function evaluateVideoCompletion(
  durationMs: number | null,
  intervals: readonly MediaInterval[] | null,
): Unavailable | { status: "available"; coveredMs: number; completed: boolean } {
  if (durationMs == null || intervals == null) return { status: "unavailable", reason: "missing_data" };
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || !Array.isArray(intervals) || Array.from(intervals).some((interval) =>
    !interval || typeof interval !== "object"
    || !Number.isSafeInteger(interval.startMs) || !Number.isSafeInteger(interval.endMs)
    || interval.startMs < 0 || interval.endMs < interval.startMs || interval.endMs > durationMs)) {
    return { status: "unavailable", reason: "invalid_data" };
  }
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  let coveredMs = 0;
  let end = 0;
  for (const interval of sorted) {
    coveredMs += Math.max(0, interval.endMs - Math.max(end, interval.startMs));
    end = Math.max(end, interval.endMs);
  }
  // Integer arithmetic avoids rounding a below-threshold viewer up to 90%.
  const completed = BigInt(coveredMs) * BigInt(100) >= BigInt(durationMs) * BigInt(COMPLETION_PERCENT);
  return { status: "available", coveredMs, completed };
}

export type EstablishedOrderFact = Readonly<{
  establishedAtMs: number | null;
  cancelled: boolean | null;
}>;

/** Completion time must come from verified first threshold-crossing evidence;
 * a total coverage number alone cannot establish when completion occurred.
 * The 7-day boundary is inclusive, using elapsed UTC milliseconds, not dates.
 * This is order eligibility, not paid conversion or mature cohort reporting.
 */
export function evaluatePostCompletionOrder(
  firstCompletedAtMs: number | null,
  order: EstablishedOrderFact,
): Unavailable | { status: "available"; qualifies: boolean } {
  if (firstCompletedAtMs == null || order == null || order.establishedAtMs == null || order.cancelled == null) {
    return { status: "unavailable", reason: "missing_data" };
  }
  if (typeof order.cancelled !== "boolean" || ![firstCompletedAtMs, order.establishedAtMs].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000)) {
    return { status: "unavailable", reason: "invalid_data" };
  }
  const elapsed = order.establishedAtMs - firstCompletedAtMs;
  return { status: "available", qualifies: !order.cancelled && elapsed >= 0 && elapsed <= POST_COMPLETION_ORDER_WINDOW_MS };
}
