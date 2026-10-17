// src/lib/live-metric-contract.ts
var COMPLETION_PERCENT = 90;
var POST_COMPLETION_ORDER_WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;

// src/lib/live-viewing-evidence.ts
var MAX_PLAYBACK_SAMPLE_GAP_MS = 5e3;
var MAX_COMPLETION_SEGMENTS = 1e4;
function validSample(sample) {
  return !!sample && Number.isSafeInteger(sample.elapsedMs) && sample.elapsedMs >= 0 && Number.isSafeInteger(sample.mediaMs) && sample.mediaMs >= 0 && Number.isFinite(sample.rate) && sample.rate >= 0.25 && sample.rate <= 4 && typeof sample.playing === "boolean";
}
function playbackSegment(previous, current) {
  if (!previous || !validSample(previous) || !validSample(current) || !previous.playing || !current.playing || previous.rate !== current.rate) return null;
  const elapsed = current.elapsedMs - previous.elapsedMs;
  const media = current.mediaMs - previous.mediaMs;
  if (elapsed <= 0 || elapsed > MAX_PLAYBACK_SAMPLE_GAP_MS || media <= 0 || Math.abs(media - elapsed * current.rate) > 1) return null;
  return { wallStartMs: previous.elapsedMs, wallEndMs: current.elapsedMs, mediaStartMs: previous.mediaMs, mediaEndMs: current.mediaMs };
}
function firstCompletionTime(durationMs, segments, window = { startMs: 0, endMs: 864e13 }) {
  if (durationMs === null || segments === null) return { status: "unavailable", reason: "missing_data" };
  if (!Array.isArray(segments) || !Number.isSafeInteger(durationMs) || durationMs <= 0) return { status: "unavailable", reason: "invalid_data" };
  if (![window.startMs, window.endMs].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 864e13) || window.startMs > window.endMs) return { status: "unavailable", reason: "invalid_data" };
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
  if (low > high || !completedAt(durationMs, segments, high, window.startMs)) return { status: "available", firstCompletedAtMs: null };
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (completedAt(durationMs, segments, middle, window.startMs)) high = middle;
    else low = middle + 1;
  }
  return { status: "available", firstCompletedAtMs: low };
}
function validSegment(row, durationMs) {
  return !!row && [row.wallStartMs, row.wallEndMs, row.mediaStartMs, row.mediaEndMs].every((value) => Number.isSafeInteger(value) && value >= 0) && row.wallEndMs <= 864e13 && row.wallEndMs > row.wallStartMs && row.mediaEndMs > row.mediaStartMs && row.mediaEndMs <= durationMs;
}
var compare = (a, b) => a.n * b.d - b.n * a.d;
function gcd(a, b) {
  while (b !== BigInt(0)) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}
function add(a, b) {
  const shared = gcd(a.d, b.d);
  const n = a.n * (b.d / shared) + b.n * (a.d / shared);
  const d = a.d * (b.d / shared);
  const divisor = gcd(n, d);
  return { n: n / divisor, d: d / divisor };
}
function mediaAt(row, atMs) {
  const d = BigInt(row.wallEndMs - row.wallStartMs);
  return { n: BigInt(row.mediaStartMs) * d + BigInt(row.mediaEndMs - row.mediaStartMs) * BigInt(atMs - row.wallStartMs), d };
}
function completedAt(durationMs, segments, atMs, eligibleAtMs) {
  const intervals = segments.filter((row) => Math.max(row.wallStartMs, eligibleAtMs) < Math.min(row.wallEndMs, atMs)).map((row) => ({
    start: mediaAt(row, Math.max(row.wallStartMs, eligibleAtMs)),
    end: mediaAt(row, Math.min(row.wallEndMs, atMs))
  })).sort((a, b) => {
    const order = compare(a.start, b.start);
    return order < BigInt(0) ? -1 : order > BigInt(0) ? 1 : 0;
  });
  let end = { n: BigInt(0), d: BigInt(1) };
  let covered = { n: BigInt(0), d: BigInt(1) };
  for (const interval of intervals) {
    const start = compare(interval.start, end) > BigInt(0) ? interval.start : end;
    if (compare(interval.end, start) > BigInt(0)) {
      covered = add(covered, { n: interval.end.n * start.d - start.n * interval.end.d, d: interval.end.d * start.d });
      end = interval.end;
    }
  }
  return covered.n * BigInt(100) >= BigInt(durationMs) * BigInt(COMPLETION_PERCENT) * covered.d;
}
export {
  MAX_COMPLETION_SEGMENTS,
  MAX_PLAYBACK_SAMPLE_GAP_MS,
  firstCompletionTime,
  playbackSegment
};
