import { COMPLETION_PERCENT } from "./live-metric-contract";

/** These are bounded exposure samples, not proof of human attention. A caller
 * must reset on seek, buffering, pause, source/version changes and rate changes.
 * Monotonic elapsed time is later anchored to server time by ingestion.
 */
export type PlaybackSample = Readonly<{
  elapsedMs: number; mediaMs: number; rate: number; playing: boolean;
}>;
export type PlaybackSegment = Readonly<{
  wallStartMs: number; wallEndMs: number; mediaStartMs: number; mediaEndMs: number;
}>;
export const MAX_PLAYBACK_SAMPLE_GAP_MS = 5000;
export const MAX_COMPLETION_SEGMENTS = 10000;

function validSample(sample: PlaybackSample): boolean {
  return !!sample && Number.isSafeInteger(sample.elapsedMs) && sample.elapsedMs >= 0
    && Number.isSafeInteger(sample.mediaMs) && sample.mediaMs >= 0
    && Number.isFinite(sample.rate) && sample.rate >= 0.25 && sample.rate <= 4
    && typeof sample.playing === "boolean";
}

/** A discontinuity returns no interval. Do not connect endpoints across gaps.
 * Integer millisecond samples allow one millisecond of quantization error.
 * This check bounds accidental seek jumps; the server still validates batches.
 */
export function playbackSegment(previous: PlaybackSample | null, current: PlaybackSample): PlaybackSegment | null {
  if (!previous || !validSample(previous) || !validSample(current) || !previous.playing || !current.playing || previous.rate !== current.rate) return null;
  const elapsed = current.elapsedMs - previous.elapsedMs;
  const media = current.mediaMs - previous.mediaMs;
  if (elapsed <= 0 || elapsed > MAX_PLAYBACK_SAMPLE_GAP_MS || media <= 0 || Math.abs(media - elapsed * current.rate) > 1) return null;
  return { wallStartMs: previous.elapsedMs, wallEndMs: current.elapsedMs, mediaStartMs: previous.mediaMs, mediaEndMs: current.mediaMs };
}

/** Derive the earliest integer millisecond at which unique coverage reached
 * 90%. Segments must be validated constant-rate exposure for one person/version.
 * Sorting by arrival order is incorrect for delayed and overlapping devices;
 * instead use a monotone coverage predicate over playback time.
 */
export function firstCompletionTime(durationMs: number | null, segments: readonly PlaybackSegment[] | null, window: Readonly<{ startMs: number; endMs: number }> = { startMs: 0, endMs: 8_640_000_000_000_000 }):
  | { status: "unavailable"; reason: "missing_data" | "invalid_data" | "limit_exceeded" }
  | { status: "available"; firstCompletedAtMs: number | null } {
  if (durationMs === null || segments === null) return { status: "unavailable", reason: "missing_data" };
  if (!Array.isArray(segments) || !Number.isSafeInteger(durationMs) || durationMs <= 0) return { status: "unavailable", reason: "invalid_data" };
  if (![window.startMs, window.endMs].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000) || window.startMs > window.endMs) return { status: "unavailable", reason: "invalid_data" };
  if (segments.length > MAX_COMPLETION_SEGMENTS) return { status: "unavailable", reason: "limit_exceeded" };
  if (Array.from(segments).some((row) => !validSegment(row, durationMs))) return { status: "unavailable", reason: "invalid_data" };
  if (segments.length === 0) return { status: "available", firstCompletedAtMs: null };
  let low = Infinity;
  let high = 0;
  for (const row of segments) {
    low = Math.min(low, row.wallStartMs);
    high = Math.max(high, row.wallEndMs);
  }
  low = Math.max(low, window.startMs);
  high = Math.min(high, window.endMs);
  const prepared = prepareSegments(segments, window.startMs);
  if (!prepared) return { status: "unavailable", reason: "limit_exceeded" };
  if (low > high || !completedAt(durationMs, prepared, high)) return { status: "available", firstCompletedAtMs: null };
  // At most 53 iterations for safe integer time. No per-millisecond scan and
  // no invented first-completion timestamp from receipt/arrival order.
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (completedAt(durationMs, prepared, middle)) high = middle;
    else low = middle + 1;
  }
  return { status: "available", firstCompletedAtMs: low };
}

function validSegment(row: PlaybackSegment, durationMs: number): boolean {
  return !!row && [row.wallStartMs, row.wallEndMs, row.mediaStartMs, row.mediaEndMs].every((value) => Number.isSafeInteger(value) && value >= 0)
    && row.wallEndMs <= 8_640_000_000_000_000 && row.wallEndMs > row.wallStartMs
    && row.mediaEndMs > row.mediaStartMs && row.mediaEndMs <= durationMs;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== BigInt(0)) { const next = a % b; a = b; b = next; }
  return a;
}
type PreparedSegment = { row: PlaybackSegment; start: bigint; base: bigint; rate: bigint; eligibleAtMs: number };
type PreparedHistory = { scale: bigint; segments: PreparedSegment[] };
const MAX_RATIONAL_SCALE = BigInt(1) << BigInt(8192);

function prepareSegments(segments: readonly PlaybackSegment[], eligibleAtMs: number): PreparedHistory | null {
  const eligible = segments.filter((row) => row.wallEndMs > eligibleAtMs);
  // One common exact scale avoids huge repeated fraction reductions inside
  // binary search. Bound its size before allocating scaled per-segment values.
  let scale = BigInt(1);
  for (const row of eligible) {
    const duration = BigInt(row.wallEndMs - row.wallStartMs);
    scale = scale / gcd(scale, duration) * duration;
    if (scale > MAX_RATIONAL_SCALE) return null;
  }
  const prepared = eligible.map((row) => {
    const base = BigInt(row.mediaStartMs) * scale;
    const rate = BigInt(row.mediaEndMs - row.mediaStartMs) * (scale / BigInt(row.wallEndMs - row.wallStartMs));
    const at = Math.max(row.wallStartMs, eligibleAtMs);
    return { row, base, rate, eligibleAtMs: at, start: base + rate * BigInt(at - row.wallStartMs) };
  }).sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  return { scale, segments: prepared };
}

/** Preserve original slopes and exact coverage. The fixed denominator is
 * shared by every interval, so union and threshold tests use integers only.
 * Sort eligible starts once and stop summing once the threshold is reached.
 */
function completedAt(durationMs: number, history: PreparedHistory, atMs: number): boolean {
  let end = BigInt(0);
  let covered = BigInt(0);
  const threshold = BigInt(durationMs) * BigInt(COMPLETION_PERCENT) * history.scale;
  for (const prepared of history.segments) {
    if (prepared.eligibleAtMs >= atMs) continue;
    const intervalEnd = prepared.base + prepared.rate * BigInt(Math.min(prepared.row.wallEndMs, atMs) - prepared.row.wallStartMs);
    const start = prepared.start > end ? prepared.start : end;
    if (intervalEnd > start) {
      covered += intervalEnd - start;
      end = intervalEnd;
      if (covered * BigInt(100) >= threshold) return true;
    }
  }
  return false;
}
