import { describe, expect, it } from "vitest";
import { firstCompletionTime, playbackSegment, MAX_COMPLETION_SEGMENTS, type PlaybackSample, type PlaybackSegment } from "./live-viewing-evidence";

const sample: PlaybackSample = { elapsedMs: 1000, mediaMs: 0, rate: 1, playing: true };
const segment: PlaybackSegment = { wallStartMs: 1000, wallEndMs: 101000, mediaStartMs: 0, mediaEndMs: 100000 };

describe("bounded actual playback segments", () => {
  it("emits continuous exposure at normal and double speed", () => {
    expect(playbackSegment(sample, { ...sample, elapsedMs: 2000, mediaMs: 1000 })).toEqual({ wallStartMs: 1000, wallEndMs: 2000, mediaStartMs: 0, mediaEndMs: 1000 });
    expect(playbackSegment({ ...sample, rate: 2 }, { ...sample, elapsedMs: 2000, mediaMs: 2000, rate: 2 })?.mediaEndMs).toBe(2000);
  });
  it.each([
    { elapsedMs: 2000, mediaMs: 50000 }, // seek
    { elapsedMs: 2000, mediaMs: 0 }, // buffering
    { elapsedMs: 9000, mediaMs: 8000 }, // missing samples
    { elapsedMs: 1000, mediaMs: 1000 }, // non-monotonic time
    { elapsedMs: 2000, mediaMs: 1000, rate: 2 },
    { elapsedMs: 2000, mediaMs: 1000, playing: false },
    { elapsedMs: NaN, mediaMs: 1000 },
  ])("does not fill discontinuity %j", (patch) => {
    expect(playbackSegment(sample, { ...sample, ...patch })).toBeNull();
  });
  it("requires a new anchor after pause, seek or source reset", () => {
    const next = { ...sample, elapsedMs: 2000, mediaMs: 1000 };
    expect(playbackSegment(null, next)).toBeNull();
    expect(playbackSegment({ ...sample, playing: false }, next)).toBeNull();
  });
});

describe("first 90 percent threshold time", () => {
  it.each([[1000, 49000, 44100], [29970, 30000, 27000], [3, 10, 9]])("preserves rational crossing %i/%i at %i", (duration, wallEndMs, expected) => {
    const row = { wallStartMs: 0, wallEndMs, mediaStartMs: 0, mediaEndMs: duration };
    expect(firstCompletionTime(duration, [row])).toEqual({ status: "available", firstCompletedAtMs: expected });
  });
  it("preserves the original slope when verification/report bounds cut a segment", () => {
    const row = { wallStartMs: 0, wallEndMs: 30000, mediaStartMs: 0, mediaEndMs: 29970 };
    expect(firstCompletionTime(29970, [row], { startMs: 17, endMs: 29000 })).toEqual({ status: "available", firstCompletedAtMs: 27017 });
    expect(firstCompletionTime(29970, [row], { startMs: 17, endMs: 27016 })).toEqual({ status: "available", firstCompletedAtMs: null });
  });
  it("matches an independent rational oracle with coprime durations and overlapping media", () => {
    const rows = [
      { wallStartMs: 0, wallEndMs: 7, mediaStartMs: 0, mediaEndMs: 40 },
      { wallStartMs: 0, wallEndMs: 11, mediaStartMs: 20, mediaEndMs: 70 },
      { wallStartMs: 0, wallEndMs: 13, mediaStartMs: 60, mediaEndMs: 100 },
    ];
    // At t=11 and 12, all three media intervals overlap. The union is
    // [40/7, 60+40*t/13], giving covered=(4940+280*t)/91.
    const crosses = (t: number) => BigInt(4940 + 280 * t) >= BigInt(90 * 91);
    expect(crosses(11)).toBe(false);
    expect(crosses(12)).toBe(true);
    expect(firstCompletionTime(100, rows, { startMs: 1, endMs: 13 })).toEqual({ status: "available", firstCompletedAtMs: 12 });
  });
  it("rounds a fractional crossing up consistently instead of backdating it", () => {
    const row = { wallStartMs: 0, wallEndMs: 50, mediaStartMs: 0, mediaEndMs: 100 };
    expect(firstCompletionTime(101, [row])).toEqual({ status: "available", firstCompletedAtMs: 46 });
  });
  it("finds the crossing inside a sample rather than at receipt/end time", () => {
    expect(firstCompletionTime(100000, [segment])).toEqual({ status: "available", firstCompletedAtMs: 91000 });
  });
  it("uses actual playback rate and integer ceiling at fractional thresholds", () => {
    expect(firstCompletionTime(100000, [{ ...segment, wallEndMs: 51000 }])).toEqual({ status: "available", firstCompletedAtMs: 46000 });
    expect(firstCompletionTime(3, [{ wallStartMs: 0, wallEndMs: 10, mediaStartMs: 0, mediaEndMs: 3 }])).toEqual({ status: "available", firstCompletedAtMs: 9 });
  });
  it("handles delayed, out-of-order and overlapping device segments", () => {
    const pieces = [
      { wallStartMs: 2000, wallEndMs: 52000, mediaStartMs: 50000, mediaEndMs: 100000 },
      { wallStartMs: 1000, wallEndMs: 51000, mediaStartMs: 0, mediaEndMs: 50000 },
    ];
    expect(firstCompletionTime(100000, pieces)).toEqual({ status: "available", firstCompletedAtMs: 46500 });
    expect(firstCompletionTime(100000, [...pieces, ...pieces].reverse())).toEqual(firstCompletionTime(100000, pieces));
  });
  it("does not count replay or skipped gaps as unique coverage", () => {
    const short = { ...segment, mediaEndMs: 40000 };
    expect(firstCompletionTime(100000, [short, { ...short, wallStartMs: 200000, wallEndMs: 300000 }])).toEqual({ status: "available", firstCompletedAtMs: null });
    expect(firstCompletionTime(100000, [short, { ...segment, mediaStartMs: 60000 }])).toEqual({ status: "available", firstCompletedAtMs: null });
  });
  it("distinguishes missing evidence from a complete empty history", () => {
    expect(firstCompletionTime(100000, [])).toEqual({ status: "available", firstCompletedAtMs: null });
    expect(firstCompletionTime(100000, null).status).toBe("unavailable");
    expect(firstCompletionTime(null, []).status).toBe("unavailable");
  });
  it("bounds work without truncating a viewer history", () => {
    expect(firstCompletionTime(100000, Array(MAX_COMPLETION_SEGMENTS + 1).fill(segment))).toEqual({ status: "unavailable", reason: "limit_exceeded" });
  });
  it("bounds the common rational scale before allocating large histories", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ wallStartMs: 0, wallEndMs: 1_000_000_000_000 + i, mediaStartMs: 0, mediaEndMs: 100 }));
    expect(firstCompletionTime(100, rows)).toEqual({ status: "unavailable", reason: "limit_exceeded" });
  });
  it.each([[5000, "available"], [5800, "unavailable"]] as const)("pins the measured LCM envelope through %i ms", (count, status) => {
    let media = 0;
    const rows = Array.from({ length: count }, (_, i) => { const mediaStartMs = media; media += i + 2; return { wallStartMs: 0, wallEndMs: i + 1, mediaStartMs, mediaEndMs: media }; });
    const result = firstCompletionTime(media, rows);
    expect(result.status).toBe(status);
    if (status === "available") expect(result).toEqual({ status: "available", firstCompletedAtMs: 3420 });
    else expect(result).toEqual({ status: "unavailable", reason: "limit_exceeded" });
  });
  it.each([{ wallEndMs: 1000 }, { mediaStartMs: -1 }, { mediaEndMs: 100001 }, { wallStartMs: NaN }])("rejects invalid evidence %j", (patch) => {
    expect(firstCompletionTime(100000, [{ ...segment, ...patch }])).toEqual({ status: "unavailable", reason: "invalid_data" });
  });
  it("does not mutate segment order", () => {
    const rows = Object.freeze([Object.freeze(segment)]);
    expect(firstCompletionTime(100000, rows).status).toBe("available");
    expect(rows[0]).toBe(segment);
  });
});
